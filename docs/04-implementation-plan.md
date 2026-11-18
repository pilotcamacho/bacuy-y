# 04 — Implementation Plan — bacuy-y

Progress tracker. Work through the phases in order; each one produces a working, testable
increment. A phase is done when `npx tsc --noEmit` and `npm test` pass and its items are ticked
`[x]`, with an indented note under any item that deviated from the plan.

Milestones:

| | After phase | What works |
|---|---|---|
| M1 | 5 | Type lines in the browser, saved in IndexedDB, survive reload (no backend yet) |
| M2 | 6 | Ticks, types, marks and side panel, all local |
| M3 | 8 | Signed in, two browsers sync through AppSync |
| M4 | 10 | Flags + weights, feedback, gratitude journal |
| M5 | 11 | Priority and archived views |
| M6 | 13 | Installed PWA on the default Amplify URL, offline reload verified |

---

## Phase 0 — Scaffold

- [x] Vite + React 19 + TypeScript strict; ESLint; path alias `@/` → `src/`
  > Versions installed 2026-11-14: Vite 8.3, React 19.3, TypeScript 6.0, Vitest 5.1, ESLint 10
  > (flat config), React Router 7.18 (`react-router-dom`). One `tsconfig.json` for app, tests
  > and configs; the alias is declared in `tsconfig.json` `paths` and in `vite.config.ts`.
- [x] Tailwind 3 (`darkMode: "class"`), base layout (centered `max-w-2xl` column)
- [x] React Router with placeholder routes: `/`, `/priority`, `/archived`, `/flags`, `/journal`, `/settings`, `/auth/*`
  > Unknown routes redirect to `/`.
- [x] i18n (`src/lib/i18n.ts`, `es.json` default, `en.json`), language detector, `bacuyy_locale` override
  > The detector does not cache, so without an override the app keeps following the browser.
  > `<html lang>` and `dir` follow the active language. Settings already has the language
  > and theme selectors (they were cheap and exercise i18n + kv).
- [x] `tests/i18n/locales.test.ts`: identical key sets in every locale
  > Also checks one file per supported locale and no empty values.
- [x] `lib/kv.ts` (localStorage, try/catch, prefix `bacuyy_`), `hooks/useTheme.ts` (system / light / dark)
  > Theme is applied in `main.tsx` before the first render and also updates `meta theme-color`.
- [x] Vitest (jsdom) + Testing Library + `fake-indexeddb/auto`; Playwright config with `preview`
  > Playwright projects: Chromium, WebKit, Pixel 7. Smoke spec `e2e/smoke.spec.ts` passes on all three.
- [x] `.gitignore`, `README.md` pointing to `CLAUDE.md`
  > The folder is not a git repository yet.

## Phase 1 — Backend: auth and schema

- [x] `amplify/auth/resource.ts` (email login), `amplify/backend.ts`
  > `aws-amplify` 6.22.2 and `@aws-amplify/backend` 1.25.1 pinned exactly; backend-cli 1.10.0.
- [x] `amplify/data/resource.ts`: enums + `Activity`, `Flag`, `ActivityFlag`, `Feedback` copied from bacuy-x, plus `position`, `editedAt`, `deletedAt` (see `03-data-schema.md`)
  > Type-level test `tests/schema/schema.test.ts` checks the sync fields and enums.
  > Synth warns "owners may reassign ownership" (owner field writable through the generated
  > update mutation). Accepted: the app never uses the generated create/update; Phase 2's
  > upsert sets `owner` from the identity. Revisit if field-level auth is cheap to add.
- [x] `npx ampx sandbox --identifier bacuyy-dev` deploys; record table names and the stored `owner` format in `notes.md`
  > Deployed 2026-11-14 (stack `amplify-bacuyy-bacuyydev-sandbox-7f46bbc1e9`, us-east-1);
  > table names recorded. Owner format verified with a real user (auth screens pulled forward
  > from Phase 8): the stored value is the plain `sub`, not `sub::username`.
