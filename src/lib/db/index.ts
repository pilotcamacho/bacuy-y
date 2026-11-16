import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type {
  Dirty,
  LocalDb,
  MergeOutcome,
  MetaKey,
  ModelName,
  RowByModel,
  Stored,
  WriteOp,
} from "./types";

/** IndexedDB implementation of LocalDb (database `bacuyy`). See docs/03-data-schema.md §7. */

export const DB_NAME = "bacuyy";
export const DB_VERSION = 1;

export const STORE: { [M in ModelName]: StoreName } = {
  Activity: "activities",
  Flag: "flags",
  ActivityFlag: "activityFlags",
  Feedback: "feedbacks",
};

type StoreName = "activities" | "flags" | "activityFlags" | "feedbacks";

interface BacuyyDb extends DBSchema {
  activities: {
    key: string;
    value: Stored<"Activity">;
    indexes: { dirty: number; position: string; status: string };
  };
  flags: { key: string; value: Stored<"Flag">; indexes: { dirty: number; parentId: string } };
  activityFlags: {
    key: string;
    value: Stored<"ActivityFlag">;
    indexes: { dirty: number; activityId: string; flagId: string };
  };
  feedbacks: {
    key: string;
    value: Stored<"Feedback">;
    indexes: { dirty: number; activityId: string };
  };
  sync_meta: { key: string; value: unknown };
}

const ALL_STORES = ["activities", "flags", "activityFlags", "feedbacks", "sync_meta"] as const;

// idb's typed overloads cannot follow a store name chosen at run time; this view keeps the
// public API typed while the internals treat every model store the same way.
type AnyStore = "activities";
const s = (model: ModelName) => STORE[model] as AnyStore;

/**
 * Rows from the generated client carry lazy-loader functions for relations; IndexedDB cannot
 * clone functions. Keep plain data only (and never store `undefined` keys).
 */
function storable<T extends object>(row: T, dirty: Dirty): T & { dirty: Dirty } {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (typeof v !== "function" && v !== undefined) out[k] = v;
  }
  out.dirty = dirty;
  return out as T & { dirty: Dirty };
}

