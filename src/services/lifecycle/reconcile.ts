import type { ActivityFlagRow, ActivityRow } from "@/lib/db/types";
import type { ParseContext } from "@/services/marks";
import { diffActivityFlags } from "./activityFlags";
import { deriveTextFields } from "./derive";

/**
 * The text is authoritative (docs/02-backend-architecture.md §5): re-derive one activity's
 * text-owned fields and ActivityFlag rows from its `rawInput`. Returns only what differs, as
 * ordinary local edits stamped `now`. Pure; used by the page store on load and by sync after
 * a pull.
 */
export function reconcileActivity<A extends ActivityRow>(
  row: A,
  links: ActivityFlagRow[],
  ctx: ParseContext,
  now: string,
): { activity: A | null; links: ActivityFlagRow[] } {
  if (row.deletedAt) {
    // A deleted activity keeps no live links.
    return { activity: null, links: diffActivityFlags(row.id, [], links, now) };
  }
  const { fields, flagIds } = deriveTextFields(row, row.rawInput ?? "", ctx);
  const keys = Object.keys(fields) as (keyof ActivityRow)[];
  const differs = keys.some((k) => (fields[k] ?? null) !== (row[k] ?? null));
  return {
    activity: differs ? { ...row, ...fields, editedAt: now } : null,
    links: diffActivityFlags(row.id, flagIds, links, now),
  };
}
