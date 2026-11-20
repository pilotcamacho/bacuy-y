import type { ActivityRow } from "@/lib/db/types";

/**
 * "A moment of gratitude" (docs/05-line-mapping.md §6): one past gratitude entry shown at the
 * top of the page, chosen at random. Pure helpers; the component keeps the choice.
 */

/** Completed, not deleted gratitude entries that have notes, in a stable order (by id). Pure. */
export function memoryCandidates(activities: Record<string, ActivityRow>): ActivityRow[] {
  return Object.values(activities)
    .filter((a) => !a.deletedAt && a.activityType === "GRATITUDE" && a.status === "COMPLETED" && (a.description ?? "").trim() !== "")
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * A random id from `ids`, never `avoid` when there is another choice (so a tap, or opening the
 * app again, always shows a different entry). Null when there is nothing to show.
 */
export function pickMemory(ids: readonly string[], avoid: string | null, random: () => number = Math.random): string | null {
  const pool = ids.length > 1 && avoid !== null ? ids.filter((id) => id !== avoid) : ids;
  if (pool.length === 0) return null;
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))] ?? null;
}

/** The entry shown in this visit: kept across route changes, not across a reload. */
export const memorySession: { current: string | null } = { current: null };
export function resetGratitudeMemoryForTests() {
  memorySession.current = null;
}

/** When the entry was written: its completion, or its last edit for older rows. */
export function memoryDate(a: ActivityRow): Date {
  return new Date(a.completedAt ?? a.editedAt);
}
