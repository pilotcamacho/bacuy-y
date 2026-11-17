import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { LinePanel } from "@/components/LinePanel";
import { LineTabs } from "@/components/LineTabs";
import { useAuth } from "@/hooks/useAuth";
import { getDb } from "@/lib/db/instance";
import type { Stored } from "@/lib/db/types";
import { subscribe } from "@/lib/events";
import { completedAtOf, completedRows, localDay } from "@/services/lifecycle/completed";
import { usePageStore } from "@/stores/pageStore";

type Activity = Stored<"Activity">;

/** Rows shown at first, and added by each "show more". */
export const COMPLETED_PAGE_SIZE = 50;

const BUTTON =
  "rounded border border-neutral-300 px-2.5 py-1 text-sm outline-none hover:bg-neutral-100 focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-neutral-700 dark:hover:bg-neutral-800";
const ICON_BUTTON =
  "rounded px-1.5 text-neutral-500 outline-none hover:bg-neutral-100 hover:text-neutral-900 focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100";
const DANGER =
  "rounded border border-red-300 px-2.5 py-1 text-sm text-red-700 outline-none hover:bg-red-50 focus-visible:ring-2 focus-visible:ring-red-500 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950";
const DANGER_SOLID =
  "rounded bg-red-600 px-2.5 py-1 text-sm font-medium text-white outline-none hover:bg-red-700 focus-visible:ring-2 focus-visible:ring-red-400 dark:bg-red-500 dark:hover:bg-red-400";

/**
 * Completed tasks (docs/05-line-mapping.md §6), newest first, grouped by day. Read from the
 * device when this page is open (the page store does not keep them in memory). Untick: back
 * on the page at its old place.
 */
