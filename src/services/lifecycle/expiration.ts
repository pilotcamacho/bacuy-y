import { addDays, dayStartAt } from "@/lib/day";
import type { ActivityRow } from "@/lib/db/types";
import { isoToLocalDate } from "@/services/marks/dates";
import { daysUntil } from "./tick";

/**
 * Expirations wait off the page (docs/05-line-mapping.md §4, confirmed 2026-11-20): a pending
 * `EXPIRATION` with a date stays out of the page (and of Priority) until its warning window
 * opens, `renewalLeadDays` days before the date, at the start of that day (03:00, lib/day).
 * Computed, never stored: changing the date or the lead days takes effect at once. The
 * Vencimientos tab lists them all. Without a date, overdue, or inside the window: on the page.
 * Pure; takes `now`.
 */

export const DEFAULT_RENEWAL_LEAD_DAYS = 30;

type Row = Pick<ActivityRow, "activityType" | "status" | "expirationDate" | "renewalLeadDays">;

/** The lead days in use: the row's own, or 30; never negative. */
export function leadDays(row: Pick<ActivityRow, "renewalLeadDays">): number {
  const n = row.renewalLeadDays;
  return n == null || !Number.isFinite(n) ? DEFAULT_RENEWAL_LEAD_DAYS : Math.max(0, Math.trunc(n));
}

/** When an expiration's window opens and it shows on the page (null: no date). */
export function expirationRevealAt(row: Row): Date | null {
  if (row.activityType !== "EXPIRATION" || !row.expirationDate) return null;
  return dayStartAt(addDays(isoToLocalDate(row.expirationDate), -leadDays(row)));
}

/** A pending expiration whose window has not opened yet: off the page, waiting. */
export function isExpirationWaiting(row: Row, now: Date): boolean {
  if (row.activityType !== "EXPIRATION" || !row.expirationDate) return false;
  if (row.status === "COMPLETED" || row.status === "ARCHIVED") return false;
  return daysUntil(row.expirationDate, now) > leadDays(row);
}
