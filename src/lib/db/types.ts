import type { Schema } from "../../../amplify/data/resource";

/**
 * The local database contract. Stores and `services/sync/*` use only this interface,
 * never `idb` directly, so the contract tests (`tests/db/localDb.test.ts`) cover every caller.
 *
 * Rows mirror the Amplify models field for field (the upsert row types: every writable field
 * plus `owner`, `createdAt`, `updatedAt`), plus the local-only `dirty` flag.
 * See docs/03-data-schema.md §7.
 */

export type ModelName = "Activity" | "Flag" | "ActivityFlag" | "Feedback";

/** Push order: parents before children (CLAUDE.md, Push step 1). */
export const MODELS: readonly ModelName[] = ["Flag", "Activity", "ActivityFlag", "Feedback"];

export type ActivityRow = Schema["ActivityRow"]["type"];
export type FlagRow = Schema["FlagRow"]["type"];
export type ActivityFlagRow = Schema["ActivityFlagRow"]["type"];
export type FeedbackRow = Schema["FeedbackRow"]["type"];

export interface RowByModel {
  Activity: ActivityRow;
  Flag: FlagRow;
  ActivityFlag: ActivityFlagRow;
  Feedback: FeedbackRow;
}

/** 1 = has local changes not pushed yet. A number because IndexedDB cannot index booleans. */
export type Dirty = 0 | 1;

export type Stored<M extends ModelName> = RowByModel[M] & { dirty: Dirty };

/** Index names available per model (besides the primary key `id`). */
export interface IndexByModel {
  Activity: "dirty" | "position" | "status";
  Flag: "dirty" | "parentId";
  ActivityFlag: "dirty" | "activityId" | "flagId";
  Feedback: "dirty" | "activityId";
}

export type MergeOutcome =
  | "inserted" // no local row: the remote row was stored
  | "replaced" // remote editedAt >= local: remote wins (tie → server), dirty cleared
  | "keptLocal"; // local is newer: kept, it will be pushed

export type WriteOp = {
  [M in ModelName]: { model: M; row: RowByModel[M] };
}[ModelName];

export type MetaKey =
  | `lastPulledAt:${ModelName}`
  | "ownerSub"
  | "clockOffsetMs"
  | "lastSyncOkAt";

export interface LocalDb {
  get<M extends ModelName>(model: M, id: string): Promise<Stored<M> | undefined>;
  getAll<M extends ModelName>(model: M): Promise<Stored<M>[]>;
  listByIndex<M extends ModelName>(
    model: M,
    index: IndexByModel[M],
    value: string | number,
  ): Promise<Stored<M>[]>;

  /** A local edit: stored with `dirty = 1`. The caller sets `editedAt`. */
  putLocal<M extends ModelName>(model: M, row: RowByModel[M]): Promise<void>;
  /** Several local edits in one transaction (all or nothing), e.g. a line split. */
  putManyLocal(ops: WriteOp[]): Promise<void>;

  /** The server's version of a row (push `applied: false`): stored with `dirty = 0`. */
  putFromServer<M extends ModelName>(model: M, row: RowByModel[M]): Promise<void>;

  /**
   * Pull rule, atomically: keep the version with the later `editedAt` (tie → server).
   * A remote row that wins clears `dirty`.
   */
  mergeFromServer<M extends ModelName>(model: M, row: RowByModel[M]): Promise<MergeOutcome>;

  /** Dirty rows of a model, oldest `editedAt` first. */
  dirty<M extends ModelName>(model: M): Promise<Stored<M>[]>;
  countDirty(): Promise<number>;

  /**
   * After an applied push: clear `dirty` only if the row's `editedAt` is still the one that
   * was sent (an edit made during the push must not be lost). Returns whether it cleared.
   */
  clearDirtyIf(model: ModelName, id: string, sentEditedAt: string): Promise<boolean>;

  /**
   * Delete every row whose `owner` is set to someone other than `ownerSub` (local copies of
   * another user's data; the server is never touched). Rows without an owner are kept: they
   * were created here and not pushed yet. Returns the count.
   */
  purgeForeign(ownerSub: string): Promise<number>;

  /** Delete synced tombstones (`deletedAt` before `cutoffIso`, not dirty). Returns the count. */
  purgeTombstones(model: ModelName, cutoffIso: string): Promise<number>;

  getMeta<T = unknown>(key: MetaKey): Promise<T | undefined>;
  setMeta(key: MetaKey, value: unknown): Promise<void>;

  /** Removes every row and every meta key (sign out, or another user on this browser). */
  wipe(): Promise<void>;
  close(): void;
}
