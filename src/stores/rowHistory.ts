import { create } from "zustand";
import { getDb } from "@/lib/db/instance";
import { subscribe } from "@/lib/events";
import { completedAtOf, completedRows } from "@/services/lifecycle/completed";
import type { RowCandidate } from "@/services/marks";

/**
 * Completed lines, for row suggestions while typing (docs/05-line-mapping.md §3). Completed
 * rows are not kept in the page store, so they are read from IndexedDB the first time a line
 * asks for suggestions, and again after a local write or a sync that changed rows.
 * Only the newest HISTORY_LIMIT are kept: enough to repeat what was done lately.
 */

export const HISTORY_LIMIT = 500;

interface RowHistoryState {
  completed: RowCandidate[];
  /** Read (or re-read) completed rows if they are not loaded or out of date. */
  ensure(): void;
}

let loaded = false;
let loading: Promise<void> | null = null;
let stale = false;
let unsubscribe: (() => void) | null = null;

export const useRowHistory = create<RowHistoryState>()((set) => {
  function read(): Promise<void> {
    stale = false;
    loading = getDb()
      .then((db) => db.listByIndex("Activity", "status", "COMPLETED"))
      .then((rows) => {
        loaded = true;
        set({
          completed: completedRows(rows)
            .slice(0, HISTORY_LIMIT)
            .map((r) => ({ id: r.id, rawInput: r.rawInput ?? "", at: completedAtOf(r) })),
        });
      })
      .catch((e) => console.error("[bacuyy] could not read completed lines for suggestions", e))
      .finally(() => {
        loading = null;
        if (stale) void read();
      });
    return loading;
  }

  return {
    completed: [],
    ensure() {
      unsubscribe ??= subscribe((event) => {
        if (event.type === "localWrite" || (event.type === "synced" && event.changed)) {
          if (loading) stale = true;
          else if (loaded) void read();
        }
        if (event.type === "signedOut") resetRowHistory();
      });
      if (!loaded && !loading) void read();
    },
  };
});

export function resetRowHistory(): void {
  unsubscribe?.();
  unsubscribe = null;
  loaded = false;
  stale = false;
  loading = null;
  useRowHistory.setState({ completed: [] });
}
