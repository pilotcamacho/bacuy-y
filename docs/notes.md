# Dev Notes

## Sandbox backend

```
npx ampx sandbox --identifier bacuyy-dev
```

Keep the identifier stable: it names the cloud resources. `amplify_outputs.json` is regenerated
on every deploy and imported by `src/lib/amplify.ts`.

- Stack: `amplify-bacuyy-bacuyydev-sandbox-7f46bbc1e9`, region `us-east-1`
- AppSync API id / DynamoDB table suffix: `w3hviq5snrgxhpa3a4m75wsjvi` → tables
  `Activity-…-NONE`, `Flag-…-NONE`, `ActivityFlag-…-NONE`, `Feedback-…-NONE`
- Cognito user pool `us-east-1_2VeuQ7rkr`; the app client only allows SRP + refresh
  (`ALLOW_USER_SRP_AUTH`), so scripted sign-ins must use SRP (e.g. `aws-amplify/auth` in Node)
- The AWS account has many other Amplify projects' tables: always filter by the API id
- Stored `owner` format, verified 2026-11-14 with the DEV owner probe: **just the Cognito `sub`**
  (`14b83488-…-cefb7b703fd9`), not `sub::username`. With email login, Gen 2 users get
  `username = sub`, and the stored value has no `::` part. `upsert.js` must write the same:
  `owner = ctx.identity.sub` (keep a test that fails if Amplify starts writing `sub::username`;
  the generated owner read rule accepts both forms).
- Test user in the sandbox pool: one confirmed account (`username` = `sub`).

## Sandbox quirks

- `ampx sandbox --once` once hung at "Synthesizing backend…" for 10+ minutes. Kill the
  `ampx` node processes and rerun (normal synth: ~20 s, deploy: ~2–4 min).
- Resolver code can be checked without deploying:
  `aws appsync evaluate-code --runtime name=APPSYNC_JS,runtimeVersion=1.0.0 --code file://amplify/data/upsert.js --function request --context file://ctx.json`

## Line editor rendering (textarea over mirror)

- The textarea's text is transparent; the visible text is the mirror `<div>` underneath. So
  the textarea must **never** paint an opaque background or selection color: a focus
  background on it hid the line being typed (fixed 2026-11-14, regression test in
  `tests/components/lineEditor.test.tsx`). Focus background goes on the wrapper; the selection
  color is translucent.

## Line endings

- The Write tool on this Windows machine wrote CRLF, and Python `open(..., "w")` translates
  LF to CRLF too. On 2026-11-14 every source file was normalized to LF. Scripts that edit
  files must use `newline=""` (Python) to keep LF.

## Page store

- `load()` must never set `status: "loading"` once the page is on screen: that unmounts every
  line (lost keystrokes). A second call (e.g. the signed-in user became known) only seeds the
  missing default flags and reconciles.

## Test account and e2e (2026-11-14)

- Credentials live in `.env.test.local` (git-ignored, template `.env.test.local.example`),
  loaded by `vite.config.ts` (`test.env`) and `playwright.config.ts` with `loadEnv("test", …,
  "BACUYY_TEST_")`. Not `VITE_*`, so never in the app bundle. Claude does not open the file.
- `tests/setup.ts` must not touch `window` / `localStorage` at load: the integration tests run
  in the node environment.
- Since sync exists, every e2e run with the account pulls the lines of earlier runs. The
  editor specs block `**/graphql` so they start on an empty page. The first run (before the
  block) left lines in the test account's cloud data; harmless, the Phase 8 sync spec cleans
  up after itself.
- Safari / WebKit does not focus a button on click: after the tick, the line's textarea is
  focused again explicitly (otherwise Ctrl+. and typing went nowhere).
- WebKit drag: one long `mouse.move` after `mouse.down` was sometimes lost. The spec moves
  8 px first (activation), then to the target, and waits for the transform before dropping.

## Clock offset bug (2026-11-15)

