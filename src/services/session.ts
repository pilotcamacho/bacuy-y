import { getDb } from "@/lib/db/instance";
import type { LocalDb } from "@/lib/db/types";
import { emit } from "@/lib/events";
import { kvGet, kvSet } from "@/lib/kv";
import { journalReset } from "@/stores/pendingJournal";

/**
 * The local database belongs to one user (CLAUDE.md, "Auth and offline").
 * - `prepareSession`: before the page loads or sync starts. A different user on this browser
 *   starts clean (IndexedDB wiped); the browser is asked once to keep the data (persist).
 * - Sign out: the caller checks `pendingChanges()` and confirms; `wipeLocalData()` then
 *   removes every row, and the other tabs reload.
 */

const PERSIST_KEY = "persistAsked";

/** "cleaned": same or first user, but rows of another user were found and removed. */
export type SessionOutcome = "same" | "first" | "wiped" | "cleaned";

/**
 * Records the owner of the local data, wiping it when another user signs in. Every start also
 * removes rows stamped with another user's `owner`: data kept from before this check existed
 * (adopted by the first user to sign in) can hold another account's flags and lines.
 */
export async function ensureOwner(db: LocalDb, ownerSub: string): Promise<SessionOutcome> {
  const stored = await db.getMeta<string>("ownerSub");
  if (stored && stored !== ownerSub) {
    await db.wipe();
    journalReset();
    await db.setMeta("ownerSub", ownerSub);
    return "wiped";
  }
  // No owner recorded: data from before this check existed. The current user adopts the rows
  // that are theirs or not pushed yet; another account's rows go.
  if (!stored) await db.setMeta("ownerSub", ownerSub);
  const removed = await db.purgeForeign(ownerSub);
  if (removed > 0) {
    console.warn(`[bacuyy] removed ${removed} local rows that belong to another user`);
    return "cleaned";
  }
  return stored ? "same" : "first";
}

/**
 * Asks the browser not to evict IndexedDB (unsynced lines would be lost). Once per browser:
 * some browsers show a prompt. Never throws.
 */
export async function requestPersistentStorage(storage: StorageManager | undefined = globalThis.navigator?.storage): Promise<boolean> {
  if (!storage?.persist || kvGet(PERSIST_KEY)) return false;
  kvSet(PERSIST_KEY, "1");
  try {
    if (await storage.persisted?.()) return true;
    return await storage.persist();
  } catch {
    return false;
  }
}

export async function prepareSession(ownerSub: string): Promise<SessionOutcome> {
  const db = await getDb();
  const outcome = await ensureOwner(db, ownerSub);
  void requestPersistentStorage();
  return outcome;
}

/** Local rows not pushed yet (they would be lost by signing out). */
export async function pendingChanges(): Promise<number> {
  return (await getDb()).countDirty();
}

/** Sign out, last step: every local row and meta key goes; other tabs reload. */
export async function wipeLocalData(): Promise<void> {
  await (await getDb()).wipe();
  journalReset();
  emit({ type: "signedOut" });
}
