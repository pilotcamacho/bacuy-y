import type { ActivityRow } from "@/lib/db/types";

/** The Archived view's rows (docs/05-line-mapping.md §6): not deleted, ARCHIVED, newest edit first. */
export function archivedRows<T extends Pick<ActivityRow, "status" | "editedAt"> & { deletedAt?: string | null }>(
  activities: Record<string, T>,
): T[] {
  return Object.values(activities)
    .filter((a) => !a.deletedAt && a.status === "ARCHIVED")
    .sort((a, b) => (a.editedAt < b.editedAt ? 1 : a.editedAt > b.editedAt ? -1 : 0));
}
