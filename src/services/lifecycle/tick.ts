import type { ActivityRow } from "@/lib/db/types";
import { nextShowAt } from "./nextShow";
import { reactivatedStatus } from "./status";

/**
 * The tick at the start of a line, per type (docs/05-line-mapping.md §4). Pure.
 * - `update`: write this patch. `hidden`: the patch hides the line until `hiddenUntil`
 *   (a repetitive task or habit day done for this time). `completed`: the patch completes it
 *   (it leaves the page for the Completed page).
 * - `panel`: open the side panel at this section instead (the type needs more input).
 * - `review`: ask "how did it go?" (attitudes and skills: spaced review, ./review.ts).
 * - `none`: the tick does nothing for this line.
 */
export type PanelSection = "feedback" | "description" | "expiration";

export type TickResult =
  | { kind: "update"; patch: Partial<ActivityRow>; formedHint?: boolean; hidden?: boolean; completed?: boolean }
  | { kind: "panel"; section: PanelSection }
  | { kind: "review" }
  | { kind: "none" };

export type TickRow = Pick<
  ActivityRow,
  "activityType" | "status" | "completionCount" | "targetCount" | "streak" | "targetStreak" | "cron" | "frequency"
>;

export function tick(row: TickRow, hasFlags: boolean, now: Date = new Date()): TickResult {
  const hideUntil = () => nextShowAt(row, now).toISOString();
  const status = row.status ?? "DRAFT";
  if (status === "INACTIVE" || status === "ARCHIVED") return { kind: "none" };

  switch (row.activityType) {
    case "ACTION":
      return status === "COMPLETED"
        ? { kind: "update", patch: { status: reactivatedStatus(hasFlags), completedAt: null } }
        : { kind: "update", patch: { status: "COMPLETED", completedAt: now.toISOString() }, completed: true };

    case "REPETITIVE_ACTION": {
      if (status === "COMPLETED") return { kind: "none" }; // the series is over (panel reactivates)
      const count = (row.completionCount ?? 0) + 1;
      const done = row.targetCount != null && row.targetCount > 0 && count >= row.targetCount;
      // Reaching the target ends the series (completed); otherwise it is done for this time
      // and comes back at the next occurrence.
      return done
        ? { kind: "update", patch: { completionCount: count, status: "COMPLETED", completedAt: now.toISOString() }, completed: true }
        : { kind: "update", patch: { completionCount: count, hiddenUntil: hideUntil() }, hidden: true };
    }

    case "HABIT": {
      if (status === "COMPLETED") return { kind: "none" };
      const streak = (row.streak ?? 0) + 1;
      const formed = row.targetStreak != null && row.targetStreak > 0 && streak >= row.targetStreak;
      return { kind: "update", patch: { streak, hiddenUntil: hideUntil() }, formedHint: formed, hidden: true };
    }

    case "ATTITUDE":
    case "SKILL":
      return status === "COMPLETED" ? { kind: "none" } : { kind: "review" };
    case "GRATITUDE":
      return status === "COMPLETED" ? { kind: "none" } : { kind: "panel", section: "description" };
    case "EXPIRATION":
      return { kind: "panel", section: "expiration" };
    case "MOMENTO":
      return { kind: "none" };
  }
}

/** Whether the tick column is a clickable control for this line (Ctrl+Enter still works). */
export function tickIsClickable(row: TickRow): boolean {
  const status = row.status ?? "DRAFT";
  if (status === "INACTIVE" || status === "ARCHIVED") return false;
  if (row.activityType === "MOMENTO") return false;
  if (status === "COMPLETED" && row.activityType !== "ACTION") return false;
  return true;
}

/** Whole days from today (local) to an ISO date; negative = overdue. */
export function daysUntil(iso: string, today: Date = new Date()): number {
  const d = new Date(iso);
  const a = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const b = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((a - b) / 86_400_000);
}
