# bacuy-y

> **Status: v1 spec, product decisions confirmed** (see *Decisions* at the end). Items marked
> **(assumption)** are technical defaults. Change them in `PROJECT_BRIEF.md` and this file will
> be updated to match.

## Description

bacuy-y is the **text-page version of bacuy-x**
(`C:\Users\pilot\Documents\FERNANDO\Documentos_Apps\bacuy-x`). It is a **progressive web app
(PWA)**, not a native app. It looks and feels like a blank page in a plain text editor: the user
opens it and types. **Each line of text is one bacuy-x `Activity`**, stored as one row. There are
no creation forms: you create, edit and delete activities by editing text (Enter for a new line,
Backspace on an empty line to delete it). Lines can also be **dragged** to reorder them.

Behind the text, the data has the same structure as bacuy-x: activity types, a hierarchical
weighted flag tree, statuses, type-specific fields, feedback. Short **marks** typed in the line
(`#health`, `!habit`, `@friday`) fill those fields, and a **side panel** per line edits the rest.

The app is **offline-first, and that is the most important requirement**. Every edit is saved in
the browser (IndexedDB) right away and works with no connection, including reloading the page.
When the browser is online, local changes sync to the cloud database and changes from the user's
other browsers and devices are pulled in.

Built with **React + Vite + TypeScript** as a PWA, and **AWS Amplify Gen 2** as the backend. The
backend is **its own Amplify app** (not shared with bacuy-x) whose schema copies bacuy-x's models,
plus the fields that ordering and offline sync need.

The app is **multilingual**. Supported locales:
- `es`: Spanish (default)
- `en`: English

