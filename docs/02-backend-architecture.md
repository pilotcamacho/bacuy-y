# 02 — Backend & Sync Architecture

## Overview

```
┌──────────────────────────── Browser (PWA) ─────────────────────────────┐
│                                                                         │
│  React UI (Page, Panel, Priority, Flags, Journal…)                      │
│        │ read / write (never waits for network)                         │
│        ▼                                                                │
│  Zustand stores ──► LocalDb (IndexedDB "bacuyy")  ◄── other tabs        │
│                          ▲        │              BroadcastChannel       │
│                          │        │ dirty rows                          │
│                   pull / reconcile ▼                                    │
│                  services/sync (push → pull, navigator.locks)           │
│                          │                                              │
│  Service worker (Workbox): app shell + assets precached                 │
└──────────────────────────┼──────────────────────────────────────────────┘
                           │ HTTPS (only when online + signed in)
                           ▼
              AWS AppSync (GraphQL, Cognito user pool auth)
              ├─ upsertActivity / upsertFlag / upsertActivityFlag / upsertFeedback
              │     → pipeline JS resolver: upsert.js + upsertResult.js
              └─ list queries (generated) for the pull
                           │
                           ▼
              DynamoDB: Activity, Flag, ActivityFlag, Feedback (owner-scoped)

  Cognito user pool (email + password)    Amplify Hosting (default URL, SPA rewrite)
```

