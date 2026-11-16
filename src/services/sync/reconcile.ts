import type { LocalDb, WriteOp } from "@/lib/db/types";
import { reconcileActivity } from "@/services/lifecycle/reconcile";
import { nowIso } from "./clock";

/**
 * After a pull (docs/02-backend-architecture.md §5): the text is authoritative, so re-derive
 * the text-owned fields and ActivityFlag rows of the changed activities (every activity when
 * a flag changed) and write the differences as ordinary local edits, pushed next sync.
 * `ids = null` means every activity. Returns the number of rows written.
 */
export async function reconcile(db: LocalDb, ids: Set<string> | null): Promise<number> {
  if (ids && ids.size === 0) return 0;
  const [activities, flags, links] = await Promise.all([db.getAll("Activity"), db.getAll("Flag"), db.getAll("ActivityFlag")]);
  const ctx = { flags: flags.filter((f) => !f.deletedAt), today: new Date() };
  const linksByActivity = new Map<string, typeof links>();
  for (const link of links) {
    const list = linksByActivity.get(link.activityId);
    if (list) list.push(link);
    else linksByActivity.set(link.activityId, [link]);
  }

  const now = nowIso();
  const ops: WriteOp[] = [];
  for (const stored of activities) {
    if (ids && !ids.has(stored.id)) continue;
    const { dirty: _dirty, ...row } = stored;
    const result = reconcileActivity(row, linksByActivity.get(row.id) ?? [], ctx, now);
    if (result.activity) ops.push({ model: "Activity", row: result.activity });
    for (const link of result.links) {
      const { dirty: _d, ...plain } = link as typeof link & { dirty?: number };
      ops.push({ model: "ActivityFlag", row: plain });
    }
  }
  await db.putManyLocal(ops);
  return ops.length;
}