- Refused upserts return the stored row; its `updatedAt` is old. Sampling it gave a device a
  −43 min offset, so its edits (and deletes) looked old and lost conflicts. Fixed: only applied
  upserts are sampled; offsets stored before the fix are ignored. Lines edited by an affected
  browser before the fix may carry `editedAt` in the past; harmless, the next edit fixes it.
- The test account still has leftover lines from runs made before the fix ("pan  leche",
  "llamar al banco", "a", "b", "c", one `sync-… desde A`). Delete them by hand if they bother.

## Environment

- Windows 11, Node 24.13, npm 11.6. Playwright browsers live in `%LOCALAPPDATA%\ms-playwright`
  (`npx playwright install chromium webkit` once per machine).
- TypeScript 6: `baseUrl` is not needed for `paths`; the `@/` alias is also set in `vite.config.ts`.
- jsdom has no `matchMedia`; `tests/setup.ts` stubs it (light scheme).

## Running the app

```
npm run dev        # Vite dev server, no service worker
npm run build      # type check + production build → dist/
npm run preview    # serves dist/ with the service worker (use this to test offline)
```

## Testing offline

- DevTools → Network → **Offline**, then reload. Only works on `npm run preview` or the hosted
  build (the dev server has no service worker).
- Inspect local data: DevTools → Application → IndexedDB → `bacuyy`.
- Simulate two devices: two browser profiles (or a normal + a private window) signed in to the
  same account.
- Playwright: `context.setOffline(true)`.

## Tests

```
npm test                                                             # unit (integration skipped)
$env:BACUYY_TEST_EMAIL="…"; $env:BACUYY_TEST_PASSWORD="…"; npm run test:integration   # PowerShell, real sandbox
npm run e2e
```

## Web hosting

Amplify Hosting, default URL: `{{https://main.<appId>.amplifyapp.com — fill in after Phase 13}}`.

## Changes ported from bacuy-x

Record here every model change copied from bacuy-x (date, bacuy-x change, what changed here).

| Date | bacuy-x change | bacuy-y change |
|---|---|---|
| 2026-11-13 | (baseline) models as of this date | `Activity`, `Flag`, `ActivityFlag`, `Feedback` + enums copied; `position`, `editedAt`, `deletedAt` added; `ActiveTime`, `FlagDailyStat`, `EnvironmentState`, `KnownPlace`, `suggestActivity`, `create/updateFlagValidated` left out |

## Known discrepancies in bacuy-x (do not copy)

- `bacuy-x/docs/03-data-schema.md` lists 5 default flags (weights 20); the code
  (`services/flags/seedDefaultFlags.ts`) seeds 7 roots (`errand` 10, the rest 15) + 3 children
  of `income`. bacuy-y follows the code.

## Flags screen (Phase 9)

- Flag writes are serialized in `flagStore` and each one reads the stored flags inside the
  queue. Validating against the in-memory list raced: a second "add" submitted before the
  first finished saw no siblings, so both got weight 100 (found by the WebKit e2e).
- The "add flag" input is cleared on submit, not after the save, so keys typed meanwhile
  start the next name (they used to be appended: "NataciónCorrer"). The add form stays open
  after adding; Esc closes it and returns the focus to its "+" button.
- Siblings are listed heaviest first, then by stored name (system flags by key, not by the
  translated label).

## Feedback and gratitude (Phase 10)

- The star radios are `sr-only` (absolutely positioned): their `<label>` must be `relative`,
  or the hidden input sits outside the panel and focusing it scrolls the panel away
  (Playwright reported "outside of the viewport").
- Gratitude tests build windows with local-time `Date`s: the cron runs in local time, so an
  ISO literal like `…T20:30Z` is not "after 20:00" on every machine.
- `e2e` drag on WebKit: the line had visibly reached the top but dropped one row short.
  WebKit's last coalesced mouse move can leave dnd-kit's "over" target behind; the spec now
  waits for real travel and makes one more small move before releasing.

