import { MODELS, type LocalDb } from "@/lib/db/types";
import { loadClockOffset, now } from "./clock";
import type { SyncLock } from "./lock";
import { pull } from "./pull";
import { Backoff, push } from "./push";
import { reconcile } from "./reconcile";
import { classifyError, type Remote } from "./remote";

/**
 * The sync engine (docs/02-backend-architecture.md §6). No React.
 * One run = push → pull → reconcile → purge tombstones. Runs never overlap, in this tab or
 * across tabs (the lock); triggers that arrive during a run are coalesced into one follow-up.
 * Failures are retried silently; the state becomes `error` only after repeated failures.
 */

export type SyncStatus = "synced" | "syncing" | "offline" | "error";

export interface SyncSnapshot {
  status: SyncStatus;
  /** Why the status is `error`: the session needs a new sign-in, or calls keep failing. */
  reason: "auth" | "failures" | null;
  lastSyncedAt: string | null;
  /** Local rows not pushed yet. */
  dirty: number;
}

export interface SyncEngineDeps {
  db: () => Promise<LocalDb>;
  remote: Remote;
  lock: SyncLock;
  /** A signed-in user (cached session). Without one the engine does nothing. */
  canSync: () => boolean;
  isOnline?: () => boolean;
  onState?: (snapshot: SyncSnapshot) => void;
  /** After every run; `changed` = the run wrote local rows (the stores should reload). */
  onSynced?: (changed: boolean) => void;
}

export const FAILURES_BEFORE_ERROR = 3;
export const LOCAL_WRITE_DELAY_MS = 3_000;
export const PERIODIC_MS = 5 * 60_000;
export const TOMBSTONE_DAYS = 30;
const RETRY_BASE_MS = 2_000;
const RETRY_MAX_MS = 5 * 60_000;

export interface SyncEngine {
  /** Runs a sync now, or joins / follows the one in progress. Resolves when it is done. */
  requestSync(reason?: string): Promise<void>;
  /** A store wrote rows: sync a few seconds after the last such write. */
  notifyLocalWrite(): void;
  /** Wires the browser triggers (visible, online, periodic) and runs a first sync. */
  start(): void;
  stop(): void;
  /** Resolves when no run is queued or in progress. */
  idle(): Promise<void>;
  snapshot(): SyncSnapshot;
}

