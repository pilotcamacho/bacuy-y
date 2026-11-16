import { openLocalDb } from "./index";
import type { LocalDb } from "./types";

/** The app's single LocalDb, opened on first use. Stores call `getDb()`. */
let dbPromise: Promise<LocalDb> | null = null;

export function getDb(): Promise<LocalDb> {
  dbPromise ??= openLocalDb();
  return dbPromise;
}

/** Tests: use a fresh fake-indexeddb database. */
export function setDbForTests(db: LocalDb | null) {
  dbPromise = db ? Promise.resolve(db) : null;
}
