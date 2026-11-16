import { CronExpressionParser } from "cron-parser";
import type { ActivityRow } from "@/lib/db/types";

/**
 * "Done for this time" (docs/05-line-mapping.md §4): ticking a repetitive task or a habit day
 * hides the line until its next occurrence, stored in `hiddenUntil` (synced like any field).
 * - `cron` set and valid → its next fire time after now;
 * - otherwise by `frequency`, at 00:00 local: DAILY (or none, or CUSTOM without a cron) →
 *   tomorrow; WEEKLY → the same weekday next week; MONTHLY → the same day next month (the
 *   last day when the next month is shorter).
 * Pure; takes `now`.
 */
export type NextShowRow = Pick<ActivityRow, "cron" | "frequency">;

export const HIDES_ON_TICK = new Set<ActivityRow["activityType"]>(["REPETITIVE_ACTION", "HABIT"]);

export function nextShowAt(row: NextShowRow, now: Date): Date {
  if (row.cron) {
    try {
      return CronExpressionParser.parse(row.cron, { currentDate: now }).next().toDate();
    } catch {
      // An invalid cron falls back to the frequency.
    }
  }
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  switch (row.frequency) {
    case "WEEKLY":
      return new Date(y, m, d + 7);
    case "MONTHLY": {
      const lastDay = new Date(y, m + 2, 0).getDate();
      return new Date(y, m + 1, Math.min(d, lastDay));
    }
    default:
      return new Date(y, m, d + 1);
  }
}

/** A line hidden until later right now (not deleted or archived: those are gone anyway). */
export function isHiddenNow(row: Pick<ActivityRow, "hiddenUntil">, now: Date): boolean {
  return !!row.hiddenUntil && new Date(row.hiddenUntil) > now;
}
