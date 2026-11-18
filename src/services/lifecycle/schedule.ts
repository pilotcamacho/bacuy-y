import type { ActivityRow } from "@/lib/db/types";

/**
 * The day / date picker of the panel's schedule (docs/05-line-mapping.md §5). Pure.
 * A picked schedule is stored as a plain `cron` (no schema change); these helpers turn the
 * simple cron shapes the picker writes back into picker state, and anything else is left to
 * the raw cron field ("custom").
 *
 *   daily    `m h * * *`
 *   weekly   `m h * * d,d`     (0 = Sunday … 6 = Saturday)
 *   monthly  `m h D * *`       (D = 1…28, or L = the last day of the month)
 *
 * Days 29–31 are not offered: cron skips the months that lack them, which is never what is
 * meant; "last day" covers the end of the month.
 */

export type ScheduleKind = "daily" | "weekly" | "monthly";
export type MonthDay = number | "last";

export interface PickedSchedule {
  kind: ScheduleKind;
  /** Weekly: the weekdays, 0 = Sunday … 6 = Saturday, sorted. */
  days?: number[];
  /** Monthly: the day of the month. */
  monthDay?: MonthDay;
  /** "HH:MM", or null for the start of the day (00:00). */
  time: string | null;
}

export const MAX_MONTH_DAY = 28;
/** Monday first, the order the picker shows. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

const FREQ_KIND: Partial<Record<NonNullable<ActivityRow["frequency"]>, ScheduleKind>> = {
  DAILY: "daily",
  WEEKLY: "weekly",
  MONTHLY: "monthly",
};

export function kindOfFrequency(frequency: ActivityRow["frequency"]): ScheduleKind | null {
  return (frequency && FREQ_KIND[frequency]) || null;
}

function timeParts(time: string | null): [number, number] {
  const m = time ? /^(\d{1,2}):(\d{2})$/.exec(time) : null;
  return m ? [Number(m[2]), Number(m[1])] : [0, 0];
}

/** The cron for a picked schedule, or null when there is nothing to pin (frequency alone). */
export function toCron(s: PickedSchedule): string | null {
  const [minute, hour] = timeParts(s.time);
  const at = `${minute} ${hour}`;
  if (s.kind === "daily") return s.time ? `${at} * * *` : null;
  if (s.kind === "weekly") {
    const days = [...new Set(s.days ?? [])].filter((d) => d >= 0 && d <= 6).sort((a, b) => a - b);
    return days.length > 0 ? `${at} * * ${days.join(",")}` : null;
  }
  const day = s.monthDay;
  if (day === undefined) return null;
  return `${at} ${day === "last" ? "L" : day} * *`;
}

const NUM = /^\d{1,2}$/;

function parseDays(field: string): number[] | null {
  const out = new Set<number>();
  for (const part of field.split(",")) {
    const range = /^(\d)-(\d)$/.exec(part);
    if (range) {
      const [from, to] = [Number(range[1]), Number(range[2])];
      if (from > to) return null;
      for (let d = from; d <= to; d++) out.add(d % 7);
    } else if (/^\d$/.test(part)) out.add(Number(part) % 7);
    else return null;
  }
  return [...out].sort((a, b) => a - b);
}

/** The picker state for a cron of one of the simple shapes, or null ("custom"). */
export function fromCron(cron: string | null | undefined): PickedSchedule | null {
  if (!cron) return null;
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minute, hour, dom, month, dow] = parts as [string, string, string, string, string];
  if (!NUM.test(minute) || !NUM.test(hour) || Number(minute) > 59 || Number(hour) > 23 || month !== "*") return null;
  const time = `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
  const timeOrNull = time === "00:00" ? null : time;
  if (dom === "*" && dow === "*") return { kind: "daily", time };
  if (dom === "*") {
    const days = parseDays(dow);
    return days && days.length > 0 ? { kind: "weekly", days, time: timeOrNull } : null;
  }
  if (dow === "*") {
    if (dom === "L") return { kind: "monthly", monthDay: "last", time: timeOrNull };
    if (NUM.test(dom) && Number(dom) >= 1 && Number(dom) <= MAX_MONTH_DAY) {
      return { kind: "monthly", monthDay: Number(dom), time: timeOrNull };
    }
  }
  return null;
}

/**
 * The cron to keep when the frequency changes: a picker-made schedule of another kind
 * (weekdays, after switching to ~mensual) would keep the old rhythm, so it goes; a custom
 * cron written by hand stays.
 */
export function cronAfterFrequencyChange(cron: string | null | undefined, frequency: ActivityRow["frequency"]): string | null {
  if (!cron) return null;
  if (frequency === "CUSTOM") return cron; // switching to custom: start from what was picked
  const picked = fromCron(cron);
  if (!picked) return cron;
  return picked.kind === kindOfFrequency(frequency) ? cron : null;
}
