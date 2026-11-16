import type { ActivityFlagRow } from "@/lib/db/types";
import { activityFlagId } from "@/lib/ids";

/**
 * The ActivityFlag rows of one activity follow its `#flag` marks (docs/05-line-mapping.md §1).
 * Ids are deterministic per (activity, flag): re-adding a removed mark revives the same row,
 * and two devices tagging the same line create one row. Returns only the rows to write.
 */
export function diffActivityFlags(
  activityId: string,
  wanted: string[],
  existing: ActivityFlagRow[],
  now: string,
): ActivityFlagRow[] {
  const want = new Set(wanted);
  const byFlag = new Map(existing.filter((r) => r.activityId === activityId).map((r) => [r.flagId, r]));
  const out: ActivityFlagRow[] = [];

  for (const fid of want) {
    const row = byFlag.get(fid);
    if (!row) out.push({ id: activityFlagId(activityId, fid), activityId, flagId: fid, editedAt: now, deletedAt: null });
    else if (row.deletedAt) out.push({ ...row, deletedAt: null, editedAt: now });
  }
  for (const [fid, row] of byFlag) {
    if (!want.has(fid) && !row.deletedAt) out.push({ ...row, deletedAt: now, editedAt: now });
  }
  return out;
}