export async function openLocalDb(name: string = DB_NAME): Promise<LocalDb> {
  const db: IDBPDatabase<BacuyyDb> = await openDB<BacuyyDb>(name, DB_VERSION, {
    upgrade(database, oldVersion) {
      if (oldVersion < 1) {
        const activities = database.createObjectStore("activities", { keyPath: "id" });
        activities.createIndex("dirty", "dirty");
        activities.createIndex("position", "position");
        activities.createIndex("status", "status");

        const flags = database.createObjectStore("flags", { keyPath: "id" });
        flags.createIndex("dirty", "dirty");
        flags.createIndex("parentId", "parentId");

        const activityFlags = database.createObjectStore("activityFlags", { keyPath: "id" });
        activityFlags.createIndex("dirty", "dirty");
        activityFlags.createIndex("activityId", "activityId");
        activityFlags.createIndex("flagId", "flagId");

        const feedbacks = database.createObjectStore("feedbacks", { keyPath: "id" });
        feedbacks.createIndex("dirty", "dirty");
        feedbacks.createIndex("activityId", "activityId");

        database.createObjectStore("sync_meta");
      }
      // Future versions: add `if (oldVersion < 2) { … }` blocks; never edit the ones above.
    },
    blocking() {
      // Another tab opened a newer version: let it upgrade, this tab reloads on next use.
      db.close();
    },
  });

  const local: LocalDb = {
    async get<M extends ModelName>(model: M, id: string) {
      return (await db.get(s(model), id)) as Stored<M> | undefined;
    },

    async getAll<M extends ModelName>(model: M) {
      return (await db.getAll(s(model))) as unknown as Stored<M>[];
    },

    async listByIndex(model, index, value) {
      return (await db.getAllFromIndex(s(model), index as "dirty", value as number)) as never;
    },

    async putLocal(model, row) {
      await db.put(s(model), storable(row, 1) as never);
    },

    async putManyLocal(ops: WriteOp[]) {
      if (ops.length === 0) return;
      const names = [...new Set(ops.map((op) => s(op.model)))];
      const tx = db.transaction(names, "readwrite");
      const puts: Promise<unknown>[] = [];
      try {
        // A put can throw synchronously (e.g. a missing key); without the abort, the puts
        // already queued would still commit and the batch would be half written.
        for (const op of ops) {
          const put = tx.objectStore(s(op.model)).put(storable(op.row, 1) as never);
          put.catch(() => undefined); // its rejection is reported through tx.done / the throw
          puts.push(put);
        }
        await Promise.all([...puts, tx.done]);
      } catch (e) {
        try {
          tx.abort();
        } catch {
          // already aborted by the failed request
        }
        await tx.done.catch(() => undefined);
        throw e;
      }
    },

    async putFromServer(model, row) {
      await db.put(s(model), storable(row, 0) as never);
    },

    async mergeFromServer<M extends ModelName>(model: M, row: RowByModel[M]): Promise<MergeOutcome> {
      const tx = db.transaction(s(model), "readwrite");
      const local = (await tx.store.get(row.id)) as Stored<M> | undefined;
      let outcome: MergeOutcome;
      if (!local) {
        outcome = "inserted";
      } else if (row.editedAt >= local.editedAt) {
        outcome = "replaced"; // later remote edit, or a tie → server
      } else {
        outcome = "keptLocal";
      }
      if (outcome !== "keptLocal") await tx.store.put(storable(row, 0) as never);
      await tx.done;
      return outcome;
    },

    async dirty<M extends ModelName>(model: M) {
      const rows = (await db.getAllFromIndex(s(model), "dirty", 1)) as unknown as Stored<M>[];
      return rows.sort((a, b) => (a.editedAt < b.editedAt ? -1 : a.editedAt > b.editedAt ? 1 : 0));
    },

    async countDirty() {
      let total = 0;
      for (const model of Object.keys(STORE) as ModelName[]) {
        total += await db.countFromIndex(s(model), "dirty", 1);
      }
      return total;
    },

    async clearDirtyIf(model, id, sentEditedAt) {
      const tx = db.transaction(s(model), "readwrite");
      const row = await tx.store.get(id);
      let cleared = false;
      if (row && row.dirty === 1 && row.editedAt === sentEditedAt) {
        await tx.store.put({ ...row, dirty: 0 });
        cleared = true;
      }
      await tx.done;
      return cleared;
    },

    async purgeForeign(ownerSub) {
      const names = (Object.keys(STORE) as ModelName[]).map(s);
      const tx = db.transaction(names, "readwrite");
      let removed = 0;
      for (const name of names) {
        for (let cursor = await tx.objectStore(name).openCursor(); cursor; cursor = await cursor.continue()) {
          const owner = (cursor.value as { owner?: string | null }).owner;
          if (owner && owner !== ownerSub) {
            await cursor.delete();
            removed++;
          }
        }
      }
      await tx.done;
      return removed;
    },

    async purgeTombstones(model, cutoffIso) {
      const tx = db.transaction(s(model), "readwrite");
      let removed = 0;
      for (let cursor = await tx.store.openCursor(); cursor; cursor = await cursor.continue()) {
        const row = cursor.value as { deletedAt?: string | null; dirty: Dirty };
        if (row.dirty === 0 && row.deletedAt && row.deletedAt < cutoffIso) {
          await cursor.delete();
          removed++;
        }
      }
      await tx.done;
      return removed;
    },

    async getMeta<T>(key: MetaKey) {
      return (await db.get("sync_meta", key)) as T | undefined;
    },

    async setMeta(key, value) {
      await db.put("sync_meta", value, key);
    },

    async wipe() {
      const tx = db.transaction(ALL_STORES, "readwrite");
      await Promise.all([...ALL_STORES.map((name) => tx.objectStore(name).clear()), tx.done]);
    },

    close() {
      db.close();
    },
  };

  return local;
}