- [x] `src/lib/amplify.ts` imports `amplify_outputs.json`; `src/lib/client.ts` = `generateClient<Schema>()`
  > `npm run typecheck` now also checks `amplify/` (its own `tsconfig.json`).

## Phase 2 — Upsert resolver

- [x] `UpsertXResult` custom types + `upsertActivity`, `upsertFlag`, `upsertActivityFlag`, `upsertFeedback` mutations
  > Amplify refuses `a.ref(model)` inside a custom type, so `item` is a row custom type
  > (`ActivityRow`…) built from the same field list as the arguments plus `owner`,
  > `createdAt`, `updatedAt`.
- [x] `amplify/data/upsert.js` + `upsertResult.js` (pipeline, `02-backend-architecture.md` §2)
  > Nulls are `REMOVE`d instead of written as NULL (GSI key attributes cannot be NULL).
  > Deployed 2026-11-14 as 4 PIPELINE resolvers; `evaluate-code` on the real runtime OK.
  > One `ampx sandbox --once` hung at "Synthesizing backend…" for 10+ min; killing it and
  > rerunning fixed it (synth took 20 s).
- [x] Resolver unit tests with AppSync `EvaluateCode` (or a local evaluator): new row applied; newer edit applied; older edit → `applied: false` + server row; equal `editedAt` → not applied; other owner → unauthorized; `createdAt` preserved; `owner` ignored if sent
  > Local tests with a fake `@aws-appsync/utils` check the request shape and the result
  > mapping (13 tests). The DynamoDB semantics are checked by the round trip below.
- [x] Integration test (gated on `ACTIVITY_TABLE_NAME`): real round trip against the sandbox
  > Gated on `BACUYY_TEST_EMAIL` / `BACUYY_TEST_PASSWORD` instead (it needs a signed-in user,
  > not a table name): `npm run test:integration`. The same checks run from Settings →
  > "DEV · upsert self-test". The "other owner" case needs a second account; covered by the
  > unit test only.
  > 2026-11-14: DEV self-test against the sandbox with a real user → **OK 12/12** (new row,
  > owner/createdAt/updatedAt set, older and equal edits rejected with the stored row, newer
  > edit applied, createdAt kept, null removed, tombstone applied and not undone by an older
  > edit, generated read sees the row).

## Phase 3 — Local database

- [x] `lib/db/types.ts`: `LocalDb` (get, put, putMany, softDelete, listByIndex, dirty, clearDirtyIf, putFromServer, meta get/set, wipe, transaction)
  > Row types come from the upsert row custom types (`Schema["ActivityRow"]["type"]`…), so they
  > always match what the server returns. API as built: `get`, `getAll`, `listByIndex`,
  > `putLocal`, `putManyLocal` (one all-or-nothing transaction across stores, replaces a generic
  > `transaction`), `putFromServer`, `mergeFromServer` (the pull rule done atomically: later
  > `editedAt` wins, tie → server), `dirty`, `countDirty`, `clearDirtyIf`, `purgeTombstones`,
  > `getMeta` / `setMeta`, `wipe`, `close`. No `softDelete`: a delete is a normal local edit
  > (`deletedAt` + `editedAt`) made by the stores.