All UI strings, date/time formatting and user-facing labels go through the i18n layer.
Hard-coded user-facing strings in components are not allowed. (This applies to app chrome. The
user's own line text is never translated. Mark keywords are accepted in both languages.)

---

## Relationship with bacuy-x

| | bacuy-x | bacuy-y |
|---|---|---|
| Form factor | React Native app (iOS/Android) | PWA in the browser, installable |
| Entry | Quick capture + AI + forms | Plain text lines + marks + side panel |
| Order | Computed priority | Manual (drag), plus a read-only priority view |
| Connectivity | Online (AppSync directly) | Offline-first (IndexedDB + sync engine) |
| Backend | Its own Amplify app | Its own Amplify app, **same models** + sync fields |
| v1 features | Everything below | Lines, types, flags + weights, feedback, gratitude journal |

Models copied from bacuy-x: `Activity`, `Flag`, `ActivityFlag`, `Feedback` and their enums.
Not in v1 (same shape as bacuy-x when added): `ActiveTime` + `FlagDailyStat` (timer),
`EnvironmentState` + `KnownPlace` (location), the AI suggestion query, S3 media, notifications,
snooze UI. `Activity` keeps every bacuy-x field even when v1 has no UI for it, so the schema
stays aligned.

When bacuy-x changes a copied model, port the change here too (schema + IndexedDB upgrade + docs).

---

## Domain

### Entities

| Entity | Description |
|---|---|
| `Activity` | One line of the page. All bacuy-x fields (`title`, `activityType`, `status`, `cron`, type-specific fields…), plus `position` (fractional index, page order), `editedAt` and `deletedAt` (sync). `rawInput` holds the line **exactly as typed**, marks included. `title` is the same text with the marks removed. |
| `Flag` | Hierarchical category with a `weight` (siblings sum to 100), as in bacuy-x. System defaults per user: 7 roots + 3 children of `income` (see `docs/03-data-schema.md`). |
| `ActivityFlag` | Join row Activity ↔ Flag. Derived from the line's `#flag` marks. |
| `Feedback` | Rating, emotion and notes logged on an activity (usually when it is ticked done). |

v1 has **one page per user**: all of the user's non-deleted, non-archived activities sorted by
`position`. The full mapping between text and data is in `docs/05-line-mapping.md`.

### Rules

1. **One line = one `Activity` row.** The page is never stored as a text blob. Every visible line
   has an `Activity`, and every non-deleted, non-archived `Activity` is one visible line, except
   a hidden line: a repetitive task or habit ticked "done for this time" (hidden until
   `hiddenUntil`, its next occurrence), or a line hidden by hand from the panel (until a date
   and time, or until shown again: `isHidden`). The **Hidden** tab lists them.
2. **The device is the source of truth for the UI.** Screens read and write only IndexedDB,
   through the stores. They never wait for the network. No user action is ever blocked or rolled
   back because the device is offline.
3. **IDs are created on the device** (`crypto.randomUUID()`), so a row created offline keeps the
   same `id` locally and in DynamoDB. Rows that two devices could create independently use
   **deterministic ids** (UUID v5): default flags, `ActivityFlag` pairs, auto-created gratitude
   entries. That way both devices create the same row instead of a duplicate.
4. **Ordering uses fractional indexes** (`fractional-indexing`). Inserting between A and B gives
   `generateKeyBetween(A.position, B.position)`. Dragging or Alt+↑/↓ changes only the moved row.
5. **Editing behavior:**
   - *Enter* in the middle of a line splits it: the current activity keeps the text before the
     cursor, and a new activity (type `ACTION`, status `DRAFT`) gets the text after it.
   - **Fast hide:** swiping a line right (touch), Ctrl+Shift+H or its ☾ button hides it until
     tomorrow 8:00 (this morning before 03:00); a longer swipe or Ctrl+Shift+Alt+H opens a
     "hide until…" picker. Swiping left does nothing.
   - A **"+ Añadir renglón"** button under the page adds an empty line at the end and focuses
     it (or focuses the last line if it is already empty).
   - *Enter* at the end of a line inserts an empty line below and focuses it. *Enter* at the
     start of a non-empty line inserts an empty line above; the line keeps its row and the caret.
   - *Backspace* at the start of a line merges it into the line above (the line above keeps its
     id and fields; the current activity is soft-deleted), except into an empty line, which is
     removed instead.
   - While typing, an autocomplete list suggests marks (`#` `!` `@` `~`, both languages) and
     earlier lines (page + completed) that start the same; accepting a line copies its text.
   - Pasting multi-line text creates one activity per line.
   - ↑/↓ moves focus between lines; Alt+↑/↓ moves the line; each line also has a **drag handle**
     (mouse drag, touch long-press, keyboard via @dnd-kit).
   - A tick at the start of each line completes the activity, with type-specific behavior
     (see `docs/05-line-mapping.md`). Ctrl/Cmd+Enter does the same. A completed line leaves the
     page for the **Completed** page (newest first, by `completedAt`); unticking it there puts it
     back at its old place.
   - Ctrl/Cmd+. (or the ⋯ button on the line) opens the **side panel** for that line.
   - **Plain text only**, plus marks. Nothing is rendered as markdown or links. A line never
     contains a newline.
   - The page always shows at least one line so there is somewhere to type.
6. **Marks** (parsed on the device, no network): `#flag`, `!type`, `@date`, `~frequency`. The text
   is authoritative for the fields that have a mark. Editing such a field in the panel rewrites the
   mark in the text. Fields without a mark (description, cron, affirmation…) are edited in the
   panel only. Full grammar: `docs/05-line-mapping.md`.
7. **Status:** a new line is `DRAFT`. It becomes `ACTIVE` when it gets its first flag (bacuy-x
   rule: an active activity has at least one flag). Removing all flags returns an `ACTIVE`,
   uncompleted activity to `DRAFT`. Ticking and the panel move it to `COMPLETED`, `INACTIVE` or
   `ARCHIVED` as in bacuy-x. Completed and archived activities leave the page (the "Completed"
   and "Archived" tabs list them).
8. **Saving:** text changes are written to IndexedDB after a short debounce (≈300 ms) and on blur
   or when the page is hidden. Structural changes (insert, delete, merge, tick, drag, panel edits)
   are written immediately.
9. **Deletes are soft.** A deleted row gets `deletedAt` and stays so the deletion reaches other
   devices. Synced tombstones older than 30 days are purged locally (assumption). Deleting a line
   is not archiving: archived activities still exist; deleted ones are gone.
10. **Conflicts: the last edit wins, per row** (see *Offline & Sync*). Every local change sets
    `editedAt = now()` on that row. When two devices changed the same row, the version with the
    later `editedAt` is kept everywhere. Nothing is merged inside a row.
11. **Flag weights:** siblings must sum to 100. The flag editor enforces it before saving. The
    server does **not** reject writes (an offline edit cannot be rolled back), so after a merge the
    sums can drift. The priority score normalizes each weight by its siblings' sum, and the flag
    screen shows a warning until the user fixes it.

---

## Offline & Sync

The core of the app.

### Local storage

IndexedDB through `idb`, database `bacuyy`, versioned upgrades. One object store per synced model:
`activities`, `flags`, `activityFlags`, `feedbacks`. Each row mirrors its Amplify model field for
field, plus the local-only field `dirty` (has local changes not yet pushed). Indexes: `dirty` on
every store, plus `position` (activities), `activityId` and `flagId` (activityFlags), `activityId`
(feedbacks), `parentId` (flags).

Store `sync_meta` (key/value): `lastPulledAt` per model, `ownerSub` (the signed-in user, so a
different user on the same browser starts clean), `clockOffsetMs`.

Stores and `services/sync/*` use the `LocalDb` interface (`lib/db/types.ts`), never `idb`
directly. Its contract tests run against `fake-indexeddb`.

### Push (local → cloud)

1. Pick every dirty row of every model, oldest `editedAt` first. Parents before children:
   flags → activities → activityFlags → feedbacks.
2. For each row, call that model's custom mutation (`upsertActivity`, `upsertFlag`,
   `upsertActivityFlag`, `upsertFeedback`). They all share one two-step AppSync **JS pipeline
   resolver** (`amplify/data/upsert.js` + `upsertResult.js`, no Lambda) that does one
   conditional DynamoDB write:
   - condition `attribute_not_exists(id) OR (owner = :owner AND editedAt < :editedAt)`, so the
     server keeps whichever version was edited last, even when an older edit arrives later;
   - it sets `owner` from `ctx.identity` (never from arguments), keeps `createdAt` on overwrite
     (`if_not_exists`) and sets `updatedAt` to server time;
   - if the condition fails, it returns the current server row with `applied: false` instead
     of an error.
