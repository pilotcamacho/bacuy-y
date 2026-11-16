# 01 — Stack

## React + Vite PWA + AWS Amplify Gen 2

| Layer | Technology | Rationale |
|---|---|---|
| Language | TypeScript (strict) | Same as bacuy-x; shared `Schema` types from `amplify/data/resource.ts` |
| UI framework | React 19 | Same mental model as bacuy-x (hooks, Zustand), so services port with few changes |
| Build | Vite | Fast dev server, first-class PWA plugin; no React Native layer needed for a web-only app |
| PWA | `vite-plugin-pwa` (Workbox `generateSW`) | Precached app shell → the app opens with no network, including a reload |
| Routing | React Router (data router, `createBrowserRouter`) | Plain SPA routes; Amplify Hosting rewrites to `/index.html` |
| State | Zustand | Same as bacuy-x; stores read/write `LocalDb` only |
| Local DB | IndexedDB via `idb` | Small typed wrapper, transactions, indexes; no ORM needed. Behind `LocalDb` so tests use `fake-indexeddb` |
| Sync | Own engine (`services/sync`) | Amplify Gen 2 has no DataStore; a small push/pull engine with last-edit-wins is simpler and testable |
| Backend | AWS Amplify Gen 2 (`@aws-amplify/backend`) | Same as bacuy-x, own app |
| API | AppSync + generated client (`aws-amplify/data`) | `list` for pulls; custom mutations with a JS pipeline resolver for upserts |
| Auth | Cognito, `aws-amplify/auth` (email + password) | Session cached in `localStorage` → works offline after one sign-in |
| Styling | Tailwind CSS 3, `darkMode: "class"` | Same utility style as bacuy-x's NativeWind classes |
| Drag & drop | `@dnd-kit/core`, `@dnd-kit/sortable` | Pointer, touch and keyboard sensors; accessible announcements |
| Ordering | `fractional-indexing` | Move one row without renumbering the others |
| IDs | `crypto.randomUUID()`, `uuid` (v5) | Offline creation; deterministic ids for rows two devices may create |
| Dates / cron | `date-fns`, `cron-parser` | Same as bacuy-x (priority score, gratitude schedule, cron preview) |
| i18n | `i18next`, `react-i18next`, `i18next-browser-languagedetector` | Same keys style as bacuy-x (`enumName.VALUE`) |
| Unit tests | Vitest + `fake-indexeddb` + Testing Library | Same runner for services, stores and components |
| Backend tests | `aws-sdk-client-mock`; AppSync `evaluateCode` for the resolver | Resolver logic tested without deploying |
| E2E | Playwright (Chromium + WebKit, one mobile viewport) | Offline mode via `context.setOffline(true)` |
| Hosting / CI | Amplify Hosting, default URL, `ampx pipeline-deploy` | Same account as the backend, no domain needed |

### Why not Expo / React Native Web (as in bacuy-x)?

The product is a PWA only. Vite + React gives a smaller bundle, a standard service worker setup
and direct DOM control for the line editor (caret, selection, paste), which react-native-web
makes harder. Pure logic (`services/priority`, lifecycle rules, gratitude) is ported from bacuy-x
as plain TypeScript.

### Why not Dexie / RxDB / Amplify DataStore?

- DataStore is Gen 1 and not available in Gen 2.
- RxDB brings its own replication protocol, which would need a custom AppSync adapter anyway.
- Dexie would work; `idb` is smaller and the `LocalDb` interface hides the choice (assumption —
  switching later touches only `src/lib/db/index.ts`).

## Packages

```
# app
npm install react react-dom react-router-dom zustand idb fractional-indexing uuid \
  @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities date-fns cron-parser \
  i18next react-i18next i18next-browser-languagedetector
npm install --save-exact aws-amplify

# backend
npm install --save-dev --save-exact @aws-amplify/backend @aws-amplify/backend-cli
npm install --save-dev aws-cdk-lib constructs @aws-appsync/utils

# build / tests
npm install --save-dev vite @vitejs/plugin-react vite-plugin-pwa typescript \
  tailwindcss@3 postcss autoprefixer vitest jsdom fake-indexeddb \
  @testing-library/react @testing-library/user-event aws-sdk-client-mock \
  @aws-sdk/client-appsync @playwright/test @types/uuid
```

## Scripts (package.json)

| Script | Command |
|---|---|
| `dev` | `vite` (no service worker; use `preview` to test offline) |
| `build` | `tsc --noEmit && vite build` |
| `preview` | `vite preview --port 4173` |
| `test` | `vitest run` |
| `test:integration` | `vitest run --project integration` (needs a sandbox; skipped otherwise) |
| `e2e` | `playwright test` (builds and serves `preview`) |
| `sandbox` | `ampx sandbox --identifier bacuyy-dev` |

## Browser support

Last 2 versions of Chrome, Edge, Firefox, Safari (macOS + iOS 16.4+). Requirements used:
IndexedDB, Service Worker, `navigator.locks`, `BroadcastChannel`, `crypto.randomUUID`.
`navigator.locks` is missing in old Safari: fall back to a `localStorage` lease lock
(assumption; check in Phase 7).