- [x] `lib/db/index.ts`: `idb` implementation, DB `bacuyy` v1, stores and indexes from `03-data-schema.md` §7
  > Rows are cleaned before storing: functions (the generated client's relation loaders) and
  > `undefined` values are dropped. `null` index values (e.g. `status`, `parentId`) are simply
  > left out of the index.
  > Bug found by the contract tests: a put that throws synchronously inside a batch left the
  > earlier puts committed. Fixed by aborting the transaction.
- [x] `lib/ids.ts`: `newId()`, `flagId(sub, key)`, `activityFlagId(a, f)`, `gratitudeId(sub, windowStart)`
  > `uuid` 14, namespace `BACUYY_NS` fixed; a snapshot test fails if it ever changes.
- [x] `services/sync/clock.ts`: `now()` with offset (offset sampling comes in Phase 7)
  > Sampling is already there too (`observeServerTime`: midpoint of the round trip, median of
  > the last 10, slow round trips ignored, persisted in `sync_meta.clockOffsetMs`); Phase 7 only
  > calls it from the push.
- [x] Contract tests on `fake-indexeddb`: dirty index, `clearDirtyIf` race, `putFromServer` clears dirty, wipe
  > `tests/db/localDb.test.ts` (18 tests: also every index, batch atomicity, merge newer / older /
  > tie, tombstones beating and losing to edits, purge, meta, reopen = reload),
  > `tests/lib/ids.test.ts`, `tests/sync/clock.test.ts`.

## Phase 4 — Marks

- [x] `services/marks/keywords.ts` (es + en, normalized), `normalize()` (lowercase, strip accents)
  > Written keywords keep their accents (`!hábito`, `!acción`, `#diversión`); matching always
  > normalizes. System flag aliases (`salud`/`health`…) live here too.
- [x] `parse(rawInput, flags, today)` → `{ title, type, flagIds, unresolved[], date, frequency, spans[] }`
  > `parseLine(raw, { flags, today })` → `{ title, activityType, typeFromMark, flagIds,
  > frequency, date: { field, iso }, marks[] }`. Each mark span has a status: `ok`, `unknown`,
  > `ambiguous`, `duplicate`, `notApplicable` (replaces `unresolved[]`). Duplicates and
  > not-applicable marks leave the title too (doc §2 updated).
- [x] `serialize`: set / replace / remove a mark in `rawInput` (used by the panel)
  > `setTypeMark` (writes nothing when the type is already the default), `setFrequencyMark`,
  > `setDateMark` (replaces the winning mark in place), `addFlagMark` / `removeFlagMark`,
  > `flagMarkText` (shortest form that resolves uniquely, localized system word).
- [x] Relative dates → canonical ISO rewrite on commit (`commitLine(rawInput, today)`)
  > `commitLine(raw, ctx)` also rewrites `@31/12` (no year = relative) and marks that are not
  > applicable to the type, so the meaning stays stable if the type changes later.
- [x] Tests: every example in `05-line-mapping.md` §2.5, escapes, punctuation after marks, duplicate single-value marks, ambiguous child flag, unknown marks, accents/case
  > 56 tests in `tests/marks/` (also: every type keyword, applicability by type, weekday /
  > month / year rollovers, 29/2, invalid dates, flag cycles in corrupt data, user flags not
  > getting system aliases, every written flag mark resolving back to its flag).

## Phase 5 — Editor (local only) · **M1**

- [x] `services/editor`: split, merge up/down, delete empty, paste multi-line, move up/down, positions (`fractional-indexing`) — pure, fully unit-tested
  > 24 tests. Order = `position`, then `id` (two devices can generate the same key for the
  > same spot); `positionAfter` skips equal neighbours because no key fits between two equal
  > keys. `pageLines()` + the "ghost line" (shown, never stored, when the page is empty).
- [x] `stores/pageStore.ts`: load from `LocalDb`, apply editor results, debounce text writes (300 ms) + flush on blur / `visibilitychange`
  > Also flushes on `pagehide`. Text-owned fields (title, type, frequency, the type's date
  > field) are derived on every edit (`services/lifecycle/derive.ts`); flags and the status
  > rule come in Phase 6. Writes are serialized in one queue.
  > Bug found by the component tests: structural edits awaited the disk before updating
  > memory, so keys typed right after Enter/Backspace landed in the old line. Memory is now
  > updated synchronously and the write follows.
- [x] `components/LineEditor.tsx`, `LineRow.tsx`: textarea-over-mirror rendering with mark highlights; keyboard map from `05-line-mapping.md` §3; always ≥ 1 line
  > Recognized marks: indigo chip; duplicate / not applicable: amber, dotted; unknown /
  > ambiguous: dotted underline only. ↑/↓ leave the line when it is one visual row or the
  > caret is at the edge. Ctrl/Cmd+Enter is reserved for the tick (does nothing yet).
- [x] Drag handle with `@dnd-kit/sortable` (pointer, touch long-press, keyboard)
  > Pointer (4 px), touch (250 ms long-press), keyboard sensors; translated screen-reader
  > instructions and announcements; vertical-axis modifier written inline (no extra package).
- [x] "Line deleted — undo" toast (5 s)
  > Shown when a merge removed text (Backspace at start / Delete at end); undo writes both rows
  > back as they were. Deleting an empty line has no undo (nothing to restore).
- [x] `data-testid`s: `line-row-<i>`, `line-done-<i>`, `line-handle-<i>`
  > `line-done-<i>` comes with the tick in Phase 6.
- [x] E2E: type three lines, reload → same lines; split / merge / paste / drag
  > `e2e/page.spec.ts` signs in with a real account, so it is gated on `BACUYY_TEST_EMAIL` /
  > `BACUYY_TEST_PASSWORD` (skipped otherwise). The same behaviors run without a backend in
  > `tests/components/lineEditor.test.tsx` (13 tests on fake-indexeddb, including "reload").
  > The Phase 0 smoke spec now checks the signed-out redirect.

## Phase 6 — Lifecycle, tick and panel · **M2**

- [x] `services/lifecycle`: tick per type, untick for `ACTION`, `DRAFT ↔ ACTIVE` flag rule, gratitude completion guard, expiration renew/archive
  > `tick.ts` (per-type result: update / open panel at a section / nothing), `status.ts`
  > (flag rule, panel actions), `activityFlags.ts` (diff with deterministic ids).
  > A completed `REPETITIVE_ACTION` or `HABIT` is reactivated from the panel, not the tick.
- [x] Derive text-owned fields on every save (marks → `title`, type, dates, frequency, `ActivityFlag` rows with deterministic ids)
  > The links are written in the same transaction as the activity. A deleted activity
  > soft-deletes its links and feedback; undo revives both (feedback by its `deletedAt`).
  > The text owns all three date fields: a type change clears the ones the new type does not use.
  > **Pulled forward from Phase 9:** the default flags are seeded on load
  > (`services/flags/defaults.ts`), so `#salud` resolves before sync exists. Seeds carry
  > `editedAt` = epoch, which loses to any server version (pull merge and upsert condition),
  > so seeding before the first pull is safe. After load every line is reconciled against
  > the flags (a line typed before its flag existed becomes ACTIVE and gets its link).
- [x] `components/LinePanel.tsx` (drawer / bottom sheet), sections from `05-line-mapping.md` §5; panel edits rewrite marks
  > Section 7 (feedback) shows "coming soon" until Phase 10. Esc closes and returns the focus
  > to the line. Non-modal dialog: the page stays editable beside it.
- [x] Tick column rendering per type (counter, streak, badges); muted + strike-through for completed
  > `components/TickCell.tsx`, `data-testid="line-done-<i>"`; ⋯ button `line-more-<i>`.
  > Paused lines are italic with a "‖" badge. The habit-formed hint is a toast.
- [x] Tests: each type's tick; flags ↔ status; panel → mark rewrite round trip
  > `tests/lifecycle/lifecycle.test.ts`, `tests/components/linePanel.test.tsx`, one gated e2e.

## Phase 7 — Sync engine

- [x] `services/sync/push.ts`, `pull.ts`, `reconcile.ts`, `syncEngine.ts` (`02-backend-architecture.md` §3–§6)
  > Transport behind a `Remote` interface (`remote.ts`); the app uses `appsyncRemote.ts`
  > (loaded lazily by `services/sync/index.ts`), tests use `tests/sync/fakeServer.ts`, an
  > in-memory server with the resolver's rules.
  > Deviations: `applied: false` merges the server row with `mergeFromServer` (not
  > `putFromServer`), so an edit made during the push is still kept; a network or auth error
  > stops the push at once and does not touch the rows' backoff; reconcile edits are pushed
  > in a follow-up run of the same sync (at most 3 follow-ups).
  > The reconcile logic is shared with the page store (`services/lifecycle/reconcile.ts`).
- [x] `navigator.locks` single runner + coalesced follow-up; `localStorage` lease fallback
  > Lease: 60 s, renewed every 20 s while syncing, so a tab that died blocks others ≤ 60 s.
- [x] `BroadcastChannel("bacuyy")`: stores reload changed rows
  > `lib/events.ts` carries `localWrite` and `synced` in the tab and to other tabs. The page
  > store `refresh()` keeps lines whose text is still in its debounce and reuses unchanged
  > row objects (no re-render).
- [x] Clock offset sampling; tombstone purge (> 30 days, not dirty)
- [x] `stores/syncStore.ts` + `components/SyncIndicator.tsx` (`data-testid="sync-indicator"`)
  > In the header; click = sync now; tooltip with last sync, pending changes and "sign in
  > again" for auth errors. Before the first successful sync, failures show `offline`.
- [x] Tests (CLAUDE.md *Workflow* 4): push applied; older edit rejected and replaced locally; dirty race; pull newer vs older local; ties; tombstone beats / loses to an edit; pagination; reconcile after pull; deterministic default-flag collision; concurrent sync (lock); other owner's row refused
  > `tests/sync/sync.test.ts` (+ backoff, offline, repeated failures, purge, lease lock),
  > `tests/components/syncUi.test.tsx`, gated `tests/integration/sync.integration.test.ts`
  > (not run yet: needs the test account).

## Phase 8 — Auth and offline guard · **M3**

- [x] `routes/auth/*`: sign in, sign up, confirm, forgot password (Amplify Auth, i18n errors)
  > Pulled forward on 2026-11-14 to create a real user and verify the `owner` format (Phase 1).
  > Sign-up uses `autoSignIn`; confirm falls back to the sign-in form if auto sign-in fails.
- [x] `hooks/useAuth.ts`: guard from cached session; offline first-sign-in message
  > `getCurrentUser()` can fail offline when it tries to refresh an expired token, so the last
  > user is remembered in `bacuyy_lastUser` and keeps the app open offline (tested).
  > Settings has the account section and sign out (without the dirty-rows confirmation yet),
  > plus a DEV-only "owner probe" button (`services/sync/diagnostics.ts`, lazy-loaded, not in
  > the production bundle).
- [x] `ownerSub` check → wipe on user change; `navigator.storage.persist()` after sign-in
  > `services/session.ts`. The signed-in `Layout` renders the routes and starts sync only after
  > `prepareSession`. No owner recorded yet → the existing data is adopted (it can only be
  > from single-user development). `persist()` is asked once per browser (`bacuyy_persistAsked`).
- [x] Sign out: confirm if dirty rows exist, wipe IndexedDB
  > Flushes pending text, tries one sync (≤ 8 s), then counts dirty rows. If any: in-app
  > confirmation (retry / sign out and lose them / cancel). Order: stop sync (wait ≤ 5 s) →
  > wipe → reset stores → Amplify `signOut`; other tabs get `signedOut` and reload.
- [x] E2E (two browser contexts): edit in A, sync, appears in B; offline edits in both, reconnect, last edit wins
  > `e2e/sync.spec.ts`, chromium only, real backend, cleans up its own line. Its first run
  > found the clock-offset bug (refused upserts were sampled; see 02 §7), fixed with a
  > regression test. The indicator carries `data-dirty` for the spec.

## Phase 9 — Flags

- [x] `services/flags/defaults.ts`: seed missing system flags after the first `Flag` pull (deterministic ids)
  > Done in Phase 6, seeded on load with epoch `editedAt` (see there).
- [x] `stores/flagStore.ts`; `routes/Flags.tsx` + `components/FlagTree.tsx`: create, rename (non-system), reweight, recolor, delete (cascade soft delete)
  > Pure rules in `services/flags/tree.ts` (tree, drift, names, cascade). A new flag gets
  > weight 100 if it is the first child, else 0, so creating never breaks a sum. Names may
  > not contain `/` nor match a sibling's name or a system flag's alias (the mark would be
  > ambiguous). Every flag write runs in one queue and builds its rows from the flags as
  > stored at that moment (two quick creates once both got weight 100). The Flags screen
  > also seeds missing default flags (it can be opened before the page). The side panel
  > offers "create flag «x»" for an unknown `#x` mark (root flag; paths need the screen).
- [x] Weight editor blocks save unless siblings sum to 100; drift warning on the screen
  > Per sibling group: live total, save disabled until it is 100, discard. The drift banner
  > and a per-group note show while a stored group does not sum to 100.
- [x] Flag change → re-parse all lines (marks resolve / unresolve)
  > The flag store flushes the page's pending text, writes, then runs the sync reconcile on
  > every activity; the page store `refresh()` also re-derives its lines when the flags
  > differ (lines typed meanwhile, or a flag changed in another tab).
- [x] Tests: seeding twice is idempotent; cascade delete; weight validation
  > `tests/flags/flags.test.ts`, `tests/components/flagTree.test.tsx`, a panel test in
  > `linePanel.test.tsx`, and an e2e in `e2e/page.spec.ts` (all three browsers).

## Phase 10 — Feedback and gratitude journal · **M4**

- [x] `stores/feedbackStore.ts`; `components/FeedbackForm.tsx` (rating, valence/arousal pad, notes); post-tick prompt
  > Section 7 of the panel. Rating 1–5 required (as bacuy-x); valence and arousal are two
  > sliders (as bacuy-x's EmotionPicker), each optional: untouched = `null`, never a default
  > value. The list shows words (Mal / Neutro / Bien…), not numbers. "¿Cómo fue?" toast for
  > 6 s after completing an ACTION, a repetition or a habit day (not after unticking);
  > "Valorar" opens the panel on the feedback section.
- [x] `services/gratitude/autoCreate.ts`: on start and on visible, if enabled and the last cron window has no entry → create (`gratitudeId`), title localized, `rawInput` with `!gratitud #personal`, top of the page
  > Also every minute while visible and after each sync (`hooks/useGratitude.ts`). An entry
  > whose id exists locally (even deleted or archived) is never created again. Stamped
  > `editedAt` = window start, so a copy already edited on another device always wins.
  > Nothing is created before this device's first pull (`lastPulledAt:Activity`): a new
  > device could otherwise create it before its flags exist, and the later re-derive would
  > give it a fresh `editedAt` that overwrites the notes written elsewhere.
- [x] Settings: gratitude enable + cron (device-local, `bacuyy_gratitude*`)
  > Off by default, `0 20 * * *` (as bacuy-x). Only a valid cron is stored; preview of the
  > next entry. Turning it on creates the current window's entry at once.
- [x] `routes/Journal.tsx`: completed gratitude entries, newest first
  > Sorted by `editedAt`. Counts pending entries; "Editar" opens the panel on the notes.
- [x] Tests: one entry per window, two devices same window → same id
  > `tests/gratitude/gratitude.test.ts`, `tests/components/journal.test.tsx`, feedback tests in
  > `linePanel.test.tsx`, and an e2e for the prompt + form in `e2e/page.spec.ts`.

## Phase 11 — Priority and archived views · **M5**

- [x] `services/priority/score.ts` ported from bacuy-x: sibling-normalized path score, cron boost, expiration; no neglect, no environment
  > Pure, takes `now`. Days to an expiration are calendar days (the count the line's badge
  > shows), not bacuy-x's rounded-up 24 h periods. Ties keep page order. Deleted flags leave
  > the sibling sums; a flag whose parent is gone counts as a root; a group summing to 0 → 0.
- [x] `routes/PriorityView.tsx`: filtered + sorted list, tick + panel, click → focus the line on the page
  > Re-scores every minute (the cron boost depends on the clock). Shows the rank, the flags and
  > an "Ahora" badge when the cron boost applies. The page store now keeps full flag rows and
  > refreshes them when only a weight changed, so the list re-sorts after a weight save or sync.
  > Closing the panel returns the focus to the row's ⋯ button.
- [x] `routes/Archived.tsx`: restore (to the end of the page), delete
  > Newest `editedAt` first. Restore → ACTIVE/DRAFT by the flag rule, after the last page line;
  > an EXPIRATION gets `isRenewed: false` back. Delete asks first (no undo here), soft-deletes
  > the row, its links and its feedback. The focus moves to the next row (or the heading).
- [x] Tests: score parity with bacuy-x cases (weights summing to 100), drift normalization
  > `tests/priority/score.test.ts`, `tests/components/views.test.tsx`, and an e2e
  > (priority order → go to line → archive → restore) in `e2e/page.spec.ts`.
  > Also fixed here: the add-flag form cleared the field a second time after saving, losing the
  > keys typed meanwhile (WebKit e2e saved "orrer"). Regression test in `flagTree.test.tsx`.
  > `testTimeout` raised to 20 s: under the full parallel run the typing-heavy auth tests could
  > pass 5 s, and a timed-out test's typing leaked into the next one.

## Phase 12 — PWA polish

- [x] `vite-plugin-pwa`: manifest (name, icons 192/512/maskable, theme colors), `generateSW`, `navigateFallback`
  > vite-plugin-pwa 2.0.0 (Vite 8 support). Icons drawn in `public/icon.svg`, rendered to PNG by
  > `node scripts/icons.mjs` (Playwright's Chromium; maskable inside the 80 % safe zone).
  > `clientsClaim` so the first visit already works offline. The service worker is registered
  > from `src/lib/pwa.ts`, production builds only (`npm run dev` has none).
- [x] "New version" toast; install prompt hint in Settings
  > Deviation: `registerType: "prompt"`, not `"autoUpdate"`: a silent reload could lose text
  > still in its debounce. The toast's "Actualizar" flushes pending text, then activates the
  > new worker (reload). Settings → "Instalar la app": the browser's prompt when it offers one
  > (Chromium), otherwise how-to for desktop, Android and iOS; "ya está instalada" when standalone.
- [x] E2E offline: visit online, `setOffline(true)`, reload → page loads, edit, reload → edit kept; back online → synced
  > `e2e/offline.spec.ts`, all three browsers, real backend; a second browser sees the edit.
  > It found two app issues, both fixed:
  > - WebKit lost text typed just before a reload (IndexedDB writes are async and Safari kills
  >   the page first). Rows are now also backed up synchronously in localStorage until their
  >   write commits, and replayed on load if newer (`stores/pendingJournal.ts`).
  > - Offline, the indicator never counted pending changes (the engine returned before
  >   counting). It now updates the count without running a sync.
- [x] Lighthouse PWA check passes; keyboard-only walkthrough of the page and the panel
  > Lighthouse removed its PWA category (v12). Replaced by Chrome's own installability check
  > (`Page.getInstallabilityErrors` = none) in `e2e/pwa.spec.ts`, plus a keyboard-only e2e
  > (sign in, Tab to the page, type, split, Ctrl+Enter, Alt+↑, ↑/↓, Ctrl+. panel, Escape, nav).
  > It found a race: after Alt+↑ the editor re-focused the moved line when the write finished,
  > undoing a quick ↓. Now it only re-focuses if the focus was lost.

## Phase 13 — Hosting and release · **M6**

- [x] Amplify Hosting app connected to the repo, `amplify.yml` (pipeline-deploy + build), SPA rewrite
  > `amplify.yml` and `customHttp.yml` (cache headers) in the repo; console steps (connect the
  > repo, SPA rewrite) in `docs/06-hosting.md`. CI also runs lint and unit tests before the build.
- [x] Record the default URL in `notes.md`
  > https://main.d2s6xws9njiuy1.amplifyapp.com. Before the first green deploy: lock file rejected
  > by the build image's npm, `esbuild` missing for the branch backend's Lambda, and the AppSync
  > API quota full (details in `notes.md`).
- [ ] Release checks (CLAUDE.md *Workflow* 5) on the hosted URL, desktop + phone install
  > Done without an account: installable (no installability errors), deep links 200, offline
  > reload and offline deep link load the app. Pending: sign-up and the signed-in checks in
  > `docs/06-hosting.md`, desktop and phone install.

---

## Phase 14 — After release: completed, hidden, filters (v1.1)

Requests from the first days of real use (2026-11-17).

- [x] Completed tasks leave the page; a **Completed** page lists them by completion time
  > New field `Activity.completedAt` (schema, row type, docs). Old completed rows fall back to
  > `editedAt`. Page / Completed / Archived are tabs of the "Página" section (the main nav
  > lost "Archivadas", so it does not grow). Toast "Completada." with undo and rate replaces
  > "¿Cómo fue?". Gratitude entries stay in the journal, not in Completed.
- [x] Many completed tasks: the page store loads only live rows; the Completed page reads
  completed rows from IndexedDB while open and renders 50 at a time
  > Sync was already incremental (push dirty rows, pull `updatedAt ≥ lastPulledAt − 60 s`), so
  > old completed rows cost nothing per sync; only a new device's first pull grows (~5 MB a year
  > at 10 tasks a day). A device-side history window (fetch old ones online) only if needed.
- [x] Hide a line until a date and time (or until shown again); a **Hidden** tab lists every
  hidden line (manual and "done for this time") with "show now" / change date
  > Uses bacuy-x's `isHidden` (until shown again) and `hiddenUntil`; no schema change. Panel
  > section "Ocultar" (quick choices, date and time, until shown). The list below the page is
  > gone: the "Ocultas" tab shows the count instead. Found while testing: the e2e specs that
  > block AppSync with `page.route` leaked lines through the service worker (WebKit), and
  > Alt+↑ followed quickly by Ctrl+. could pull the focus out of the panel; both fixed.
- [x] Filter the page by flag (parent includes children; several = any of them; "no flag");
  a new line typed while filtered gets the filter's flag
  > A collapsible "Filtrar por bandera" row under the tabs (chips when on), so the page keeps
  > its height when unused. Kept per device. New and moved lines are placed in the whole page
  > after their visible predecessor; lines shown under a filter stay until it changes.
- [x] Autocomplete while typing: marks (`#flag`, `!type`, `@date`, `~frequency`, both languages)
  and earlier lines (page + completed; accepting copies the text)
  > Found while testing in English: a complete Spanish mark (`#salud`) was offered as `#health`
  > and Enter took it; a mark typed in full is now left alone and Enter makes a new line.
- [x] Enter at the start of a line inserts an empty line above (the line keeps its row and
  fields); Backspace into an empty line removes the empty one
- [x] In-app manual (`/help`): line types and their details, marks, statuses, screens, keys;
  the panel's Type field links to its entry
  > Built as a page inside the app rather than an external document: every user can reach it,
  > it works offline and follows the UI language.
- [x] Schedule picker for repeating lines: weekdays (weekly), day of the month or last day
  (monthly), optional time; writes `cron`, so a line done late does not drift
  > No schema change. Days 29–31 left out (cron skips shorter months); "last day" uses `L`.
- [x] Backups: point-in-time recovery and deletion protection on the hosted branch's tables
  (`amplify/backend.ts`); restore steps in `docs/06-hosting.md`
  > Found off on 2026-11-17 (no backups of any kind). Checked with a local `cdk synth` for both
  > deployment types: branch → both on; sandbox → unchanged.

---

## Later (not v1)

- Timer (`ActiveTime`, `FlagDailyStat`) and the neglect multiplier in the priority score.
- Location and environment boost.
- `suggestActivity` (AI) as an online-only action in the panel.
- Real-time subscriptions; per-field merge for counters (`completionCount`, `streak`).
- "Rename flag everywhere" (rewrite `#marks` in all lines).
