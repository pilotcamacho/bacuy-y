import { CronExpressionParser } from "cron-parser";
import type { ActivityFlagRow, ActivityRow, FlagRow } from "@/lib/db/types";
import { DEFAULT_RENEWAL_LEAD_DAYS, leadDays } from "@/services/lifecycle/expiration";
import { daysUntil } from "@/services/lifecycle/tick";

/**
 * Priority score, ported from bacuy-x `services/priority/score.ts` (docs/05-line-mapping.md §6):
 *
 *   pathScore(flag) = Π over flag → root of ( weight / sum(weights of its siblings) )
 *   flagScore       = max pathScore over the activity's flags            (0 if none)
 *   cronBoost       = 0.3 if the next cron occurrence is within 60 min, else 0
 *   score           = flagScore × (1 + cronBoost)
 *   EXPIRATION      = flagScore / max(daysUntil(expirationDate), 1) × (1 + cronBoost)
 *
 * Differences from bacuy-x: each weight is divided by its siblings' real sum instead of 100
 * (CLAUDE.md rule 11: sums can drift after a merge); no neglect multiplier (needs the timer)
 * and no environment boost (needs location). Days until an expiration are calendar days (the
 * same count the line's badge shows) instead of bacuy-x's rounded-up 24 h periods.
 * With sums of 100 and whole days the results are identical.
 * Everything takes `now`, so it is pure and testable.
 */

export const CRON_BOOST = 0.3;
export const CRON_WINDOW_MINUTES = 60;
export { DEFAULT_RENEWAL_LEAD_DAYS };

type FlagLike = Pick<FlagRow, "id" | "parentId" | "weight"> & { deletedAt?: string | null };
type LinkLike = Pick<ActivityFlagRow, "activityId" | "flagId"> & { deletedAt?: string | null };
type ScoredActivity = Pick<ActivityRow, "id" | "activityType" | "cron" | "expirationDate">;
type ListedActivity = ScoredActivity &
  Pick<ActivityRow, "status" | "isHidden" | "hiddenUntil" | "renewalLeadDays" | "position"> & { deletedAt?: string | null };

/** Live flags by id, and each sibling group's weight sum (keyed by parentId, "" for roots). */
export interface FlagIndex {
  byId: Map<string, FlagLike>;
  groupSum: Map<string, number>;
}

export function indexFlags(flags: Iterable<FlagLike>): FlagIndex {
  const byId = new Map<string, FlagLike>();
  const groupSum = new Map<string, number>();
  for (const f of flags) {
    if (f.deletedAt) continue;
    byId.set(f.id, f);
    const key = f.parentId ?? "";
    groupSum.set(key, (groupSum.get(key) ?? 0) + Math.max(f.weight ?? 0, 0));
  }
  return { byId, groupSum };
}

/** The flag's share of its sibling group (0..1). A group summing to 0 gives 0. */
export function normalizedWeight(flag: FlagLike, index: FlagIndex): number {
  const sum = index.groupSum.get(flag.parentId ?? "") ?? 0;
  if (sum <= 0) return 0;
  return Math.max(flag.weight ?? 0, 0) / sum;
}

/**
 * Walks from the flag to its root multiplying normalized weights. Root 20 % → 0.20; a child
 * with 50 % under it → 0.10. An unknown flag scores 0; a deleted or missing parent ends the
 * walk (the flag is treated as a root, as the flag screen shows it).
 */
export function flagPathScore(flagId: string, index: FlagIndex): number {
  let score = 1;
  let current = index.byId.get(flagId);
  if (!current) return 0;
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    score *= normalizedWeight(current, index);
    current = current.parentId ? index.byId.get(current.parentId) : undefined;
  }
  return score;
}

/** Highest path score among the activity's live flags; 0 without flags. */
export function computeFlagScore(flagIds: Iterable<string>, index: FlagIndex): number {
  let best = 0;
  for (const id of flagIds) best = Math.max(best, flagPathScore(id, index));
  return best;
}

/** The next occurrence is within the next hour. An invalid cron is never active. */
export function isCronActive(cron: string, now: Date): boolean {
  try {
    const next = CronExpressionParser.parse(cron, { currentDate: now }).next().toDate();
    return (next.getTime() - now.getTime()) / 60_000 <= CRON_WINDOW_MINUTES;
  } catch {
    return false;
  }
}

/** An expiration shows in the priority view from `renewalLeadDays` before its date (and after). */
export function isExpirationVisible(expirationDate: string, renewalLeadDays: number | null | undefined, now: Date): boolean {
  const days = daysUntil(expirationDate, now);
  if (Number.isNaN(days)) return true;
  return days <= leadDays({ renewalLeadDays }); // the same rule as the page (lifecycle/expiration)
}

export function computeActivityScore(activity: ScoredActivity, flagIds: Iterable<string>, index: FlagIndex, now: Date): number {
  const base = computeFlagScore(flagIds, index);
  const boost = 1 + (activity.cron && isCronActive(activity.cron, now) ? CRON_BOOST : 0);
  if (activity.activityType === "EXPIRATION" && activity.expirationDate) {
    const days = daysUntil(activity.expirationDate, now);
    if (!Number.isNaN(days)) return (base / Math.max(days, 1)) * boost;
  }
  return base * boost;
}

/** Each activity's flag ids (live links only). */
export function flagIdsByActivity(links: Iterable<LinkLike>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const link of links) {
    if (link.deletedAt || !link.flagId) continue;
    const list = out.get(link.activityId);
    if (list) list.push(link.flagId);
    else out.set(link.activityId, [link.flagId]);
  }
  return out;
}

/** Rows of the priority view (docs/05-line-mapping.md §6). */
export function isPriorityCandidate(a: ListedActivity, now: Date): boolean {
  if (a.deletedAt || a.status !== "ACTIVE" || a.isHidden) return false;
  if (a.activityType === "GROCERY") return false; // the shopping list is not ranked (Mercado tab)
  if (a.hiddenUntil && new Date(a.hiddenUntil) > now) return false;
  if (a.activityType === "EXPIRATION" && a.expirationDate) {
    return isExpirationVisible(a.expirationDate, a.renewalLeadDays, now);
  }
  return true;
}

export interface Scored<T> {
  activity: T;
  score: number;
  cronActive: boolean;
}

/** Filtered and sorted, highest score first; ties keep the page order. Pure: use in useMemo. */
export function computePriorityList<T extends ListedActivity>(
  activities: Iterable<T>,
  links: Iterable<LinkLike>,
  flags: Iterable<FlagLike>,
  now: Date,
): Scored<T>[] {
  const index = indexFlags(flags);
  const linked = flagIdsByActivity(links);
  const out: Scored<T>[] = [];
  for (const activity of activities) {
    if (!isPriorityCandidate(activity, now)) continue;
    out.push({
      activity,
      score: computeActivityScore(activity, linked.get(activity.id) ?? [], index, now),
      cronActive: !!activity.cron && isCronActive(activity.cron, now),
    });
  }
  return out.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const pa = a.activity.position ?? "";
    const pb = b.activity.position ?? "";
    return pa < pb ? -1 : pa > pb ? 1 : 0;
  });
}
