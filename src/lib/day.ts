/**
 * The app's day (docs/05-line-mapping.md §7, confirmed 2026-11-20): a day starts at
 * 03:00 local time, not at midnight. Until then the night still belongs to the day before:
 * 2026-11-20 02:00 is part of 2026-11-19. Used wherever a *day* matters ("today", "tomorrow",
 * days left, "back tomorrow", grouping by day); exact times (a cron, "hide until 21:30",
 * "in 3 hours") are moments and do not use it. Pure.
 */

export const DAY_START_HOUR = 3;

/** Local 00:00 of the calendar day `now` belongs to (the day before, before 03:00). */
export function logicalToday(now: Date): Date {
  const shift = now.getHours() < DAY_START_HOUR ? -1 : 0;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + shift);
}

/** `day` + `n` days, at local 00:00 (DST-safe: built from the calendar fields). */
export function addDays(day: Date, n: number): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() + n);
}

/** When `day` begins: 03:00 local on that calendar day. */
export function dayStartAt(day: Date): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), DAY_START_HOUR);
}

/** `YYYY-MM-DD` of the app's day a moment belongs to (grouping key). */
export function logicalDayKey(at: Date): string {
  const d = logicalToday(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
