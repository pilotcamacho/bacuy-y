import type { ActivityRow } from "@/lib/db/types";
import type { Schema } from "../../../amplify/data/resource";

export type ActivityStatus = Schema["ActivityStatus"]["type"];

/**
 * DRAFT ↔ ACTIVE follows the flags (CLAUDE.md, rule 7): the first flag makes a DRAFT line
 * ACTIVE; losing the last flag returns an ACTIVE line to DRAFT. Other statuses are kept.
 */
export function statusForFlags(status: ActivityStatus | null | undefined, hasFlags: boolean): ActivityStatus {
  const s = status ?? "DRAFT";
  if (s === "DRAFT" && hasFlags) return "ACTIVE";
  if (s === "ACTIVE" && !hasFlags) return "DRAFT";
  return s;
}

/** The status a line returns to when it is reactivated (untick, unpause, restore). */
export function reactivatedStatus(hasFlags: boolean): ActivityStatus {
  return hasFlags ? "ACTIVE" : "DRAFT";
}

export type StatusAction = "pause" | "reactivate" | "complete" | "archive";

type StatusRow = Pick<ActivityRow, "activityType" | "status" | "description">;

export function canComplete(row: StatusRow): boolean {
  if (row.activityType === "MOMENTO" || row.activityType === "EXPIRATION") return false;
  if (row.activityType === "GRATITUDE") return (row.description ?? "").trim().length > 0;
  return true;
}

/** Panel status buttons available for a line (docs/05-line-mapping.md §4). */
export function statusActions(row: StatusRow): StatusAction[] {
  const status = row.status ?? "DRAFT";
  const out: StatusAction[] = [];
  if (status === "DRAFT" || status === "ACTIVE") out.push("pause");
  if (status === "INACTIVE" || status === "COMPLETED") out.push("reactivate");
  // MOMENTO is never completed; EXPIRATION ends by renewing or archiving.
  if (status !== "COMPLETED" && row.activityType !== "MOMENTO" && row.activityType !== "EXPIRATION") {
    out.push("complete");
  }
  out.push("archive");
  return out;
}

/** The patch for a panel status action, or null when it is not allowed. */
export function applyStatusAction(row: StatusRow, action: StatusAction, hasFlags: boolean): Partial<ActivityRow> | null {
  switch (action) {
    case "pause":
      return { status: "INACTIVE" };
    case "reactivate":
      return { status: reactivatedStatus(hasFlags) };
    case "complete":
      return canComplete(row) ? { status: "COMPLETED" } : null;
    case "archive":
      return row.activityType === "EXPIRATION" ? { status: "ARCHIVED", isRenewed: true } : { status: "ARCHIVED" };
  }
}
