import { useEffect, useState } from "react";
import type { ActivityRow } from "@/lib/db/types";
import { nextReveal } from "@/services/editor/pageLines";

type Row = Pick<
  ActivityRow,
  "id" | "rawInput" | "position" | "status" | "deletedAt" | "hiddenUntil" | "isHidden" | "activityType" | "expirationDate" | "renewalLeadDays"
>;

/**
 * The page's clock: "now" for deciding which lines are hidden. It ticks when the next hidden
 * line is due back, and when the tab becomes visible again (timers sleep in background tabs).
 */
export function usePageClock(activities: Record<string, Row>): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const at = nextReveal(activities, now);
    if (!at) return;
    const delay = Math.min(Math.max(at.getTime() - Date.now() + 50, 0), 2_147_483_647);
    const timer = setTimeout(() => setNow(new Date()), delay);
    return () => clearTimeout(timer);
  }, [activities, now]);
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") setNow(new Date());
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);
  return now;
}
