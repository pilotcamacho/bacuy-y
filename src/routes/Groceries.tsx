import { useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { LineEditor } from "@/components/LineEditor";
import { LineTabs } from "@/components/LineTabs";
import { usePageClock } from "@/hooks/usePageClock";
import { logicalToday } from "@/lib/day";
import { boughtLines } from "@/services/editor/pageLines";
import { matchesText, queryWords } from "@/services/editor/textFilter";
import { usePageStore } from "@/stores/pageStore";

const ICON_BUTTON =
  "rounded px-1.5 text-neutral-500 outline-none hover:bg-neutral-100 hover:text-neutral-900 focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100";

/**
 * The Mercado tab (docs/05-line-mapping.md §6): the shopping list. On top, the items to buy,
 * as editable lines (LineEditor, scope "groceries": a new line gets `!mercado`). Ticking one
 * means bought: it moves to "already bought" below, A→Z with a search, where one tap puts it
 * back on the list (shopping repeats).
 */
export function Groceries() {
  const { t, i18n } = useTranslation();
  const status = usePageStore((s) => s.status);
  const activities = usePageStore((s) => s.activities);
  const store = usePageStore.getState;
  const now = usePageClock(activities);
  const searchId = useId();
  const [query, setQuery] = useState("");
  const [announce, setAnnounce] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);

  const all = useMemo(() => boughtLines(activities, now), [activities, now]);
  const rows = useMemo(() => {
    const words = queryWords(query);
    return all.filter((row) => matchesText(row.rawInput || row.title || "", words));
  }, [all, query]);
  const filtering = queryWords(query).length > 0;

  const relative = new Intl.RelativeTimeFormat(i18n.resolvedLanguage, { numeric: "auto" });
  /** "today", "yesterday", "5 days ago": counted in the app's days (they start at 03:00). */
  const boughtAgo = (iso: string) => {
    const days = Math.round((logicalToday(now).getTime() - logicalToday(new Date(iso)).getTime()) / 86_400_000);
    return relative.format(-days, "day");
  };

  /** The row leaves the list: keep the keyboard user here (next row, or the heading). */
  function afterAgain(index: number, message: string) {
    setAnnounce(message);
    requestAnimationFrame(() => {
      const items = document.querySelectorAll<HTMLButtonElement>("[data-grocery-again]");
      (items[Math.min(index, items.length - 1)] ?? headingRef.current)?.focus();
    });
  }

  return (
    <section>
      <h1 className="sr-only">{t("groceries.title")}</h1>
      <LineTabs />
      <LineEditor scope="groceries" />

      {status === "ready" && (
        <section className="mt-8 space-y-3" aria-labelledby={`${searchId}-h`} data-testid="groceries-bought">
          <header className="flex items-baseline gap-2 border-b border-neutral-200 pb-1 dark:border-neutral-800">
            <h2 id={`${searchId}-h`} ref={headingRef} tabIndex={-1} className="text-sm font-semibold text-neutral-700 outline-none dark:text-neutral-300">
              {t("groceries.bought")}
            </h2>
            {all.length > 0 && <span className="text-xs tabular-nums text-neutral-500 dark:text-neutral-400">{all.length}</span>}
          </header>
          <p className="sr-only" role="status">
            {announce}
          </p>

          {all.length === 0 ? (
            <p className="text-sm text-neutral-500 dark:text-neutral-400">{t("groceries.boughtEmpty")}</p>
          ) : (
            <>
              <label htmlFor={searchId} className="sr-only">
                {t("groceries.search")}
              </label>
              <input
                id={searchId}
                type="search"
                value={query}
                placeholder={t("groceries.searchPlaceholder")}
                data-testid="groceries-search"
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape" && query) {
                    e.preventDefault();
                    setQuery("");
                  }
                }}
                className="w-full rounded border border-neutral-300 bg-white px-2 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-neutral-700 dark:bg-neutral-900"
              />
              {filtering && rows.length === 0 && (
                <p className="text-sm text-neutral-500 dark:text-neutral-400" data-testid="groceries-search-empty">
                  {t("hidden.noMatches", { query: query.trim() })}
                </p>
              )}
              <ul className="divide-y divide-neutral-100 dark:divide-neutral-800/70">
                {rows.map((row, index) => {
                  const title = row.title || row.rawInput || t("priority.untitled");
                  return (
                    <li key={row.id} className="flex items-center gap-2 py-1.5" data-testid={`grocery-bought-${index}`}>
                      <button
                        type="button"
                        data-grocery-again=""
                        data-testid={`grocery-again-${index}`}
                        aria-label={t("groceries.againLine", { title })}
                        title={t("groceries.again")}
                        onClick={() => void store().showNow(row.id).then(() => afterAgain(index, t("groceries.addedBack", { title })))}
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-emerald-300 text-lg leading-none text-emerald-700 outline-none transition hover:bg-emerald-50 focus-visible:ring-2 focus-visible:ring-emerald-500 dark:border-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-950/40"
                      >
                        <span aria-hidden="true">+</span>
                      </button>
                      <span className="min-w-0 flex-1 break-words">{title}</span>
                      {row.completedAt && (
                        <time className="shrink-0 text-xs text-neutral-500 dark:text-neutral-400" dateTime={row.completedAt}>
                          {boughtAgo(row.completedAt)}
                        </time>
                      )}
                      <button
                        type="button"
                        className={ICON_BUTTON}
                        data-testid={`grocery-more-${index}`}
                        aria-label={t("completed.moreLine", { title })}
                        onClick={() => store().openPanel(row.id)}
                      >
                        ⋯
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </section>
      )}
    </section>
  );
}