3. Result `applied: true`: clear `dirty` **only if** the local `editedAt` has not changed since
   the push started. That way an edit made during the push is not lost.
   Result `applied: false`: the server's row is newer. Overwrite the local row with it and clear
   `dirty`.
4. Check every response's `errors`. A failing row stays dirty and is retried with exponential
   backoff. One bad row never blocks the others.

### Pull (cloud → local)

1. For each model: `client.models.X.list({ filter: { updatedAt: { ge: lastPulledAt − 60 s } },
   nextToken })`, paginated until exhausted.
2. For each remote row, keep the version with the later `editedAt` (tie → server). A newer remote
   row overwrites the local one and clears `dirty`; a newer local row is kept and pushed next time.
3. Save each model's new `lastPulledAt` only after its whole pull is committed.
4. **Reconcile marks:** for every activity changed by the pull, re-derive its `ActivityFlag` rows
   and marked fields from `rawInput` (the text is authoritative). Differences become ordinary
   local edits and are pushed on the next sync.

### When sync runs

- On start (after auth), when the tab becomes visible (`visibilitychange`), when the browser comes
  back online (`online` event), a few seconds after the last local edit while online, and on the
  manual "sync now".
- The order is always **push, then pull**. Only one sync runs at a time across all tabs
  (`navigator.locks.request("bacuyy-sync", …)`). Triggers that arrive mid-sync are coalesced into
  one follow-up run.
- After a local write or a sync, the tab posts on `BroadcastChannel("bacuyy")` and the other tabs
  reload their stores from IndexedDB.
- Real-time AppSync subscriptions are out of scope for v1.

### Clock caveat

"Last edit" is judged by each device's clock. A device whose clock is badly wrong can win or lose
conflicts it shouldn't. Accepted for v1. Mitigation (assumption): estimate the device's offset
from the server's `updatedAt` on each upsert, keep it in `sync_meta`, and use
`editedAt = Date.now() + clockOffset`.

Counters (`completionCount`, `streak`) live inside the activity row, so two offline devices that
both tick the same habit keep only one increment. Accepted for v1 (noted in the plan).

### UI

- A small, unobtrusive sync indicator: `synced` / `syncing` / `offline` / `error`. Labels from
  i18n keys `sync.SYNCED`, `sync.SYNCING`, `sync.OFFLINE`, `sync.ERROR`.
- Never show a blocking error for sync. Failures are retried silently; the indicator shows
  `error` only after repeated failures.

### Auth and offline

- The user must sign in (Cognito, email + password) once while online. After that the app opens
  and works fully offline. Amplify keeps the session in `localStorage` and refreshes tokens when
  back online. The auth guard decides from the cached session, never from a network call.
- If the token cannot be refreshed, local editing still works. Sync pauses until the user signs
  in again.