export function createSyncEngine(deps: SyncEngineDeps): SyncEngine {
  const isOnline = deps.isOnline ?? (() => globalThis.navigator?.onLine !== false);
  const backoff = new Backoff();
  let state: SyncSnapshot = { status: "synced", reason: null, lastSyncedAt: null, dirty: 0 };
  let running = false;
  let followUp = false;
  let queued: Promise<void> | null = null;
  let failures = 0;
  let clockLoaded = false;
  let stopped = true;
  let writeTimer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let periodic: ReturnType<typeof setInterval> | null = null;
  const cleanups: (() => void)[] = [];

  function setState(patch: Partial<SyncSnapshot>) {
    state = { ...state, ...patch };
    deps.onState?.(state);
  }

  function scheduleRetry() {
    if (retryTimer || stopped) return;
    const delay = Math.min(RETRY_BASE_MS * 2 ** Math.max(failures - 1, 0), RETRY_MAX_MS);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void requestSync("retry");
    }, delay);
  }

  async function runOnce(db: LocalDb): Promise<boolean> {
    if (!clockLoaded) {
      await loadClockOffset(db);
      clockLoaded = true;
    }
    setState({ status: "syncing" });
    try {
      const pushed = await push(db, deps.remote, backoff);
      const fatal = pushed.errors.find((e) => e.kind === "network" || e.kind === "auth");
      if (fatal) throw fatal;

      const pulled = await pull(db, deps.remote);
      const fixed = await reconcile(db, pulled.flagsChanged ? null : pulled.changedActivities);
      const cutoff = new Date(now() - TOMBSTONE_DAYS * 86_400_000).toISOString();
      for (const model of MODELS) await db.purgeTombstones(model, cutoff);

      failures = pushed.failed > 0 ? failures + 1 : 0;
      const dirty = await db.countDirty();
      setState({
        status: failures >= FAILURES_BEFORE_ERROR ? "error" : "synced",
        reason: failures >= FAILURES_BEFORE_ERROR ? "failures" : null,
        lastSyncedAt: new Date(now()).toISOString(),
        dirty,
      });
      if (pushed.failed > 0) scheduleRetry();
      deps.onSynced?.(pulled.written + fixed + pushed.rejected > 0);
      // Reconcile edits are ordinary local edits: push them in the follow-up run.
      return fixed > 0;
    } catch (e) {
      const err = classifyError(e);
      const dirty = await db.countDirty().catch(() => state.dirty);
      if (err.kind === "network") {
        setState({ status: "offline", reason: null, dirty });
      } else if (err.kind === "auth") {
        setState({ status: "error", reason: "auth", dirty });
      } else {
        failures++;
        const isError = failures >= FAILURES_BEFORE_ERROR;
        setState({ status: isError ? "error" : state.lastSyncedAt ? "synced" : "offline", reason: isError ? "failures" : null, dirty });
        scheduleRetry();
      }
      deps.onSynced?.(false);
      return false;
    }
  }

  function requestSync(_reason?: string): Promise<void> {
    if (!deps.canSync()) return Promise.resolve();
    if (!isOnline()) {
      setState({ status: "offline", reason: null });
      // No run, but the indicator still says how many changes wait to be uploaded.
      return deps
        .db()
        .then((db) => db.countDirty())
        .then((dirty) => setState({ dirty }))
        .catch(() => {});
    }
    if (running) {
      followUp = true;
      return queued ?? Promise.resolve();
    }
    if (queued) return queued;
    queued = deps.lock
      .run(async () => {
        running = true;
        try {
          const db = await deps.db();
          let again = await runOnce(db);
          let extra = 0;
          while ((followUp || again) && extra < 3 && isOnline() && deps.canSync()) {
            followUp = false;
            extra++;
            again = await runOnce(db);
          }
          followUp = false;
        } finally {
          running = false;
        }
      })
      .finally(() => {
        queued = null;
      });
    return queued;
  }

  function notifyLocalWrite() {
    if (stopped) return;
    if (writeTimer) clearTimeout(writeTimer);
    writeTimer = setTimeout(() => {
      writeTimer = null;
      void requestSync("localWrite");
    }, LOCAL_WRITE_DELAY_MS);
  }

  function start() {
    if (!stopped) return;
    stopped = false;
    const doc = globalThis.document;
    const win = globalThis.window;
    if (doc && win) {
      const onVisible = () => {
        if (doc.visibilityState === "visible") void requestSync("visible");
      };
      const onOnline = () => void requestSync("online");
      const onOffline = () => setState({ status: "offline", reason: null });
      doc.addEventListener("visibilitychange", onVisible);
      win.addEventListener("online", onOnline);
      win.addEventListener("offline", onOffline);
      cleanups.push(
        () => doc.removeEventListener("visibilitychange", onVisible),
        () => win.removeEventListener("online", onOnline),
        () => win.removeEventListener("offline", onOffline),
      );
      periodic = setInterval(() => {
        if (doc.visibilityState === "visible") void requestSync("periodic");
      }, PERIODIC_MS);
    }
    void requestSync("start");
  }

  function stop() {
    stopped = true;
    cleanups.splice(0).forEach((fn) => fn());
    for (const t of [writeTimer, retryTimer]) if (t) clearTimeout(t);
    if (periodic) clearInterval(periodic);
    writeTimer = retryTimer = null;
    periodic = null;
  }

  return { requestSync, notifyLocalWrite, start, stop, idle: () => queued ?? Promise.resolve(), snapshot: () => state };
}
