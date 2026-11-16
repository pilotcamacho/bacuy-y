import { create } from "zustand";
import { getDb } from "@/lib/db/instance";
import { emit } from "@/lib/events";
import type { FlagRow, Stored, WriteOp } from "@/lib/db/types";
import { newId } from "@/lib/ids";
import { missingDefaultFlags } from "@/services/flags/defaults";
import {
  WEIGHT_TOTAL,
  cascadeDelete,
  isValidWeight,
  nameProblem,
  siblingsOf,
  sumsTo100,
  type NameProblem,
} from "@/services/flags/tree";
import { nowIso } from "@/services/sync/clock";
import { reconcile } from "@/services/sync/reconcile";
import { usePageStore } from "./pageStore";

/**
 * The flag tree screen (docs/04-implementation-plan.md Phase 9). Reads and writes LocalDb only.
 * Every write that can change how `#marks` resolve (create, rename, delete) re-derives every
 * line in the same step, so a mark typed before its flag existed resolves by itself and a
 * deleted flag's marks stop resolving (docs/05-line-mapping.md §2.1).
 */

type Flag = Stored<"Flag">;

export type WeightProblem = "invalid" | "sum";

interface FlagState {
  status: "idle" | "loading" | "ready" | "error";
  /** Live flags (not deleted). */
  flags: Flag[];

  /** `ownerSub` seeds the user's missing default flags (the Flags screen may open first). */
  load(ownerSub?: string | null): Promise<void>;
  refresh(): Promise<void>;
  /** A new flag: weight 100 if it is the first child, else 0 (siblings still sum to 100). */
  create(name: string, parentId: string | null, color?: string | null): Promise<{ id: string } | { problem: NameProblem }>;
  /** User flags only (a system flag's name is its key). */
  rename(id: string, name: string): Promise<NameProblem | null>;
  setColor(id: string, color: string | null): Promise<void>;
  /** Saves a sibling group's weights; refused unless they sum to 100. */
  saveWeights(parentId: string | null, weights: Record<string, number>): Promise<WeightProblem | null>;
  /** Soft-deletes the flag, its descendants and their links. System flags: no-op. */
  remove(id: string): Promise<void>;
}

let writeChain: Promise<void> = Promise.resolve();

const plain = ({ dirty: _dirty, ...row }: Flag): FlagRow => row;

interface Plan<T> {
  ops: WriteOp[];
  result: T;
}

export const useFlagStore = create<FlagState>((set, get) => {
  async function readFlags(): Promise<Flag[]> {
    const db = await getDb();
    return (await db.getAll("Flag")).filter((f) => !f.deletedAt);
  }

  /**
   * Runs one write in order with the others: `plan` builds the ops from the flags as stored
   * right now (so two quick creates see each other), then (when names or the tree changed)
   * every line is re-derived. Text still waiting for its debounce on the page is written
   * first, so it is re-derived too.
   */
  function write<T>(plan: (flags: Flag[]) => Plan<T> | Promise<Plan<T>>, reparse: boolean): Promise<T> {
    const run = async (): Promise<T> => {
      const db = await getDb();
      const { ops, result } = await plan(await readFlags());
      if (ops.length === 0) return result;
      if (reparse) await usePageStore.getState().flushAll();
      await db.putManyLocal(ops);
      if (reparse) await reconcile(db, null);
      set({ flags: await readFlags() });
      emit({ type: "localWrite" }); // the sync engine pushes soon; other tabs reload
      await usePageStore.getState().refresh();
      return result;
    };
    const done = writeChain.then(run);
    writeChain = done.then(
      () => undefined,
      (e) => console.error("[bacuyy] flag write failed", e),
    );
    return done;
  }

  /** The panel can create a flag before the Flags screen was ever opened. */
  const ready = async () => {
    if (get().status !== "ready") await get().load();
  };

  return {
    status: "idle",
    flags: [],

    async load(ownerSub) {
      if (get().status === "loading") return;
      set({ status: get().status === "ready" ? "ready" : "loading" });
      try {
        if (ownerSub) {
          const db = await getDb();
          await write(async () => {
            const seed = missingDefaultFlags(ownerSub, await db.getAll("Flag"));
            return { ops: seed.map((row): WriteOp => ({ model: "Flag", row })), result: undefined };
          }, true);
        }
        set({ flags: await readFlags(), status: "ready" });
      } catch (e) {
        console.error("[bacuyy] could not load the flags", e);
        set({ status: "error" });
      }
    },

    async refresh() {
      if (get().status !== "ready") return;
      await writeChain;
      set({ flags: await readFlags() });
    },

    async create(name, parentId, color = null) {
      await ready();
      return write((stored): Plan<{ id: string } | { problem: NameProblem }> => {
        const flags = stored.map(plain);
        const parent = parentId && flags.some((f) => f.id === parentId) ? parentId : null;
        const problem = nameProblem(name, parent, flags);
        if (problem) return { ops: [], result: { problem } };
        const row: FlagRow = {
          id: newId(),
          name: name.trim(),
          parentId: parent,
          // The first child takes the whole group; later ones start at 0 so the sum stays 100.
          weight: siblingsOf(parent, flags).length === 0 ? WEIGHT_TOTAL : 0,
          color: color ?? null,
          isSystemDefault: false,
          editedAt: nowIso(),
          deletedAt: null,
        };
        return { ops: [{ model: "Flag", row }], result: { id: row.id } };
      }, true);
    },

    async rename(id, name) {
      await ready();
      return write((stored): Plan<NameProblem | null> => {
        const flag = stored.find((f) => f.id === id);
        if (!flag || flag.isSystemDefault || flag.name === name.trim()) return { ops: [], result: null };
        const problem = nameProblem(name, flag.parentId ?? null, stored.map(plain), id);
        if (problem) return { ops: [], result: problem };
        return { ops: [{ model: "Flag", row: { ...plain(flag), name: name.trim(), editedAt: nowIso() } }], result: null };
      }, true);
    },

    async setColor(id, color) {
      await ready();
      await write((stored) => {
        const flag = stored.find((f) => f.id === id);
        if (!flag || (flag.color ?? null) === color) return { ops: [], result: undefined };
        return { ops: [{ model: "Flag", row: { ...plain(flag), color, editedAt: nowIso() } }], result: undefined };
      }, false);
    },

    async saveWeights(parentId, weights) {
      await ready();
      return write((stored): Plan<WeightProblem | null> => {
        const group = siblingsOf(parentId, stored);
        const next = group.map((f) => weights[f.id] ?? f.weight);
        if (!next.every(isValidWeight)) return { ops: [], result: "invalid" };
        if (!sumsTo100(next)) return { ops: [], result: "sum" };
        const now = nowIso();
        const ops: WriteOp[] = group
          .filter((f) => weights[f.id] !== undefined && weights[f.id] !== f.weight)
          .map((f) => ({ model: "Flag", row: { ...plain(f), weight: weights[f.id]!, editedAt: now } }));
        return { ops, result: null };
      }, false);
    },

    async remove(id) {
      const db = await getDb();
      await write(async () => {
        const [allFlags, links] = await Promise.all([db.getAll("Flag"), db.getAll("ActivityFlag")]);
        const ops = cascadeDelete(
          id,
          allFlags.map(plain),
          links.map(({ dirty: _d, ...l }) => l),
          nowIso(),
        );
        return { ops, result: undefined };
      }, true);
    },
  };
});

export function resetFlagStore() {
  writeChain = Promise.resolve();
  useFlagStore.setState({ status: "idle", flags: [] });
}
