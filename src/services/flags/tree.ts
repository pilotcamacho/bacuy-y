import type { ActivityFlagRow, FlagRow, WriteOp } from "@/lib/db/types";
import { SYSTEM_FLAG_ALIASES, normalizeFlagName } from "@/services/marks";

/**
 * The flag tree and its rules (CLAUDE.md rule 11, docs/03-data-schema.md §6 rules 6–8). Pure.
 * Every function takes the live flags only (no `deletedAt`), except where it says otherwise.
 */

/** Sibling weights must sum to this. */
export const WEIGHT_TOTAL = 100;
/** Sums closer than this count as equal (weights are floats). */
const EPSILON = 0.005;

export interface FlagNode<F extends FlagRow = FlagRow> {
  flag: F;
  children: FlagNode<F>[];
}

/** Siblings sort by weight (heaviest first), then by name, so the tree reads like the priority. */
function bySiblingOrder(a: FlagRow, b: FlagRow): number {
  return b.weight - a.weight || a.name.localeCompare(b.name);
}

/** The tree; a flag whose parent is missing (deleted, or not pulled yet) is shown as a root. */
export function buildTree<F extends FlagRow>(flags: F[]): FlagNode<F>[] {
  const ids = new Set(flags.map((f) => f.id));
  const byParent = new Map<string | null, F[]>();
  for (const f of flags) {
    const parent = f.parentId && ids.has(f.parentId) && f.parentId !== f.id ? f.parentId : null;
    const list = byParent.get(parent);
    if (list) list.push(f);
    else byParent.set(parent, [f]);
  }
  const seen = new Set<string>();
  const build = (parent: string | null): FlagNode<F>[] =>
    (byParent.get(parent) ?? [])
      .slice()
      .sort(bySiblingOrder)
      .filter((f) => !seen.has(f.id) && seen.add(f.id))
      .map((flag) => ({ flag, children: build(flag.id) }));
  return build(null);
}

/** The group key of a flag's siblings: its parent id, or null for the roots. */
export function groupOf(flag: Pick<FlagRow, "parentId">, flags: Pick<FlagRow, "id">[]): string | null {
  return flag.parentId && flags.some((f) => f.id === flag.parentId) ? flag.parentId : null;
}

export function siblingsOf<F extends FlagRow>(parentId: string | null, flags: F[]): F[] {
  return flags.filter((f) => groupOf(f, flags) === parentId);
}

export function sumOf(weights: number[]): number {
  return weights.reduce((s, w) => s + w, 0);
}

export function sumsTo100(weights: number[]): boolean {
  return Math.abs(sumOf(weights) - WEIGHT_TOTAL) < EPSILON;
}

/** A weight the editor accepts: a finite number from 0 to 100. */
export function isValidWeight(w: number): boolean {
  return Number.isFinite(w) && w >= 0 && w <= WEIGHT_TOTAL;
}

/**
 * Sibling groups whose weights do not sum to 100 (a merge of offline edits, or a deletion).
 * Returns the parent id of each such group (null = the roots).
 */
export function driftGroups(flags: FlagRow[]): (string | null)[] {
  const groups = new Map<string | null, number[]>();
  for (const f of flags) {
    const g = groupOf(f, flags);
    const list = groups.get(g);
    if (list) list.push(f.weight);
    else groups.set(g, [f.weight]);
  }
  return [...groups].filter(([, weights]) => !sumsTo100(weights)).map(([g]) => g);
}

/** The flag and all its descendants (ids). Works on any rows, deleted ones included. */
export function subtreeIds(rootId: string, flags: Pick<FlagRow, "id" | "parentId">[]): Set<string> {
  const ids = new Set([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of flags) {
      if (f.parentId && ids.has(f.parentId) && !ids.has(f.id)) {
        ids.add(f.id);
        grew = true;
      }
    }
  }
  return ids;
}

export type NameProblem = "empty" | "slash" | "taken";

/**
 * Checks a user flag name. `#marks` resolve by normalized name, so a name may not contain `/`
 * (the path separator) and may not normalize to a sibling's name or to a system flag's alias
 * in the same group (the mark would be ambiguous between them).
 */
export function nameProblem(
  name: string,
  parentId: string | null,
  flags: FlagRow[],
  selfId: string | null = null,
): NameProblem | null {
  const trimmed = name.trim();
  if (!trimmed || !normalizeFlagName(trimmed)) return "empty";
  if (trimmed.includes("/")) return "slash";
  const key = normalizeFlagName(trimmed);
  const taken = siblingsOf(parentId, flags).some((f) => {
    if (f.id === selfId) return false;
    const own = normalizeFlagName(f.name);
    const aliases = f.isSystemDefault ? (SYSTEM_FLAG_ALIASES[own] ?? []).map(normalizeFlagName) : [];
    return own === key || aliases.includes(key);
  });
  return taken ? "taken" : null;
}

/**
 * Soft-deletes a flag, its descendants and their live ActivityFlag rows (rule 8). The lines
 * keep their `#flag` text, which simply stops resolving. System flags cannot be deleted.
 * `allFlags` and `links` may include deleted rows.
 */
export function cascadeDelete(
  id: string,
  allFlags: FlagRow[],
  links: ActivityFlagRow[],
  now: string,
): WriteOp[] {
  const target = allFlags.find((f) => f.id === id);
  if (!target || target.isSystemDefault || target.deletedAt) return [];
  const ids = subtreeIds(id, allFlags);
  const ops: WriteOp[] = [];
  for (const f of allFlags) {
    if (ids.has(f.id) && !f.deletedAt) ops.push({ model: "Flag", row: { ...f, deletedAt: now, editedAt: now } });
  }
  for (const link of links) {
    if (ids.has(link.flagId) && !link.deletedAt) {
      ops.push({ model: "ActivityFlag", row: { ...link, deletedAt: now, editedAt: now } });
    }
  }
  return ops;
}
