import type { ActivityRow } from "@/lib/db/types";

/**
 * Spaced review for attitudes and skills (docs/05-line-mapping.md §4, confirmed 2026-11-18).
 * Ticking one asks "how did it go?": Bien moves one step up the ladder (a longer wait), Mal one
 * step down (sooner; never below the first step). The line is hidden until 03:00 local time on
 * the day the wait ends. "Bien" on the last step means it is internalized: the line is completed.
 * A missed review costs nothing: the line just waits on the page. The spacing replaces any
 * `~frequency` the line has. Pure.
 */

export type ReviewInterval = { days: number } | { months: number };

/** 1 day · 3 days · 1 week · 2 weeks · 1 month · 2 months · 3 months · 6 months. */
export const REVIEW_LADDER: readonly ReviewInterval[] = [
  { days: 1 },
  { days: 3 },
  { days: 7 },
  { days: 14 },
  { months: 1 },
  { months: 2 },
  { months: 3 },
  { months: 6 },
];

export const LAST_REVIEW_STEP = REVIEW_LADDER.length - 1;

/** Local hour the line comes back on its review day. */
export const REVIEW_HOUR = 3;

type Row = Pick<ActivityRow, "activityType">;

/** Types that are reviewed with spacing instead of a fixed frequency. */
export function isSpaced(row: Row): boolean {
  return row.activityType === "ATTITUDE" || row.activityType === "SKILL";
}

export interface ReviewOutcome {
  /** The step the line is now on (index into REVIEW_LADDER). */
  step: number;
  /** "Bien" on the last step: internalized, so the line is completed instead of hidden. */
  done: boolean;
}

/**
 * The step after a review. `step` is the line's current step (null: never reviewed).
 * The first "Bien" (or "Mal") from scratch puts it on step 0 (back in 1 day).
 */
export function reviewOutcome(step: number | null | undefined, good: boolean): ReviewOutcome {
  const current = step == null ? null : Math.min(Math.max(Math.trunc(step), 0), LAST_REVIEW_STEP);
  if (good) {
    if (current === LAST_REVIEW_STEP) return { step: LAST_REVIEW_STEP, done: true };
    return { step: current === null ? 0 : current + 1, done: false };
  }
  return { step: Math.max((current ?? 0) - 1, 0), done: false };
}

/** When a line on `step` comes back: 03:00 local on the day its wait ends. */
export function reviewDueAt(step: number, now: Date): Date {
  const interval = REVIEW_LADDER[Math.min(Math.max(step, 0), LAST_REVIEW_STEP)]!;
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  if ("days" in interval) return new Date(y, m, d + interval.days, REVIEW_HOUR, 0, 0, 0);
  // Same day of the month, or the month's last day (31 Jan + 1 month = 28/29 Feb).
  const lastDay = new Date(y, m + interval.months + 1, 0).getDate();
  return new Date(y, m + interval.months, Math.min(d, lastDay), REVIEW_HOUR, 0, 0, 0);
}