## Priority and archived views (Phase 11)

- `services/priority/score.ts` is bacuy-x's formula with each weight divided by its siblings'
  real sum (rule 11). With sums of 100 the numbers match bacuy-x's tests exactly. No neglect
  multiplier, no environment boost (they need the timer and location).
- Expirations use `lifecycle/tick.daysUntil` (calendar days), so the priority view and the
  line's badge never disagree about "vence en N días" / the renewal lead.
- The page store's `flags` are full `FlagRow`s. `refresh()` replaces them when any `editedAt`
  or weight changed, but only re-derives the lines when names or the tree changed.
- "Go to the line" = `setFocus(id, len)` then navigate to `/`: the focus request survives the
  route change and the line focuses itself when it mounts.
- Vitest `testTimeout` is 20 s. Under the full parallel run (26 jsdom files) the auth tests,
  which type character by character, could pass 5 s; a timed-out test keeps typing into the
  next test's DOM and makes that one fail too ("an@oepxeample.com").

## Duplicated flags from an adopted local database (found while testing Phase 11)

- Symptom: every default flag shown twice. The browser's IndexedDB held rows of two owners:
  the test account (used in this browser before the owner check existed) and the real user.
  When the real user signed in, no `ownerSub` was recorded yet, so `ensureOwner` adopted the
  old data ("first"), and the real user's own defaults were seeded next to the test account's.
  The server was never affected (`allow.owner()`; upserts of another owner's rows are refused,
  so 6 of those rows stayed dirty and retried on every sync).
- Fix: `LocalDb.purgeForeign(ownerSub)` deletes local rows whose `owner` is another user (rows
  without an owner, i.e. not pushed yet, are kept). `ensureOwner` runs it on every start and
  returns `"cleaned"` when it removed something; the Layout then resets the stores.

## "Done for this time" for repetitive tasks and habits (requested 2026-11-15)

- The tick on `REPETITIVE_ACTION` / `HABIT` also sets `hiddenUntil` (an existing bacuy-x field,
  so no schema change and it syncs). `pageLines(activities, now)` leaves those lines out;
  `hiddenLines` lists them; `nextReveal` gives the soonest return for the page's timer.
- The store's own `lines()` uses the real clock, the rendered page its `now` state (moved on by
  a timer to the soonest `hiddenUntil`, and on `visibilitychange`). They can differ for a few
  ms at the moment a line comes back; harmless.
- A new line can get the same position as a hidden one: the editor already tolerates equal
  positions (`compareLines` ties by id, `positionAfter` skips equal neighbours). The first line
  typed into an empty-looking page goes after every row, hidden ones included.
- Reaching `targetCount` completes the series instead of hiding it. A habit reaching
  `targetStreak` shows the "formed?" hint (it is hidden too).

## PWA (Phase 12)

- Icons: edit `public/icon.svg`, then `node scripts/icons.mjs` (needs `npx playwright install`).
- No service worker in `npm run dev`; test PWA behavior with `npm run build && npm run preview`
  (or the Playwright suite, which does that).
- Lighthouse 12+ has no PWA category. Installability is checked with Chrome's DevTools API
  (`Page.getInstallabilityErrors`) in `e2e/pwa.spec.ts`.
- `npm audit` reports issues in `@aws-amplify/backend*` / form-generator / workbox-build
  dependencies (handlebars, lodash, glob…). All are build/deploy tooling run locally; none is
  in the browser bundle. Revisit when Amplify updates them.
- Safari and IndexedDB: a write started right before a reload or tab close can be lost, even
  after blur. `stores/pendingJournal.ts` keeps a synchronous localStorage copy of each row
  until its write commits; `load()` replays copies newer than the stored row. Cleared on sign
  out and when another user signs in.
- The sync engine, when the browser is offline, does not run but still refreshes the pending
  count, so "N cambios sin subir" shows offline.

## Hosting (Phase 13)

