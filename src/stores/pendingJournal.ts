import type { Stored } from "@/lib/db/types";
import { kvGetJson, kvRemove, kvSetJson } from "@/lib/kv";

/**
 * A synchronous backup of activity rows not yet committed to IndexedDB (text in its debounce,
 * or a write still in flight). IndexedDB writes are asynchronous, and Safari kills a page that
 * is reloaded or closed before they commit; localStorage writes are synchronous and survive.
 * On load, a backed-up row newer than the stored one is written again. Cleared per row once
 * its IndexedDB write is done, and on sign out / another user.
 */
type Activity = Stored<"Activity">;

export const PENDING_KEY = "pendingRows";

export function readPending(): Record<string, Activity> {
  return kvGetJson<Record<string, Activity>>(PENDING_KEY, {});
}

export function journalPut(rows: Activity[]): void {
  if (rows.length === 0) return;
  const pending = readPending();
  for (const row of rows) pending[row.id] = row;
  kvSetJson(PENDING_KEY, pending);
}

/** Drops the backups these written rows cover (a newer edit typed meanwhile stays). */
export function journalClear(rows: Pick<Activity, "id" | "editedAt">[]): void {
  const pending = readPending();
  let changed = false;
  for (const row of rows) {
    const entry = pending[row.id];
    if (entry && entry.editedAt <= row.editedAt) {
      delete pending[row.id];
      changed = true;
    }
  }
  if (!changed) return;
  if (Object.keys(pending).length === 0) kvRemove(PENDING_KEY);
  else kvSetJson(PENDING_KEY, pending);
}

export function journalReset(): void {
  kvRemove(PENDING_KEY);
}

/** Backed-up rows that are newer than (or missing from) what IndexedDB returned. */
export function rowsToReplay(stored: Record<string, Pick<Activity, "editedAt">>): Activity[] {
  return Object.values(readPending()).filter((row) => {
    const current = stored[row.id];
    return !current || row.editedAt > current.editedAt;
  });
}
