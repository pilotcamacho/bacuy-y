# Project Brief

> The only document written by hand. It says **what** the app does in plain language.
> `CLAUDE.md` and `docs/` say **how**.
> Status: product decisions confirmed 2026-11-13. *(assumed)* marks values not yet confirmed.

## 1. Identity

- **App name:** bacuy-y
- **Repo name:** bacuy-y
- **One-sentence pitch:** bacuy-x as a blank page: each line you type is an activity, with
  bacuy-x's types, flags and lifecycle behind it, and it works with no connection.
- **Form factor:** progressive web app (PWA), installable on desktop and phones. No native app.
- **Sibling project:** `C:\Users\pilot\Documents\FERNANDO\Documentos_Apps\bacuy-x` (React Native).
  Same data model, different way to enter data.

## 2. Who uses it and why

The bacuy-x user, when they want to capture and organize activities as fast as typing in a notes
app: no forms, no menus, no AI round trip. A typical session: open the page, type a few lines,
add `#salud` or `!hábito` to some of them, tick one off, drag another to the top, close the tab.
Often with no connection.

## 3. Core concepts (entities)

| Entity | What it is | Key fields | Types / variants |
|---|---|---|---|
| Activity | One line of the page | rawInput (the line as typed), title (without marks), type, status, position (page order), type-specific fields | ACTION, REPETITIVE_ACTION, HABIT, ATTITUDE, SKILL, MOMENTO, GRATITUDE, EXPIRATION |
| Flag | Weighted category in a tree | name, parent, weight (siblings sum to 100), color | 5 system defaults + user flags |
| ActivityFlag | Activity ↔ Flag link | activityId, flagId | none |
| Feedback | How an activity went | rating 1–5, emotion (valence, arousal), notes | none |

Relationships: an Activity has many Flags (through ActivityFlag) and many Feedbacks. A Flag has
a parent Flag (optional) and children.

## 4. Main screens / features

- **The page** (home): a full-screen list of plain text lines, like a text editor. Enter = new
  line, Backspace on an empty line = delete it, paste several lines = several activities. Each
  line has a tick, a drag handle and a ⋯ button that opens the side panel.
- **Marks** in the text: `#flag`, `!type`, `@date`, `~frequency`. Recognized marks are
  highlighted; unknown ones are underlined as a warning.
- **Side panel** per line: type, status, flags, type-specific fields, description, feedback.
- **Priority view**: the same activities sorted by bacuy-x's priority score. Read-only order.
- **Flags**: the weighted flag tree (create, rename, reweight, recolor, delete).
- **Journal**: completed gratitude entries, newest first.
- **Archived**: archived activities, with "restore".
- **Settings**: language, theme, gratitude schedule, sync now, sign out.
- Small sync status indicator (synced / syncing / offline / error).
- Auth: sign in / sign up / confirm / forgot password.

## 5. Rules and behavior

- Each line of text corresponds to exactly one Activity row in the database.
- **Works fully offline (most important).** Every edit is saved in the browser right away. A
  reload with no network opens the app and the data.
- Sign in once while online. After that the app works offline and syncs whenever a connection is
  available. When connected, local changes are pushed and remote changes are pulled. Conflicts:
  the most recent edit of a row wins.
- Order on the page is manual (drag, or Alt+↑/↓).
- A new line is a draft. It becomes active when it gets its first flag.
- Ticking a line does what bacuy-x does for its type (complete an action, count a repetition,
  grow a habit streak, open the gratitude notes…).
- Flag weights under the same parent must sum to 100.
- A gratitude entry is created automatically on the schedule set in Settings.
- Deletes are soft (tombstones) so they reach other devices.
- Its own backend: data is **not** shared with the bacuy-x app.
- Web is served from the default Amplify Hosting URL (no custom domain yet).

## 6. AI assistance (optional)

- None in v1. (bacuy-x's `suggestActivity` could be added later as an online-only extra.)

## 7. Device features (optional)

- [ ] Notifications / reminders
- [ ] Location / geofencing
- [ ] Photos / files stored in the cloud
- [ ] Timers / time tracking
- [x] Offline storage (IndexedDB) and a service worker that caches the app
- [x] Installable (web app manifest)

## 8. Languages

- **Default locale:** es
- **Other locales:** en

## 9. Out of scope for v1

- Timer (`ActiveTime`, `FlagDailyStat`) and the neglect boost that depends on it.
- Snooze / hide UI (the fields exist and sync, there is no UI).
- Location and environment (`EnvironmentState`, `KnownPlace`).
- AI suggestions, media uploads (`mediaUrls` has no UI), notifications.
- Several pages per user, sharing, real-time subscriptions, rich text.
- Sharing data with the bacuy-x app.