export function Completed() {
  const { t, i18n } = useTranslation();
  const store = usePageStore.getState;
  const auth = useAuth();
  const ownerSub = auth.status === "signedIn" ? auth.user.userId : null;
  const [rows, setRows] = useState<Activity[] | null>(null);
  const [error, setError] = useState(false);
  const [limit, setLimit] = useState(COMPLETED_PAGE_SIZE);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);

  // The panel and the flags come from the page store.
  useEffect(() => {
    void store().load(ownerSub);
  }, [store, ownerSub]);

  // Read from the device now, and again after any write (here, another tab, or a sync).
  useEffect(() => {
    let live = true;
    const read = () =>
      getDb()
        .then((db) => db.listByIndex("Activity", "status", "COMPLETED"))
        .then((found) => {
          if (live) setRows(completedRows(found));
        })
        .catch((e) => {
          console.error("[bacuyy] could not read completed lines", e);
          if (live) setError(true);
        });
    void read();
    const stop = subscribe((event, fromOtherTab) => {
      if (event.type === "localWrite" || (event.type === "synced" && event.changed)) void read();
      if ((event.type === "synced" && event.changed) || (event.type === "localWrite" && fromOtherTab)) void store().refresh();
    });
    return () => {
      live = false;
      stop();
    };
  }, [store]);

  // "Today" / "Yesterday" headings: the day the page was opened.
  const [openedAt] = useState(() => Date.now());

  const shown = useMemo(() => (rows ?? []).slice(0, limit), [rows, limit]);
  const groups = useMemo(() => {
    const out: { day: string; rows: { row: Activity; index: number }[] }[] = [];
    shown.forEach((row, index) => {
      const day = localDay(completedAtOf(row));
      const last = out.at(-1);
      if (last && last.day === day) last.rows.push({ row, index });
      else out.push({ day, rows: [{ row, index }] });
    });
    return out;
  }, [shown]);

  const lang = i18n.resolvedLanguage;
  const timeFormat = new Intl.DateTimeFormat(lang, { hour: "2-digit", minute: "2-digit" });
  const dayFormat = new Intl.DateTimeFormat(lang, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const today = localDay(new Date(openedAt).toISOString());
  const yesterday = localDay(new Date(openedAt - 86_400_000).toISOString());
  const dayLabel = (day: string) => {
    if (day === today) return t("completed.today");
    if (day === yesterday) return t("completed.yesterday");
    const [y, m, d] = day.split("-").map(Number);
    return dayFormat.format(new Date(y!, m! - 1, d!));
  };

  /** The row leaves the list: keep the keyboard user on the screen (next row, or the heading). */
  function afterRemoval(index: number, message: string) {
    setConfirming(null);
    setAnnounce(message);
    requestAnimationFrame(() => {
      const items = document.querySelectorAll<HTMLButtonElement>("[data-completed-reopen]");
      (items[Math.min(index, items.length - 1)] ?? headingRef.current)?.focus();
    });
  }

  if (error) {
    return (
      <p role="alert" className="text-red-700 dark:text-red-300">
        {t("page.loadError")}
      </p>
    );
  }

  const total = rows?.length ?? 0;

  return (
    <section className="space-y-4">
      <LineTabs />
      <header>
        <h1 ref={headingRef} tabIndex={-1} className="text-xl font-semibold outline-none">
          {t("completed.title")}
        </h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">{t("completed.intro")}</p>
      </header>
      <p className="sr-only" role="status">
        {announce}
      </p>

      {rows && total === 0 && <p className="text-neutral-500 dark:text-neutral-400">{t("completed.empty")}</p>}

      <div data-testid="completed-list" className="space-y-5">
        {groups.map((group) => (
          <section key={group.day} aria-label={dayLabel(group.day)}>
            <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500 first-letter:uppercase dark:text-neutral-400">
              {dayLabel(group.day)}
            </h2>
            <ul className="divide-y divide-neutral-100 dark:divide-neutral-800/60">
              {group.rows.map(({ row, index }) => {
                const title = row.title || row.rawInput || t("priority.untitled");
                const at = completedAtOf(row);
                return (
                  <li key={row.id} className="flex flex-wrap items-center gap-2 py-1.5" data-testid={`completed-item-${index}`}>
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked="true"
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-indigo-500 bg-indigo-500 text-xs text-white outline-none hover:bg-indigo-400 focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1 dark:border-indigo-400 dark:bg-indigo-400 dark:text-neutral-900"
                      data-completed-reopen=""
                      data-testid={`completed-reopen-${index}`}
                      aria-label={t("completed.reopenLine", { title })}
                      title={t("completed.reopen")}
                      onClick={() => void store().reopen(row.id).then(() => afterRemoval(index, t("completed.reopened", { title })))}
                    >
                      ✓
                    </button>
                    <p className="min-w-0 flex-1 break-words text-neutral-600 dark:text-neutral-300">{row.rawInput || title}</p>
                    <time dateTime={at} className="text-xs tabular-nums text-neutral-500 dark:text-neutral-400">
                      {timeFormat.format(new Date(at))}
                    </time>
                    {confirming === row.id ? (
                      <div className="flex items-center gap-2" role="group" aria-label={t("archived.confirm", { title })}>
                        <span className="text-sm">{t("archived.confirmShort")}</span>
                        <button
                          type="button"
                          className={DANGER_SOLID}
                          data-testid={`completed-delete-confirm-${index}`}
                          onClick={() =>
                            void store()
                              .deleteCompleted(row.id)
                              .then(() => afterRemoval(index, t("archived.deleted", { title })))
                          }
                        >
                          {t("archived.deleteYes")}
                        </button>
                        <button type="button" className={BUTTON} autoFocus onClick={() => setConfirming(null)}>
                          {t("archived.cancel")}
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          className={ICON_BUTTON}
                          data-testid={`completed-more-${index}`}
                          aria-label={t("completed.moreLine", { title })}
                          onClick={() => {
                            store().adopt([row]);
                            store().openPanel(row.id);
                          }}
                        >
                          ⋯
                        </button>
                        <button
                          type="button"
                          className={DANGER}
                          data-testid={`completed-delete-${index}`}
                          aria-label={t("archived.deleteLine", { title })}
                          onClick={() => setConfirming(row.id)}
                        >
                          {t("archived.delete")}
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      {total > limit && (
        <button
          type="button"
          className={BUTTON}
          data-testid="completed-show-more"
          onClick={() => setLimit((n) => n + COMPLETED_PAGE_SIZE)}
        >
          {t("completed.showMore", { count: Math.min(COMPLETED_PAGE_SIZE, total - limit) })}
        </button>
      )}
      <LinePanel />
    </section>
  );
}