- Setup steps and release checks: `docs/06-hosting.md`.
- Default URL: https://main.d2s6xws9njiuy1.amplifyapp.com (Amplify app id `d2s6xws9njiuy1`,
  us-east-1). First green deploy: build 5, 2026-11-16.
- `amplify.yml` installs Node 24 (`nvm install 24`) to match local development; Vite 8 needs
  Node ≥ 20.19 and the Amplify image's default may be older.
- The SPA rewrite lives in the Amplify app settings, not the repo (applied with
  `aws amplify update-app --custom-rules`, see `docs/06-hosting.md`); headers live in
  `customHttp.yml`. Amplify's default rule alone (`/<*>` → 404-200) made deep links
  redirect to `/priority/` and answer 404.
- Third Amplify failure: `The service limit for number of GraphQL APIs has been reached`
  (AppSync, 50 per region, quota `L-4DFA3D2F`). The account had 50 APIs in us-east-1, mostly old
  sandboxes; fixed by deleting unused apps. Raise the quota if it happens again.
- The hosted branch has its own backend, separate from the sandbox: e2e and integration tests
  keep using the sandbox's `amplify_outputs.json`.
- First Amplify build failed at `npm ci`: the build image's npm (11.19) found the lock file out
  of sync (optional `@emnapi/*`, `@opentelemetry/core`, `semver`), while local npm 11.6 accepted
  it. Fixed by regenerating it with npm 11.19 **in a folder without `node_modules`**
  (`npx npm@11.19.1 install --package-lock-only`), then `npx npm@11.19.1 ci` here. Generated on
  top of an existing `node_modules`, or touched again by `npm install` with npm 11.6, the lock
  goes back to the rejected form. Until the local npm is updated (`npm install -g npm@11.19.1`),
  change dependencies with `npx npm@11.19.1 install <pkg>` and check with
  `npx npm@11.19.1 ci --dry-run --ignore-scripts` in a copy before pushing.
- Second Amplify failure: `pipeline-deploy` → `spawnSync docker ENOENT`. The branch backend adds a
  construct the sandbox does not (`branch_linker_construct`, a `NodejsFunction`), and CDK bundles
  it with the project's top-level `esbuild`, falling back to Docker if missing (esbuild was only
  nested under `tsx`). Fixed with `esbuild` as a dev dependency, pinned to 0.28.x (Vite 8's
  optional peer range is `^0.27 || ^0.28`).
- Running `npm install` on top of an existing `node_modules` rewrites the lock file into a form
  npm 11.19 rejects, with either npm version. Generate lock changes in an empty folder
  (`--package-lock-only`), verify with `ci --dry-run` there, then copy the lock back.

## After release (Phase 14)

- Playwright: requests that go through a service worker skip `page.route` (seen in WebKit).
  Specs that block AppSync to test the editor alone use `test.use({ serviceWorkers: "block" })`;
  without it, a test's lines reached the cloud test account and another test pulled them.
- After Alt+↑/↓ the editor re-focuses the moved line when its write finishes only if nothing
  has focus. Checking "not a textarea" was wrong: the panel's text field is an `<input>`, so
  Ctrl+. right after a move lost the panel's focus on slow devices.
- The test account in the sandbox may hold lines leaked by the old page specs (before the fix
  above). Harmless: the page specs never sync; sync/offline specs clean up their own rows.

- **`ActivityType.GROCERY` is bacuy-y only** (2026-11-24, the Mercado tab). Adding an enum value
  is additive (nothing existing changes). If bacuy-x ever adds a shopping type, align the name.
  `completedAt` on a `GROCERY` row means "last bought" (its status never becomes `COMPLETED`, so
  the Completed page, which reads by status, never lists it).

- **iOS Safari zooms in on a focused form field under 16px.** The line panel focuses its text field on open, so on an iPhone the page zoomed and the panel looked wider than the screen (Close cut off). `src/index.css` sets form fields to at least 16px on touch screens (`pointer: coarse`); Android never zoomed.
