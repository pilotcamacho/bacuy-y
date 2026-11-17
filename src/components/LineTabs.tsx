import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { LINE_TABS as TABS } from "@/lib/lineTabs";

export function LineTabs() {
  const { t } = useTranslation();
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
        </NavLink>
      ))}
    </nav>
  );
}
