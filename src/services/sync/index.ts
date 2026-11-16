import { getDb } from "@/lib/db/instance";
import { emit, subscribe } from "@/lib/events";
import { useSyncStore } from "@/stores/syncStore";
import { defaultLock } from "./lock";
import type { Remote } from "./remote";
import { createSyncEngine, type SyncEngine } from "./syncEngine";

/**
 * The app's single sync engine, started by the signed-in layout and stopped on sign out.
 * The transport is loaded lazily so the AppSync client is never built before Amplify is
 * configured (and tests can run the app without it).
 */

let engine: SyncEngine | null = null;
let unsubscribe: (() => void) | null = null;

async function loadRemote(): Promise<Remote> {
  return (await import("./appsyncRemote")).appsyncRemote;
}

/** A Remote that loads the real one on first use. */
const lazyRemote: Remote = {
  upsert: async (model, row) => (await loadRemote()).upsert(model, row),
  list: async (model, since, token) => (await loadRemote()).list(model, since, token),
};

export function startSync(canSync: () => boolean, remote: Remote = lazyRemote): SyncEngine {
  if (engine) return engine;
  const e = createSyncEngine({
    db: getDb,
    remote,
    lock: defaultLock(),
    canSync,
    onState: (s) => useSyncStore.getState().set(s),
    onSynced: (changed) => emit({ type: "synced", changed }),
  });
  unsubscribe = subscribe((event, fromOtherTab) => {
    if (event.type === "localWrite" && !fromOtherTab) e.notifyLocalWrite();
  });
  engine = e;
  e.start();
  return e;
}

/** Stops the triggers; the returned promise waits for a run already in progress. */
export function stopSync(): Promise<void> {
  const e = engine;
  e?.stop();
  unsubscribe?.();
  engine = null;
  unsubscribe = null;
  return e?.idle() ?? Promise.resolve();
}

export function syncNow(): Promise<void> {
  return engine?.requestSync("manual") ?? Promise.resolve();
}
