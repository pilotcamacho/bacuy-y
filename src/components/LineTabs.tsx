import { useMemo } from "react";
import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { usePageClock } from "@/hooks/usePageClock";
import { LINE_TABS as TABS } from "@/lib/lineTabs";
import { hiddenLines } from "@/services/editor/pageLines";
import { usePageStore } from "@/stores/pageStore";

/** The tabs of the "Page" section (lib/lineTabs): where lines are. "Hidden" shows its count. */
export function LineTabs() {
  const { t } = useTranslation();
  const activities = usePageStore((s) => s.activities);
  const now = usePageClock(activities);
  const hidden = useMemo(() => hiddenLines(activities, now).length, [activities, now]);
  return (
    <nav
      aria-label={t("lines.tabs.label")}
      data-testid="line-tabs"
      className="mb-3 flex flex-wrap gap-1 border-b border-neutral-200 text-sm dark:border-neutral-800"
    >
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end
          className={({ isActive }) =>
            [
              "-mb-px rounded-t border-b-2 px-2 py-1 outline-none focus-visible:ring-2 focus-visible:ring-indigo-500",
              isActive
                ? "border-indigo-600 text-indigo-700 dark:border-indigo-400 dark:text-indigo-300"
                : "border-transparent text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100",
            ].join(" ")
          }
        >
          {t(tab.key)}
          {tab.to === "/hidden" && hidden > 0 && (
            <span
              className="ms-1.5 rounded-full bg-neutral-200 px-1.5 text-xs tabular-nums text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
              aria-label={t("lines.tabs.hiddenCount", { count: hidden })}
              data-testid="hidden-count"
            >
              {hidden}
            </span>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
