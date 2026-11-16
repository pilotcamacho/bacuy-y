import type { ActivityRow } from "@/lib/db/types";

/** Completed gratitude entries, newest first (docs/05-line-mapping.md §6). Pure; used in useMemo. */
export function journalEntries(activities: Record<string, ActivityRow>): ActivityRow[] {
  return Object.values(activities)
    .filter((a) => !a.deletedAt && a.activityType === "GRATITUDE" && a.status === "COMPLETED")
    .sort((a, b) => (a.editedAt < b.editedAt ? 1 : a.editedAt > b.editedAt ? -1 : 0));
}