- Signing out asks for confirmation if dirty rows exist (they would be lost), then wipes IndexedDB.
- `navigator.storage.persist()` is requested once after sign-in, so the browser does not evict
  IndexedDB (which would lose unsynced lines).

---

## PWA

- Vite build with `vite-plugin-pwa` (Workbox `generateSW`): precaches the app shell and every
  built asset with revisioned URLs, `navigateFallback: "/index.html"`, `clientsClaim`. A new
  deploy shows a translated "new version available" toast (`registerType: "prompt"`, not
  `autoUpdate`: updating first saves text still in its debounce, then reloads).
- Pending activity rows are also backed up synchronously in `localStorage` until their IndexedDB
  write commits (`stores/pendingJournal.ts`): Safari kills a closing page before async writes
  finish. On load, a backup newer than the stored row is written again.
- `amplify_outputs.json` is **imported into the bundle** at build time, so it is versioned with
  the code and a stale service worker cache can never pair old code with a new backend.
- Web app manifest (name, icons 192/512 + maskable, `display: "standalone"`, theme colors for light
  and dark) so the app installs on desktop and on phones ("Add to Home Screen").
- Hosting: AWS Amplify Hosting, same AWS account as the backend, on the **default Amplify URL**
  (`https://<branch>.<appId>.amplifyapp.com`). SPA rewrite of all routes to `/index.html`.
- Layout: the page is a centered column (`max-w-2xl`) on wide screens and full width on phones.
  The side panel is a right-hand drawer on wide screens and a bottom sheet on phones. Hover and
  focus styles for lines, the tick and the drag handle. Keyboard-only use must work.

---

## Localization

- Library: `i18next` + `react-i18next` + `i18next-browser-languagedetector`.
- Translation files: `src/locales/<code>.json`, one per supported locale, identical key sets
  (enforced by `tests/i18n/locales.test.ts`).
- The locale is detected from the browser. The user can override it in Settings (persisted in
  `localStorage` with the key prefix `bacuyy_`).
- Enum display values use keys `enumName.VALUE` (`activityType.HABIT`, `status.ACTIVE`,
  `sync.OFFLINE`). Never render raw enum values. Default flag names use `flag.<key>`.
- Mark keywords (`!hábito` / `!habit`, `@mañana` / `@tomorrow`…) are accepted in **both** languages
  regardless of the UI locale. Keyword lists live in `src/services/marks/keywords.ts`, not in the
  locale files.
- Dates/numbers: `Intl.DateTimeFormat` / `Intl.NumberFormat` with the active locale.
- Layout must not hard-code LTR assumptions.

---

## Data Schema

Defined in `amplify/data/resource.ts` (source of truth). The full description, access patterns
and business rules are in `docs/03-data-schema.md`. Client types come from
`import type { Schema } from "../amplify/data/resource"`.

The local stores (`src/lib/db/`) must stay field-compatible with the models. Any schema change
updates, in the same change: `amplify/data/resource.ts`, the IndexedDB version upgrade,
`docs/03-data-schema.md`, and (if the change came from bacuy-x) a note in `docs/notes.md`.

---

## Project Structure