No Lambda functions, no S3, no Bedrock. One Amplify Gen 2 app of its own (not bacuy-x's).

---

## 1. Auth

- `amplify/auth/resource.ts`: `defineAuth({ loginWith: { email: true } })`.
- `amplify/data/resource.ts`: `defaultAuthorizationMode: "userPool"`; every model
  `allow.owner()`; upsert mutations `allow.authenticated()` (the resolver enforces ownership).
- Client: `Amplify.configure(outputs)` in `src/lib/amplify.ts` with the default
  `localStorage` token store, so a cached session survives offline reloads.
- Auth guard: `fetchAuthSession()` only when online; otherwise `getCurrentUser()` from the cached
  tokens. If there is a cached user, the app opens. If not, the sign-in screen shows "you need a
  connection to sign in the first time" when offline.
- `sync_meta.ownerSub` ≠ the signed-in `sub` → wipe IndexedDB before loading (another user).

---

## 2. Upsert resolver (last edit wins)

Pipeline of two AppSync JS functions, shared by the four mutations (each mutation binds them to
its own table as the data source).

The code lives in `amplify/data/upsert.js` (step 1: one conditional `UpdateItem`) and
`amplify/data/upsertResult.js` (step 2: `{ applied, item }`); the comments at the top of each
file are the specification. Summary:

- Condition: `attribute_not_exists(id) OR (owner = :owner AND editedAt < :editedAt)`.
- `owner = ctx.identity.sub` (the stored format, verified 2026-11-14); `owner`, `createdAt`,
  `updatedAt`, `__typename` in the arguments are ignored.
- `SET createdAt = if_not_exists(createdAt, :now)`, `updatedAt = :now`.
- A `null` argument is `REMOVE`d (DynamoDB rejects NULL for GSI keys such as `status`,
  `parentId`); an argument that is not sent is left untouched.
- `ConditionalCheckFailedException` is not an error: step 2 reads the stored row
  (`consistentRead`) and returns `{ applied: false, item }`, or *unauthorized* if the row
  belongs to someone else. When applied, step 2 returns early (`runtime.earlyReturn`) without
  touching DynamoDB.

Checked with `aws appsync evaluate-code` (APPSYNC_JS 1.0.0) and unit tests with a fake
`@aws-appsync/utils` (`tests/backend/upsertResolver.test.ts`); real DynamoDB behavior with the
DEV self-test / `npm run test:integration`.

Guarantees:

- A write only lands if the row is new, or it belongs to the caller **and** its `editedAt` is
  strictly newer. An older edit that arrives late is rejected and the caller gets the newer row.
- `owner` never comes from the client. Trying to upsert an id owned by someone else returns
  *unauthorized* (it is not leaked as `applied: false`).
- The response always carries the server row, so the client also learns `updatedAt` (used for
  the clock-offset estimate).

---

## 3. Push

`src/services/sync/push.ts`

```
for model in [Flag, Activity, ActivityFlag, Feedback]:          // parents first
  rows = LocalDb.dirty(model) sorted by editedAt asc
  for row in rows (concurrency 4):
    sent = row.editedAt
    try:
      { applied, item } = await upsert(model, toArgs(row))
      if applied:  LocalDb.clearDirtyIf(model, row.id, sent)     // only if editedAt unchanged
      else:        LocalDb.mergeFromServer(model, item)          // server newer: later editedAt kept
      clock.observe(item.updatedAt, requestStartedAt, responseAt)
    catch e:
      backoff.fail(model, row.id); continue                      // stays dirty, others go on
```

- `clearDirtyIf` runs in one IndexedDB transaction: read row, compare `editedAt`, write.
- `applied: false` merges instead of overwriting, so an edit made during the request (newer
  than the server's row) survives and is pushed next time.
- A network or auth error stops the push at once (the next rows would fail the same way) and
  does not count against the rows' backoff.
- A child pushed before its parent is fine for DynamoDB (no foreign keys); ordering only keeps
  list views on other devices consistent.
- Backoff per row: 2 s, 4 s, 8 s… capped at 5 min, reset on success. After 3 consecutive failed
  sync runs the indicator shows `error`.

## 4. Pull

`src/services/sync/pull.ts`

```
for model in [Flag, Activity, ActivityFlag, Feedback]:
  since = lastPulledAt[model] − 60 s          (absent → full pull)
  startedAt = server-corrected now
  page through client.models[model].list({ filter: { updatedAt: { ge: since } }, limit: 500, nextToken })
    for remote in page:
      local = LocalDb.get(model, remote.id)
      if !local or remote.editedAt >= local.editedAt:  LocalDb.putFromServer(model, remote)  // tie → server
      else: keep local (it is dirty and will be pushed)
      if model == Activity: changed.add(remote.id)
  lastPulledAt[model] = startedAt             (only after the whole model is committed)
reconcile(changed)
```

The 60 s overlap covers server clock skew between AppSync resolvers; re-applying a row is
idempotent.

## 5. Reconcile

`src/services/sync/reconcile.ts`. For each activity id in `changed`:

1. Parse `rawInput` with the **current** flag set.
2. Compare with the stored text-owned fields and live `ActivityFlag` rows.
3. Write differences as normal local edits (`dirty = 1`, new `editedAt`): create/revive or
   soft-delete `ActivityFlag` rows (deterministic ids), fix `title`, `activityType`, dates,
   `frequency`, and the `DRAFT ↔ ACTIVE` rule.

Also run after a pull that changed any `Flag` (a flag created on another device can resolve
existing `#marks`), on every line of the page.

Normally there is nothing to fix (the device that edited the text already derived the fields).
Differences appear when two devices edited the text and the flags of a line separately.

## 6. Engine

`src/services/sync/syncEngine.ts` (no React).

- `requestSync(reason)`: if offline or no valid session → set state `offline` and return.
  Otherwise `navigator.locks.request("bacuyy-sync", { ifAvailable: true }, run)`. If the lock is
  busy (this tab or another), set `pending = true`; when the current run ends, run once more.
- `run`: push → pull → reconcile → purge tombstones (`deletedAt` older than 30 days and not
  dirty) → `BroadcastChannel("bacuyy").postMessage({ type: "synced" })` → state `synced`.
- Triggers: start after auth, `visibilitychange` → visible, `online`, 3 s after the last local
  write (debounced) while online, "sync now", and every 5 min while visible (assumption).
- `offline` events and failed fetches set the state `offline`; `navigator.onLine === true` is a
  hint only — the real test is the request.
- Token refresh failure (`NotAuthorizedException`): state `error` with "sign in again" in the
  indicator tooltip; local editing continues.

## 7. Clock offset

`src/services/sync/clock.ts`: for each **applied** upsert response,
`sample = serverUpdatedAt − (requestStart + responseEnd) / 2`. Keep the median of the last 10
samples in `sync_meta.clockOffsetMs` (stored as `{ v: 2, ms }`).
A refused upsert (`applied: false`) is never sampled: it returns the stored row, whose
`updatedAt` is the time of an older write (found by the two-browser e2e on 2026-11-15: a
device learned −43 min from refused default-flag seeds and lost every conflict). Offsets
stored in the old bare-number format are ignored on load. `now()` everywhere in the app =
`Date.now() + clockOffsetMs`. Only `editedAt` depends on it.

## 8. Multi-tab

- Every store write posts `{ type: "changed", model, ids }` on `BroadcastChannel("bacuyy")`.
  Other tabs re-read those rows from IndexedDB.
- The line being edited in another tab: if a broadcast changes the focused line's `rawInput`, the
  local input keeps its text until blur, then the newer `editedAt` wins as usual. (assumption)
- Only one tab syncs at a time (the lock).

## 9. Service worker / PWA

- `vite-plugin-pwa`, `generateSW`, `registerType: "autoUpdate"`, `navigateFallback: "/index.html"`,
  `globPatterns: ["**/*.{js,css,html,svg,png,ico,webmanifest,woff2}"]`.
- No runtime caching of AppSync or Cognito requests (data lives in IndexedDB; auth must hit the
  network).
- New version: the SW activates on the next load; a toast (`pwa.updated`) says so.

## 10. Deploy

- Backend: `npx ampx sandbox --identifier bacuyy-dev` during development; Amplify Hosting
  branch `main` runs `ampx pipeline-deploy` + `npm run build` (`amplify.yml`).
- Rewrite rule: `</^[^.]+$|\.(?!(css|gif|ico|jpg|js|png|txt|svg|woff2?|ttf|map|json|webmanifest)$)([^.]+$)/>` → `/index.html` (200).
- `amplify_outputs.json` is generated by the pipeline before `vite build` and imported by
  `src/lib/amplify.ts`.

## 11. Security notes

- Every model is owner-scoped; reads through generated `list` are filtered by owner by AppSync.
- Upserts check ownership in the condition and in `upsertResult.js`.
- No secrets in the bundle (`amplify_outputs.json` only has public ids).
- Signing out wipes IndexedDB (after confirming if dirty rows exist) and `bacuyy_*` keys that
  hold user data (settings like locale and theme stay).
