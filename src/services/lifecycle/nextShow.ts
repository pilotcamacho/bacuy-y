import { CronExpressionParser } from "cron-parser";
import { DAY_START_HOUR, addDays, dayStartAt, logicalToday } from "@/lib/day";
import type { ActivityRow } from "@/lib/db/types";

/**
 * "Done for this time" (docs/05-line-mapping.md §4): ticking a repetitive task or a habit day
 * hides the line until its next occurrence, stored in `hiddenUntil` (synced like any field).
 * - `cron` set and valid → its next fire time after now;
 * - otherwise by `frequency`, when that day starts (03:00 local, lib/day): DAILY (or none, or
 *   CUSTOM without a cron) → tomorrow; WEEKLY → the same weekday next week; MONTHLY → the same
 *   day next month (the last day when the next month is shorter). "Today" is the app's day:
 *   ticked at 01:30, it counted for the day before, so it is back at 03:00.
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
  const today = logicalToday(now);
  const y = today.getFullYear();
  const m = today.getMonth();
  const d = today.getDate();
  switch (row.frequency) {
    case "WEEKLY":
      return dayStartAt(addDays(today, 7));
    case "MONTHLY": {
      const lastDay = new Date(y, m + 2, 0).getDate();
      return dayStartAt(new Date(y, m + 1, Math.min(d, lastDay)));
    }
    default:
      return dayStartAt(addDays(today, 1));
  }
}

/**
 * A line hidden right now (not deleted or archived: those are gone anyway): hidden until the
 * user shows it again (`isHidden`), or until a time still in the future (`hiddenUntil`: done
 * for this time, or hidden by hand until a date).
 */
export function isHiddenNow(row: Pick<ActivityRow, "hiddenUntil" | "isHidden">, now: Date): boolean {
  return !!row.isHidden || (!!row.hiddenUntil && new Date(row.hiddenUntil) > now);
}

/** Quick choices of "Hide until…" (docs/05-line-mapping.md §5). */
export type HidePreset = "later" | "tomorrow" | "monday" | "nextMonth";
export const HIDE_PRESETS: readonly HidePreset[] = ["later", "tomorrow", "monday", "nextMonth"];
/** Hour (local) the day-based choices end at. */
export const HIDE_MORNING_HOUR = 8;
/**
 * The day-based choices count from the app's day (lib/day): at 00:30, "tomorrow 8:00" is this
 * morning, and "Monday" on a Monday at 01:00 is this morning too.
 */
export const HIDE_DAY_STARTS_HOUR = DAY_START_HOUR;

export function hidePresetAt(preset: HidePreset, now: Date): Date {
  const day = logicalToday(now);
  const y = day.getFullYear();
  const m = day.getMonth();
  const d = day.getDate();
  switch (preset) {
    case "later":
      return new Date(now.getTime() + 3 * 3_600_000);
    case "tomorrow":
      return new Date(y, m, d + 1, HIDE_MORNING_HOUR);
    case "monday": {
      const days = ((8 - day.getDay()) % 7) || 7; // the next Monday, never today
      return new Date(y, m, d + days, HIDE_MORNING_HOUR);
    }
    case "nextMonth": {
      const lastDay = new Date(y, m + 2, 0).getDate();
      return new Date(y, m + 1, Math.min(d, lastDay), HIDE_MORNING_HOUR);
    }
  }
}
