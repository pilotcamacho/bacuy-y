/**
 * Change notifications, no network (CLAUDE.md, "When sync runs").
 * - In this tab: the page store announces local writes (the sync engine schedules a push) and
 *   the engine announces finished syncs (the stores reload from IndexedDB).
 * - Other tabs: the same events go out on BroadcastChannel("bacuyy"); a tab receiving one
 *   reloads its stores from IndexedDB.
 */

export type AppEvent =
  | { type: "localWrite" } // rows were written to IndexedDB by a store
  | { type: "synced"; changed: boolean } // a sync run finished (changed = it wrote local rows)
  | { type: "signedOut" }; // the local data was wiped: other tabs reload

type Listener = (event: AppEvent, fromOtherTab: boolean) => void;

const CHANNEL = "bacuyy";
const listeners = new Set<Listener>();
let channel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel | null {
  if (channel || typeof BroadcastChannel === "undefined") return channel;
  try {
    channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = (e: MessageEvent<AppEvent>) => {
      if (e.data && typeof e.data === "object" && "type" in e.data) listeners.forEach((l) => l(e.data, true));
    };
  } catch {
    channel = null;
  }
  return channel;
}

export function emit(event: AppEvent): void {
  listeners.forEach((l) => l(event, false));
  try {
    getChannel()?.postMessage(event);
  } catch {
    // a closed channel: other tabs catch up on their next visibility change
  }
}

export function subscribe(listener: Listener): () => void {
  getChannel();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Tests. */
export function resetEventsForTests(): void {
  listeners.clear();
  channel?.close();
  channel = null;
}
