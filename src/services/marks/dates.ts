import { logicalToday } from "@/lib/day";
import { DATE_TODAY, DATE_TOMORROW, WEEKDAYS, normalize } from "./keywords";

/**
 * `@date` bodies → a calendar day. Pure: "today" is always passed in.
 * Forms (docs/05-line-mapping.md §2.3): hoy/today, mañana/tomorrow, weekday names (next one,
 * today excluded), ISO yyyy-mm-dd (canonical), d/m and d/m/yyyy (day first; without a year it
 * is the next occurrence, today included).
 */

export interface CalendarDay {
  year: number;
  month: number; // 1–12
  day: number;
}

export interface ParsedDate extends CalendarDay {
  /** true for the canonical `yyyy-mm-dd` form; anything else is rewritten on commit. */
  canonical: boolean;
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_FIRST = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/;

function isValid(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const d = new Date(year, month - 1, day);
  return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day;
}

function fromDate(d: Date): CalendarDay {
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
}

function addDays(today: Date, days: number): Date {
  return new Date(today.getFullYear(), today.getMonth(), today.getDate() + days);
}

export function parseDateBody(body: string, now: Date): ParsedDate | undefined {
  const word = normalize(body);
  const today = logicalToday(now); // at 01:00 "@mañana" is the day after the night's day

  if (DATE_TODAY.includes(word)) return { ...fromDate(addDays(today, 0)), canonical: false };
  if (DATE_TOMORROW.includes(word)) return { ...fromDate(addDays(today, 1)), canonical: false };

  const weekday = WEEKDAYS.findIndex((names) => names.includes(word));
  if (weekday >= 0) {
    const ahead = ((weekday - today.getDay() + 7) % 7) || 7; // today excluded
    return { ...fromDate(addDays(today, ahead)), canonical: false };
  }

  const iso = ISO.exec(word);
  if (iso) {
    const [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
    return isValid(year, month, day) ? { year, month, day, canonical: true } : undefined;
  }

  const dm = DAY_FIRST.exec(word);
  if (dm) {
    const day = Number(dm[1]);
    const month = Number(dm[2]);
    if (dm[3]) {
      const year = Number(dm[3]);
      return isValid(year, month, day) ? { year, month, day, canonical: false } : undefined;
    }
    // Next occurrence, today included. 29/2 looks ahead to the next leap year.
    const start = fromDate(today);
    for (let year = start.year; year <= start.year + 8; year++) {
      if (!isValid(year, month, day)) continue;
      const candidate = new Date(year, month - 1, day);
      if (candidate >= addDays(today, 0)) return { year, month, day, canonical: false };
    }
    return undefined;
  }

  return undefined;
}

/** `yyyy-mm-dd`, the canonical mark body. */
export function canonicalDateBody(d: CalendarDay): string {
  return `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
}

/** Stored value: the start of that day in local time, as an ISO datetime. */
export function dayToIso(d: CalendarDay): string {
  // A calendar day, not a moment: UTC midnight, read back with UTC fields, so it is the same
  // day on every device whatever its time zone (docs/05-line-mapping.md §7).
  return new Date(Date.UTC(d.year, d.month - 1, d.day)).toISOString();
}

/**
 * The calendar day of a stored date. Dates saved before 2026-11-20 are the writer's local
 * midnight (e.g. Bogotá → 05:00Z): any value not at exactly 00:00 UTC is read in local time,
 * as it always was. The line's text re-derives them in the new form on the next edit.
 */
export function isoToDay(iso: string): CalendarDay {
  const d = new Date(iso);
  if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0) {
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
  }
  return fromDate(d);
}

/** Local 00:00 of a stored calendar date (to format it or count days). */
export function isoToLocalDate(iso: string): Date {
  const day = isoToDay(iso);
  return new Date(day.year, day.month - 1, day.day);
}
