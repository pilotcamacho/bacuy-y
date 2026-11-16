import type { FlagRow } from "@/lib/db/types";
import { flagId } from "@/lib/ids";

/**
 * System flags every user starts with (docs/03-data-schema.md §5, same as bacuy-x
 * `seedDefaultFlags`). Ids are deterministic per user, so two devices seeding offline create
 * the same rows.
 */
export interface DefaultFlag {
  key: string; // stored in `name`; shown as t("flag.<key>")
  parent?: string;
  weight: number;
}

export const DEFAULT_FLAGS: readonly DefaultFlag[] = [
  { key: "personal", weight: 15 },
  { key: "family", weight: 15 },
  { key: "income", weight: 15 },
  { key: "spiritual", weight: 15 },
  { key: "health", weight: 15 },
  { key: "errand", weight: 10 },
  { key: "fun", weight: 15 },
  { key: "salary", parent: "income", weight: 50 },
  { key: "project", parent: "income", weight: 30 },
  { key: "rent", parent: "income", weight: 20 },
];

/**
 * `editedAt` of a seeded row. The epoch loses to every real edit, so seeding before the first
 * pull is safe: a server version (renamed, reweighted or deleted on another device) always
 * wins the pull merge, and the server refuses the seed upsert (`applied: false`).
 */
export const SEED_EDITED_AT = "1970-01-01T00:00:00.000Z";

const pathOf = (f: DefaultFlag) => (f.parent ? `${f.parent}/${f.key}` : f.key);

export function defaultFlagRows(ownerSub: string): FlagRow[] {
  return DEFAULT_FLAGS.map((f) => ({
    id: flagId(ownerSub, pathOf(f)),
    name: f.key,
    parentId: f.parent ? flagId(ownerSub, f.parent) : null,
    weight: f.weight,
    isSystemDefault: true,
    editedAt: SEED_EDITED_AT,
    deletedAt: null,
  }));
}

/** The default rows whose id is not stored yet (a deleted one counts as stored: never revived). */
export function missingDefaultFlags(ownerSub: string, existing: Pick<FlagRow, "id">[]): FlagRow[] {
  const have = new Set(existing.map((f) => f.id));
  return defaultFlagRows(ownerSub).filter((f) => !have.has(f.id));
}
