import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Stored } from "@/lib/db/types";
import { hiddenLines } from "@/services/editor/pageLines";
import { usePageStore } from "@/stores/pageStore";

/**
 * Below the page: "N lines hidden until later" (repetitive tasks and habit days done for this
 * time). Expands to list them with when each comes back and "Show now".
 */
export function HiddenLines({ activities, now }: { activities: Record<string, Stored<"Activity">>; now: Date }) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const rows = useMemo(() => hiddenLines(activities, now), [activities, now]);
  if (rows.length === 0) return null;
  const when = new Intl.DateTimeFormat(i18n.resolvedLanguage, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="mt-6 text-sm">
      <button
        type="button"
        aria-expanded={open}
        data-testid="hidden-toggle"
        onClick={() => setOpen((o) => !o)}
        className="rounded px-1 text-neutral-500 outline-none hover:text-neutral-800 hover:underline focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-neutral-400 dark:hover:text-neutral-200"
      >
        <span aria-hidden="true">{open ? "▾" : "▸"} </span>
        {t("page.hidden.summary", { count: rows.length })}
      </button>
      {open && (
        <ul className="mt-2 space-y-1" data-testid="hidden-list">
          {rows.map((row, index) => {
            const title = row.title || row.rawInput || "";
            return (
              <li key={row.id} className="flex flex-wrap items-center gap-2 text-neutral-600 dark:text-neutral-400" data-testid={`hidden-item-${index}`}>
                <span className="min-w-0 flex-1 break-words">{row.rawInput}</span>
                <time className="text-xs" dateTime={row.hiddenUntil!}>
                  {t("page.hidden.returns", { date: when.format(new Date(row.hiddenUntil!)) })}
                </time>
                <button
                  type="button"
                  data-testid={`hidden-show-${index}`}
                  aria-label={t("page.hidden.showNowLine", { title })}
                  onClick={() => void usePageStore.getState().showNow(row.id)}
                  className="rounded border border-neutral-300 px-2 py-0.5 text-xs outline-none hover:bg-neutral-100 focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-neutral-700 dark:hover:bg-neutral-800"
                >
                  {t("page.hidden.showNow")}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
