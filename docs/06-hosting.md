# Hosting (Phase 13)

The app is hosted on **AWS Amplify Hosting**, deployed from the GitHub repo. Each push to `main`
runs `amplify.yml`:

1. **Backend:** `npx ampx pipeline-deploy` deploys this branch's own backend (Cognito user pool,
   AppSync API, DynamoDB tables) and writes `amplify_outputs.json`.
2. **Frontend:** lint, unit tests, `npm run build` (type check + Vite + service worker). The
   `dist/` folder is published. A failing test stops the deploy.

The hosted backend is **separate from the sandbox** (`npm run sandbox`, used for development,
the integration tests and the e2e suite). Accounts and data do not carry over: sign up again
on the hosted app.

## One-time setup (AWS console)

1. Push the repo to GitHub (private is fine).
2. AWS console → **Amplify** → *Create new app* → **GitHub** → authorize AWS Amplify for the
   repo (you can limit it to this repo) → pick the repo and branch `main`.
3. Amplify detects `amplify.yml` and a Gen 2 backend. Keep the defaults. If it asks for a
   service role, let it create one.
4. *Save and deploy*. The first deploy takes ~10 minutes (it creates the backend stack).
5. **Hosting → Rewrites and redirects → Manage → Open text editor**, add this rule (single-page
   app: every route without a file extension serves the app), then Save:

   ```json
   [
     {
       "source": "</^[^.]+$|\.(?!(css|gif|ico|jpg|js|png|txt|svg|woff|woff2|ttf|map|json|webmanifest)$)([^.]+$)/>",
       "target": "/index.html",
       "status": "200",
       "condition": null
     }
   ]
   ```

   Or from a terminal: `aws amplify update-app --app-id <appId> --custom-rules file://rules.json`
   with that rule first and Amplify's default `/<*>` → `404-200` rule after it.

   Once installed, the service worker serves every route offline on its own
   (`navigateFallback`); this rule covers the first visit and deep links.
6. Response headers come from `customHttp.yml` in the repo (no console step). Check under
   **Hosting → Custom headers** that they were picked up.
7. Copy the default URL (`https://main.<appId>.amplifyapp.com`) into `docs/notes.md`.

## Release checks (CLAUDE.md, Workflow 5)

On the hosted URL:

- [ ] Sign up, confirm the email code, sign in. Default flags appear.
- [ ] Type a few lines, reload: kept. Sync indicator: synced.
- [ ] DevTools → Network → Offline, reload: the page loads; edit, reload: the edit is kept.
      Back online: synced.
- [ ] Desktop install (Chrome/Edge: the install icon in the address bar, or Settings →
      "Instalar la app"). The app opens in its own window.
- [ ] Phone install: Android Chrome → menu → *Instalar app*; iPhone Safari → Share →
      *Añadir a pantalla de inicio*. Open it in airplane mode after one online visit.
- [ ] A second device sees the lines after sync.
- [ ] Push a small change: the open app shows "Hay una versión nueva" → Actualizar.

## Backups (DynamoDB)

Set in `amplify/backend.ts`, for the hosted branch only (sandboxes are throwaway):

- **Point-in-time recovery** on `Activity`, `Flag`, `ActivityFlag` and `Feedback`: any second of
  the last 35 days can be restored. The window starts when it is first deployed; nothing before
  that can be recovered. Cost: about $0.20 per GB-month of table data.
- **Deletion protection** on the same tables: they cannot be deleted, also not by removing the
  branch or the app in Amplify. To really remove them, set it to `false` in `backend.ts` and
  deploy first.

Check: `aws dynamodb describe-continuous-backups --table-name Activity-<apiId>-NONE`
(`<apiId>` is the AppSync API of the `main` branch: `lia5vfiy7rfulcliiqlicqceey`).

**Restoring** (rare, by hand). PITR restores into a **new** table; the app keeps using the old
one, so rows are copied back:

1. DynamoDB console → the table → *Backups* → *Restore to point in time* → a time before the
   problem → a new table name (e.g. `Activity-restore-2026-11-20`).
2. Pick the rows to bring back from the restored table and write them into the live table with
   `editedAt` (and `updatedAt`) set to **now**. Sync is "last edit wins" (CLAUDE.md rule 10):
   with their old `editedAt` the devices' newer copies or tombstones would win again and undo
   the restore. With `editedAt` = now, the next pull on every device takes them.
3. Delete the restored table when done.

Every signed-in device also keeps a full copy in its browser (IndexedDB), but that copy syncs,
so it is not a backup: a bad change reaches every device.

## Costs

Amplify Hosting bills build minutes and served data; Cognito, AppSync and DynamoDB (on-demand)
bill per use. For one user this stays within or close to the free tier. To remove everything:
Amplify console → the app → *Delete app* (also deletes the branch backend).
