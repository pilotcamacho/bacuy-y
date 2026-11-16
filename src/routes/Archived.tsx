import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { subscribe } from "@/lib/events";
import { archivedRows } from "@/services/lifecycle/archived";
import { usePageStore } from "@/stores/pageStore";

const BUTTON =
  "rounded border border-neutral-300 px-2.5 py-1 text-sm outline-none hover:bg-neutral-100 focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-neutral-700 dark:hover:bg-neutral-800";
const DANGER =
  "rounded border border-red-300 px-2.5 py-1 text-sm text-red-700 outline-none hover:bg-red-50 focus-visible:ring-2 focus-visible:ring-red-500 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950";
const DANGER_SOLID =
  "rounded bg-red-600 px-2.5 py-1 text-sm font-medium text-white outline-none hover:bg-red-700 focus-visible:ring-2 focus-visible:ring-red-400 dark:bg-red-500 dark:hover:bg-red-400";

/** Archived lines (docs/05-line-mapping.md §6): restore to the end of the page, or delete. */
export function Archived() {
  const { t, i18n } = useTranslation();
  const status = usePageStore((s) => s.status);
  const activities = usePageStore((s) => s.activities);
  const store = usePageStore.getState;
  const auth = useAuth();
  const ownerSub = auth.status === "signedIn" ? auth.user.userId : null;
  const [confirming, setConfirming] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);

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

  const rows = useMemo(() => archivedRows(activities), [activities]);
  const dateFormat = new Intl.DateTimeFormat(i18n.resolvedLanguage, { dateStyle: "medium" });

  /** The row leaves the list: keep the keyboard user on the screen (next row, or the heading). */
  function afterRemoval(index: number, message: string) {
    setConfirming(null);
    setAnnounce(message);
    requestAnimationFrame(() => {
      const items = document.querySelectorAll<HTMLButtonElement>("[data-archived-restore]");
      (items[Math.min(index, items.length - 1)] ?? headingRef.current)?.focus();
    });
  }

  if (status === "error") {
    return (
      <p role="alert" className="text-red-700 dark:text-red-300">
        {t("page.loadError")}
      </p>
    );
  }

  return (
    <section className="space-y-4">
      <header>
        <h1 ref={headingRef} tabIndex={-1} className="text-xl font-semibold outline-none">
          {t("archived.title")}
        </h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">{t("archived.intro")}</p>
      </header>
      <p className="sr-only" role="status">
        {announce}
      </p>

      {status === "ready" && rows.length === 0 && <p className="text-neutral-500 dark:text-neutral-400">{t("archived.empty")}</p>}

      <ul className="space-y-2" data-testid="archived-list">
        {rows.map((row, index) => {
          const title = row.title || row.rawInput || t("priority.untitled");
          return (
            <li
              key={row.id}
              className="flex flex-wrap items-center gap-2 rounded border border-neutral-200 p-2 dark:border-neutral-800"
              data-testid={`archived-item-${index}`}
            >
              <div className="min-w-0 flex-1">
                <p className="break-words">{row.rawInput || title}</p>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  {t(`activityType.${row.activityType ?? "ACTION"}`)} ·{" "}
                  <time dateTime={row.editedAt}>{t("archived.on", { date: dateFormat.format(new Date(row.editedAt)) })}</time>
                </p>
              </div>
              {confirming === row.id ? (
                <div className="flex items-center gap-2" role="group" aria-label={t("archived.confirm", { title })}>
                  <span className="text-sm">{t("archived.confirmShort")}</span>
                  <button
                    type="button"
                    className={DANGER_SOLID}
                    data-testid={`archived-delete-confirm-${index}`}
                    onClick={() => void store().deleteArchived(row.id).then(() => afterRemoval(index, t("archived.deleted", { title })))}
                  >
                    {t("archived.deleteYes")}
                  </button>
                  <button
                    type="button"
                    className={BUTTON}
                    autoFocus
                    onClick={() => setConfirming(null)}
                  >
                    {t("archived.cancel")}
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className={BUTTON}
                    data-archived-restore=""
                    data-testid={`archived-restore-${index}`}
                    aria-label={t("archived.restoreLine", { title })}
                    onClick={() => void store().restore(row.id).then(() => afterRemoval(index, t("archived.restored", { title })))}
                  >
                    {t("archived.restore")}
                  </button>
                  <button
                    type="button"
                    className={DANGER}
                    data-testid={`archived-delete-${index}`}
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
  );
}
