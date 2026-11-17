import type { ActivityRow } from "@/lib/db/types";
import { isHiddenNow } from "@/services/lifecycle/nextShow";
import { compareLines, type EditorLine } from "./index";

type PageRow = Pick<ActivityRow, "id" | "rawInput" | "position" | "status" | "deletedAt" | "hiddenUntil">;

/** Completed and archived lines live on their own pages, never on the page. */
const offPage = (a: Pick<ActivityRow, "status" | "deletedAt">) =>
  !!a.deletedAt || a.status === "ARCHIVED" || a.status === "COMPLETED";

/**
 * The page (CLAUDE.md, rule 1): every activity not deleted, archived or completed, by
 * position, except lines hidden until a later time (a repetitive task done for this time).
 * Pure; components call it inside useMemo with their own clock.
 */
export function pageLines(activities: Record<string, PageRow>, now: Date = new Date()): EditorLine[] {
  const lines: EditorLine[] = [];
  for (const a of Object.values(activities)) {
    if (offPage(a) || isHiddenNow(a, now)) continue;
    lines.push({ id: a.id, rawInput: a.rawInput ?? "", position: a.position });
  }
  return lines.sort(compareLines);
}

/** Lines hidden until later, the soonest back first. */
export function hiddenLines<T extends PageRow>(activities: Record<string, T>, now: Date = new Date()): T[] {
  return Object.values(activities)
    .filter((a) => !offPage(a) && isHiddenNow(a, now))
    .sort((a, b) => (a.hiddenUntil! < b.hiddenUntil! ? -1 : a.hiddenUntil! > b.hiddenUntil! ? 1 : 0));
}

/** The earliest moment a hidden line comes back (to re-render the page then), or null. */
export function nextReveal(activities: Record<string, PageRow>, now: Date = new Date()): Date | null {
  let soonest: Date | null = null;
  for (const a of Object.values(activities)) {
    if (offPage(a) || !isHiddenNow(a, now)) continue;
    const at = new Date(a.hiddenUntil!);
    if (!soonest || at < soonest) soonest = at;
  }
  return soonest;
}

/** Shown when the page has no lines, so there is always somewhere to type. Not stored. */
export const GHOST_LINE_ID = "__ghost__";
export const GHOST_LINE: EditorLine = { id: GHOST_LINE_ID, rawInput: "", position: "" };
