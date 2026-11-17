import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { HideChooser } from "@/components/HideChooser";
import { LinePanel } from "@/components/LinePanel";
import { LineTabs } from "@/components/LineTabs";
import { useAuth } from "@/hooks/useAuth";
import { usePageClock } from "@/hooks/usePageClock";
import { subscribe } from "@/lib/events";
import { hiddenLines } from "@/services/editor/pageLines";
import { usePageStore } from "@/stores/pageStore";

const BUTTON =
  "rounded border border-neutral-300 px-2.5 py-1 text-sm outline-none hover:bg-neutral-100 focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-neutral-700 dark:hover:bg-neutral-800";
const ICON_BUTTON =
  "rounded px-1.5 text-neutral-500 outline-none hover:bg-neutral-100 hover:text-neutral-900 focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100";

/**
 * Hidden lines (docs/05-line-mapping.md §6): hidden by hand (until a date, or until shown
 * again) and repetitive tasks / habits done for this time. The soonest back first. Each one:
 * show now, or change when it comes back.
 */
export function Hidden() {
  const { t, i18n } = useTranslation();
  const status = usePageStore((s) => s.status);
  const activities = usePageStore((s) => s.activities);
  const store = usePageStore.getState;
  const auth = useAuth();
  const ownerSub = auth.status === "signedIn" ? auth.user.userId : null;
  const now = usePageClock(activities);
  const [changing, setChanging] = useState<string | null>(null);
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

  const rows = useMemo(() => hiddenLines(activities, now), [activities, now]);
  const when = new Intl.DateTimeFormat(i18n.resolvedLanguage, { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

  /** The row leaves the list: keep the keyboard user on the screen (next row, or the heading). */
  function afterRemoval(index: number, message: string) {
    setAnnounce(message);
    requestAnimationFrame(() => {
      const items = document.querySelectorAll<HTMLButtonElement>("[data-hidden-show]");
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
      <LineTabs />
      <header>
        <h1 ref={headingRef} tabIndex={-1} className="text-xl font-semibold outline-none">
          {t("hidden.title")}
        </h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">{t("hidden.intro")}</p>
      </header>
      <p className="sr-only" role="status">
        {announce}
      </p>

      {status === "ready" && rows.length === 0 && <p className="text-neutral-500 dark:text-neutral-400">{t("hidden.empty")}</p>}

      <ul className="space-y-2" data-testid="hidden-list">
        {rows.map((row, index) => {
          const title = row.title || row.rawInput || t("priority.untitled");
          return (
            <li key={row.id} className="rounded border border-neutral-200 p-2 dark:border-neutral-800" data-testid={`hidden-item-${index}`}>
              <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className="break-words">{row.rawInput || title}</p>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">
                    {row.isHidden ? (
                      t("hidden.untilShown")
                    ) : (
                      <time dateTime={row.hiddenUntil!}>{t("page.hidden.returns", { date: when.format(new Date(row.hiddenUntil!)) })}</time>
                    )}
                  </p>
                </div>
                <button
                  type="button"
                  className={BUTTON}
                  data-hidden-show=""
                  data-testid={`hidden-show-${index}`}
                  aria-label={t("page.hidden.showNowLine", { title })}
                  onClick={() => void store().showNow(row.id).then(() => afterRemoval(index, t("hidden.shown", { title })))}
                >
                  {t("page.hidden.showNow")}
                </button>
                <button
                  type="button"
                  className={BUTTON}
                  aria-expanded={changing === row.id}
                  data-testid={`hidden-change-${index}`}
                  aria-label={t("hidden.changeLine", { title })}
                  onClick={() => setChanging((c) => (c === row.id ? null : row.id))}
                >
                  {t("hidden.change")}
                </button>
                <button
                  type="button"
                  className={ICON_BUTTON}
                  data-testid={`hidden-more-${index}`}
                  aria-label={t("completed.moreLine", { title })}
                  onClick={() => store().openPanel(row.id)}
                >
                  ⋯
                </button>
              </div>
              {changing === row.id && (
                <div className="mt-2 border-t border-neutral-100 pt-2 dark:border-neutral-800">
                  <HideChooser
                    testPrefix={`hidden-${index}`}
                    onHide={(until) => {
                      setChanging(null);
                      void store()
                        .updateFields(row.id, until ? { hiddenUntil: until, isHidden: false } : { hiddenUntil: null, isHidden: true })
                        .then(() => setAnnounce(t("hidden.changed", { title })));
                    }}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <LinePanel />
    </section>
  );
}
