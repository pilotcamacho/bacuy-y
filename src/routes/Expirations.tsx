import { useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { LinePanel } from "@/components/LinePanel";
import { LineTabs } from "@/components/LineTabs";
import { useAuth } from "@/hooks/useAuth";
import { usePageClock } from "@/hooks/usePageClock";
import { subscribe } from "@/lib/events";
import { expirationLines } from "@/services/editor/pageLines";
import { matchesText, queryWords } from "@/services/editor/textFilter";
import { expirationRevealAt, isExpirationWaiting, leadDays } from "@/services/lifecycle/expiration";
import { isHiddenNow } from "@/services/lifecycle/nextShow";
import { daysUntil } from "@/services/lifecycle/tick";
import { isoToLocalDate } from "@/services/marks/dates";
import { usePageStore } from "@/stores/pageStore";

const BUTTON =
  "rounded border border-neutral-300 px-2.5 py-1 text-sm outline-none hover:bg-neutral-100 focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-neutral-700 dark:hover:bg-neutral-800";
const ICON_BUTTON =
  "rounded px-1.5 text-neutral-500 outline-none hover:bg-neutral-100 hover:text-neutral-900 focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100";

/**
 * Vencimientos (docs/05-line-mapping.md §6): every pending expiration, the soonest first,
 * undated last. Each shows its date, the days left (the badge's colors) and where it is now:
 * on the page, hidden by hand, or waiting until its window opens (lifecycle/expiration).
 */
export function Expirations() {
  const { t, i18n } = useTranslation();
  const status = usePageStore((s) => s.status);
  const activities = usePageStore((s) => s.activities);
  const store = usePageStore.getState;
  const auth = useAuth();
  const ownerSub = auth.status === "signedIn" ? auth.user.userId : null;
  const now = usePageClock(activities);
  const searchId = useId();
  const [query, setQuery] = useState("");

  useEffect(() => {
    void store().load(ownerSub);
  }, [store, ownerSub]);
  useEffect(
    () =>
      subscribe((event, fromOtherTab) => {
        if ((event.type === "synced" && event.changed) || (event.type === "localWrite" && fromOtherTab)) void store().refresh();
      }),
    [store],
  );

  const all = useMemo(() => expirationLines(activities), [activities]);
  const rows = useMemo(() => {
    const words = queryWords(query);
    return all.filter((row) => matchesText(row.rawInput || row.title || "", words));
  }, [all, query]);
  const filtering = queryWords(query).length > 0;
  const lang = i18n.resolvedLanguage;
  const dateFmt = new Intl.DateTimeFormat(lang, { day: "numeric", month: "short", year: "numeric" });
  const revealFmt = new Intl.DateTimeFormat(lang, { weekday: "short", day: "numeric", month: "short", year: "numeric" });

  if (status === "error") {
    return (
      <p role="alert" className="text-red-700 dark:text-red-300">
        {t("page.loadError")}
      </p>
    );
  }

  return (
    <section className="space-y-4">
      <LineTabs />
      <header>
        <h1 className="text-xl font-semibold">{t("expirations.title")}</h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">{t("expirations.intro")}</p>
      </header>

      {status === "ready" && all.length === 0 && <p className="text-neutral-500 dark:text-neutral-400">{t("expirations.empty")}</p>}

      {all.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={searchId} className="sr-only">
            {t("expirations.search")}
          </label>
          <input
            id={searchId}
            type="search"
            value={query}
            placeholder={t("expirations.searchPlaceholder")}
            data-testid="expirations-search"
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && query) {
                e.preventDefault();
                setQuery("");
              }
            }}
            className="min-w-0 flex-1 rounded border border-neutral-300 bg-white px-2 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-neutral-700 dark:bg-neutral-900"
          />
          {filtering && (
            <span className="text-xs text-neutral-500 dark:text-neutral-400" role="status">
              {t("expirations.matches", { count: rows.length, total: all.length })}
            </span>
          )}
        </div>
      )}
      {filtering && rows.length === 0 && <p className="text-neutral-500 dark:text-neutral-400">{t("expirations.noMatches", { query: query.trim() })}</p>}

      <ul className="space-y-2" data-testid="expirations-list">
        {rows.map((row, index) => {
          const title = row.title || row.rawInput || t("priority.untitled");
          let where: string;
          let days: number | null = null;
          if (!row.expirationDate) where = t("expirations.noDate");
          else {
            days = daysUntil(row.expirationDate, now);
            if (isExpirationWaiting(row, now)) where = t("expirations.appears", { date: revealFmt.format(expirationRevealAt(row)!) });
            else if (isHiddenNow(row, now)) where = t("expirations.hiddenByHand");
            else where = t("expirations.onPage");
          }
          const color =
            days === null
              ? "text-neutral-500 dark:text-neutral-400"
              : days < 0
                ? "text-red-600 dark:text-red-400"
                : days <= leadDays(row)
                  ? "text-amber-700 dark:text-amber-400"
                  : "text-neutral-500 dark:text-neutral-400";
          return (
            <li key={row.id} className="rounded border border-neutral-200 p-2 dark:border-neutral-800" data-testid={`expiration-item-${index}`}>
              <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className="break-words">{row.rawInput || title}</p>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">
                    {row.expirationDate && (
                      <>
                        <time dateTime={row.expirationDate} className={`font-medium ${color}`}>
                          {dateFmt.format(isoToLocalDate(row.expirationDate))} ·{" "}
                          {days! > 0 ? t("line.daysLeft", { count: days! }) : days === 0 ? t("line.dueToday") : t("line.overdue", { count: -days! })}
                        </time>
                        {" · "}
                      </>
                    )}
                    <span data-testid={`expiration-where-${index}`}>{where}</span>
                  </p>
                </div>
                <button
                  type="button"
                  className={BUTTON}
                  data-testid={`expiration-renew-${index}`}
                  aria-label={t("expirations.renewLine", { title })}
                  onClick={() => store().openPanel(row.id, "expiration")}
                >
                  {t("expirations.renew")}
                </button>
                <button
                  type="button"
                  className={ICON_BUTTON}
                  data-testid={`expiration-more-${index}`}
                  aria-label={t("expirations.moreLine", { title })}
                  onClick={() => store().openPanel(row.id)}
                >
                  ⋯
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      <LinePanel />
    </section>
  );
}
