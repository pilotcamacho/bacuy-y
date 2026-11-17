import type { ActivityRow } from "@/lib/db/types";

/**
 * Completed lines (docs/05-line-mapping.md §6). They leave the page for the Completed page,
 * which reads them from the device only when it is open: the page store keeps in memory only
 * what the page, the priority view, the archive and the journal show.
 */

type Row = Pick<ActivityRow, "status" | "activityType" | "editedAt" | "completedAt"> & { deletedAt?: string | null };

/**
 * When it was completed. Lines completed before `completedAt` existed fall back to their last
 * edit (close, but later if the text was edited after completing).
 */
export function completedAtOf(row: Pick<Row, "completedAt" | "editedAt">): string {
  return row.completedAt ?? row.editedAt;
}

/** Gratitude entries are completed too, but their page is the journal. */
export function isCompletedTask(row: Row): boolean {
  return !row.deletedAt && row.status === "COMPLETED" && row.activityType !== "GRATITUDE";
}

/** The Completed page's rows: newest completion first. */
export function completedRows<T extends Row>(rows: Iterable<T>): T[] {
  return [...rows]
    .filter(isCompletedTask)
    .sort((a, b) => {
      const x = completedAtOf(a);
      const y = completedAtOf(b);
      return x < y ? 1 : x > y ? -1 : 0;
    });
}

/** Whether the page store loads this row into memory (everything but completed tasks). */
export function keepInMemory(row: Row): boolean {
  return row.status !== "COMPLETED" || row.activityType === "GRATITUDE";
}

/** Local calendar day of an ISO time, `YYYY-MM-DD` (grouping key). */
export function localDay(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
