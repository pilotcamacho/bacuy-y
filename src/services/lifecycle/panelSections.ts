import type { ActivityRow } from "@/lib/db/types";
import { statusActions, type StatusAction } from "./status";

/**
 * Which parts of the side panel a line shows (docs/05-line-mapping.md §5). Pure.
 * Every type gets: text, type and status, its own fields, description, flags, delete.
 * The rest only where it means something for that type:
 * - schedule (frequency, day / time picker, cron): repeating actions and habits; other types
 *   only while they still carry a cron (so it can be cleared);
 * - feedback: not for gratitude (the notes are the entry) nor expirations (nothing to rate),
 *   unless entries already exist;
 * - hide: lines on the page (not completed or archived ones).
 */

type Row = Pick<ActivityRow, "activityType" | "status" | "cron">;

export interface PanelSections {
  schedule: boolean;
  feedback: boolean;
  hide: boolean;
  /** The status buttons to show. */
  actions: StatusAction[];
}

const REPEATING = new Set<ActivityRow["activityType"]>(["REPETITIVE_ACTION", "HABIT"]);
const NO_FEEDBACK = new Set<ActivityRow["activityType"]>(["GRATITUDE", "EXPIRATION"]);

export function panelSections(row: Row, hasFeedback: boolean): PanelSections {
  const status = row.status ?? "DRAFT";
  return {
    schedule: REPEATING.has(row.activityType) || !!row.cron?.trim(),
    feedback: !NO_FEEDBACK.has(row.activityType) || hasFeedback,
    hide: status !== "COMPLETED" && status !== "ARCHIVED",
    // Gratitude is completed with "Save & complete" next to its notes, not a second button.
    actions: statusActions(row).filter((a) => !(row.activityType === "GRATITUDE" && a === "complete")),
  };
}