```
bacuy-y/
├── amplify/
│   ├── auth/resource.ts
│   ├── data/resource.ts          ← bacuy-x models + sync fields + upsert mutations (source of truth)
│   ├── data/upsert.js            ← AppSync JS pipeline (conditional write + result), shared
│   ├── data/upsertResult.js        by all upsert mutations
│   └── backend.ts
├── public/                       ← icons, robots.txt (manifest is generated by vite-plugin-pwa)
├── src/
│   ├── main.tsx                  ← Amplify config, i18n, router, SW registration
│   ├── routes/                   ← auth/*, Page, PriorityView, Archived, Flags, Journal, Settings,
│   │                               Help (the in-app manual: keep it in step with docs/05)
│   ├── components/               ← LineEditor, LineRow, LinePanel, FeedbackForm, FlagTree,
│   │                               SyncIndicator, … (PascalCase.tsx, named exports)
│   ├── hooks/                    ← useAuth, useTheme, useOnline
│   ├── lib/
│   │   ├── amplify.ts, client.ts, i18n.ts, kv.ts (localStorage), ids.ts (uuid v4/v5)
│   │   └── db/                   ← types.ts (LocalDb), index.ts (IndexedDB via idb)
│   ├── services/
│   │   ├── editor/               ← pure line edits: split, merge, paste, move, positions
│   │   ├── marks/                ← parse/serialize marks, keywords (es + en)
│   │   ├── lifecycle/            ← tick behavior per activity type, status rules
│   │   ├── priority/             ← score.ts ported from bacuy-x (no environment, no neglect)
│   │   ├── flags/                ← default flags (deterministic ids), weight checks
│   │   ├── gratitude/            ← auto-create journal entries (deterministic ids)
│   │   └── sync/                 ← push.ts, pull.ts, reconcile.ts, syncEngine.ts, clock.ts (no React)
│   ├── stores/                   ← pageStore, flagStore, feedbackStore, syncStore, settingsStore
│   └── locales/                  ← es.json, en.json
├── tests/                        ← Vitest (unit + gated integration)
├── e2e/                          ← Playwright specs
└── docs/                         ← 01-stack, 02-backend-architecture, 03-data-schema,
                                    04-implementation-plan, 05-line-mapping, notes.md
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| App | React 19 + TypeScript (strict) + Vite |
| Form factor | PWA: `vite-plugin-pwa` (Workbox) + web app manifest |
| Backend | AWS Amplify Gen 2 (own app, bacuy-x models) |
| Auth | Amazon Cognito (email + password), `aws-amplify/auth` |
| API | AWS AppSync (generated typed client) + one shared JS resolver for upserts |
| Database | Amazon DynamoDB (one table per model, owner-scoped) |
| Local database | IndexedDB via `idb`, behind `LocalDb` |
| Routing | React Router |
| State | Zustand |
| UI | Tailwind CSS 3 (`dark:` variants, class strategy) |
| Drag & drop | `@dnd-kit/core` + `@dnd-kit/sortable` (mouse, touch, keyboard) |
| Ordering | `fractional-indexing` |
| IDs | `crypto.randomUUID()`; `uuid` v5 for deterministic ids |
| Dates / cron | `date-fns`, `cron-parser` (as in bacuy-x) |
| Localization | i18next + react-i18next + i18next-browser-languagedetector |
| Tests | Vitest, `fake-indexeddb`, `aws-sdk-client-mock`, Playwright |
| Hosting / CI | AWS Amplify Hosting (default URL), `ampx pipeline-deploy` |

Not used: Amplify DataStore (Gen 1, not in Gen 2), Expo / React Native, S3, Bedrock, Lambda
functions, web push notifications, geolocation.

---

## Conventions

These adapt the expo-amplify-kit conventions to a web-only app.

- **Strings:** every user-visible string via `t("…")`. Add the key to *every* locale file in the
  same change.
- **Colors:** Tailwind classes with `dark:` variants. Theme tokens (`src/hooks/useTheme.ts`) only
  where a raw color is needed (canvas, meta theme-color).
- **Data access:** only `services/sync/*` imports `lib/client.ts`. Every call checks `errors`
  and throws: `if (errors?.length || !data) throw new Error(errors?.[0]?.message ?? "x failed")`.
- **Lists:** always paginate `list()` with `nextToken` until exhausted.
- **Stores:** read and write `LocalDb` only. Derived lists (page order, priority list, journal) are
  pure functions used inside `useMemo`, never selectors that return new arrays.
- **Device-local settings** (locale, theme, gratitude schedule): `lib/kv.ts` (`localStorage`,
  wrapped in try/catch) with the key prefix `bacuyy_`. Data rows and `lastPulledAt` live in IndexedDB.
- **Offline first, always:** a feature is not done until it works with DevTools → Offline after a
  reload.
- **Testability:** interactive elements that E2E specs touch get a `data-testid`
  (`line-row-<index>`, `line-done-<index>`, `line-handle-<index>`, `line-more-<index>`, `line-panel`,
  `sync-indicator`, `flag-weight-<id>`, `flags-save-<parentId|root>`, `flags-drift`, `feedback-prompt`, `feedback-form`,
  `feedback-list`, `journal-entry`, `priority-item-<rank>`, `priority-more-<rank>`, `archived-item-<index>`,
  `archived-restore-<index>`, `archived-delete-<index>`, `hidden-toast`, `hidden-count`, `hidden-list`, `hidden-item-<index>`, `hidden-change-<index>`, `hidden-more-<index>`,
  `panel-hidden`, `panel-hide-preset-<later|tomorrow|monday|nextMonth>`, `panel-hide-custom`, `panel-hide-custom-apply`,
  `panel-hide-indefinite`, `flag-filter`, `flag-filter-toggle`, `flag-filter-option-<flagId|none>`,
  `flag-filter-chip-<flagId|none>`, `flag-filter-clear`, `line-add`, `line-hide-<index>`, `line-swipe-<index>`,
  `hide-picker`, `hide-picker-preset-<preset>`, `hide-picker-cancel`, `suggestions`, `suggestion-<index>`, `help`, `help-type-<TYPE>`, `panel-type-help`, `schedule-picker`, `schedule-day-<0-6>`,
  `schedule-monthday`, `schedule-time`, `review-prompt`, `review-good`, `review-bad`, `spacing-override`,
  `panel-review`, `panel-review-next`,
  `hidden-show-<index>`, `hidden-search`, `hidden-search-count`, `hidden-search-empty`, `update-prompt`, `install-section`, `line-tabs`, `completed-toast`, `completed-list`,
  `completed-item-<index>`, `completed-reopen-<index>`, `completed-more-<index>`, `completed-delete-<index>`,
  `completed-delete-confirm-<index>`, `completed-show-more`).
- **Packages:** `npm install <pkg>`. Pin exact versions for `aws-amplify` and `@aws-amplify/backend`.

### Deviations from the kit and from bacuy-x

- Web only (Vite), no Expo. The kit's Expo-specific skills (scaffold, screens, EAS release) do not
  apply; `amplify-backend`, `zustand-stores` and `testing-strategy` do, with the changes below.
- Screens → store → `LocalDb`. A separate sync engine handles `LocalDb` ↔ AppSync.
- Writes go through the `upsert*` mutations, never `client.models.X.create/update/delete`, so the
  server can enforce "last edit wins". Reads use `client.models.X.list`.
- **Creates are local and immediate**, with client-generated ids. **No snapshot/rollback**: a local
  write is final, and a failed push is retried, never undone. `MutationErrorBanner` is not used.
- bacuy-x's `createFlagValidated` / `updateFlagValidated` Lambda is **not** ported: weights are
  validated in the app (rule 11).
- `rawInput` means "the line as currently typed", not "the text at creation".
- Unticking a completed `ACTION` (on the Completed page) reactivates it (bacuy-x treats
  completion as one-way).
- `Activity.completedAt` (not in bacuy-x): when it was completed, for the Completed page.
- `Activity.reviewStep` (not in bacuy-x): attitudes and skills use **spaced review** (tick →
  Bien / Mal → hidden 1 day … 6 months, adapting; Bien on the last step completes it) instead of
  a frequency. See `docs/05-line-mapping.md` §4.

## Workflow

1. Work phase by phase from `docs/04-implementation-plan.md`.
2. A phase is done when `npx tsc --noEmit` passes, `npm test` passes, and its checklist items are
   ticked (`[x]`) with a short note under any item that deviated from the plan.
3. Record every non-obvious fix or environment quirk in `docs/notes.md` or as an indented note in
   the plan.
4. Sync logic needs tests for: push upsert, an older edit rejected (`applied: false`) and replaced
   locally, the dirty-flag race (edit during push), pull where the local edit is newer vs older,
   ties, tombstones beating and losing to edits, pagination, mark reconciliation after pull,
   deterministic ids colliding on purpose (two devices seeding default flags), sync running twice
   concurrently (the cross-tab lock), and an upsert refusing to overwrite another owner's row.
5. Web checks per release: `npm run build` succeeds, the Playwright suite passes, and the built app
   loads and edits with the network disabled (DevTools → Offline) after one online visit.

---

## Decisions

Confirmed 2026-10-27 (still valid): done tick per line, one page per user, sign in once online
then offline + sync, last edit wins per row, plain text, default Amplify Hosting URL.

Confirmed 2026-11-13:

| Topic | Decision |
|---|---|
| Form factor | Progressive web app only (no iOS/Android app) |
| Data model | Same models as bacuy-x (`Activity`, `Flag`, `ActivityFlag`, `Feedback`) |
| Backend | Its own Amplify app with the same schema (data not shared with bacuy-x) |
| Structured fields | Marks in the text (`#flag`, `!type`, `@date`, `~frequency`) + a side panel per line |
| Order | Manual order (drag) on the page + a read-only priority view |
| v1 features | Lines, types and lifecycle, flags + weights, feedback, gratitude journal |
| Most important | Works offline (including a reload with no network) |
