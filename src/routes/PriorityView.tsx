import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { LinePanel } from "@/components/LinePanel";
import { TickCell } from "@/components/TickCell";
import { UndoToast } from "@/components/UndoToast";
import { useAuth } from "@/hooks/useAuth";
import { subscribe } from "@/lib/events";
import { pageLines } from "@/services/editor/pageLines";
import { flagLabel } from "@/services/flags/label";
import { computePriorityList, flagIdsByActivity } from "@/services/priority/score";
import { usePageStore } from "@/stores/pageStore";

/** The cron boost depends on the clock: re-score this often. */
const RESCORE_MS = 60_000;

/**
 * Read-only priority view (docs/05-line-mapping.md §6): the ACTIVE lines, highest score first.
 * Tick and panel work here; the text is edited on the page (clicking a line goes there).
 */
export function PriorityView() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const status = usePageStore((s) => s.status);
  const activities = usePageStore((s) => s.activities);
  const activityFlags = usePageStore((s) => s.activityFlags);
  const flags = usePageStore((s) => s.flags);
  const panel = usePageStore((s) => s.panel);
  const store = usePageStore.getState;
  const auth = useAuth();
  const ownerSub = auth.status === "signedIn" ? auth.user.userId : null;
  const [now, setNow] = useState(() => new Date());
  const listRef = useRef<HTMLOListElement>(null);
  const lastPanel = useRef<string | null>(null);

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
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), RESCORE_MS);
    return () => clearInterval(timer);
  }, []);

  // The panel closed: give the focus back to the row's details button (there is no line here).
  useEffect(() => {
    if (panel) {
      lastPanel.current = panel.id;
      return;
    }
    const id = lastPanel.current;
    lastPanel.current = null;
    if (!id) return;
    const button = listRef.current?.querySelector<HTMLButtonElement>(`[data-more-for="${CSS.escape(id)}"]`);
    button?.focus();
  }, [panel]);

  const list = useMemo(
    () => computePriorityList(Object.values(activities), Object.values(activityFlags), flags, now),
    [activities, activityFlags, flags, now],
  );
  const pageIndex = useMemo(() => {
    const out = new Map<string, number>();
    pageLines(activities).forEach((line, i) => out.set(line.id, i));
    return out;
  }, [activities]);
  const linked = useMemo(() => flagIdsByActivity(Object.values(activityFlags)), [activityFlags]);
  const flagById = useMemo(() => new Map(flags.map((f) => [f.id, f])), [flags]);

  function goToLine(id: string) {
    const row = store().activities[id];
    store().setFocus(id, (row?.rawInput ?? "").length);
    navigate("/");
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
        <h1 className="text-xl font-semibold">{t("priority.title")}</h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">{t("priority.intro")}</p>
      </header>

      {status === "ready" && list.length === 0 && <p className="text-neutral-500 dark:text-neutral-400">{t("priority.empty")}</p>}

      <ol ref={listRef} className="space-y-1" data-testid="priority-list">
        {list.map(({ activity, cronActive }, rank) => {
          const index = pageIndex.get(activity.id) ?? rank;
          const labels = (linked.get(activity.id) ?? [])
            .map((id) => flagById.get(id))
            .filter((f) => f !== undefined)
            .map((f) => flagLabel(f, flags, t));
          return (
            <li key={activity.id} className="group flex items-start gap-1" data-testid={`priority-item-${rank}`}>
              <span aria-hidden="true" className="mt-1.5 w-6 shrink-0 text-end text-xs tabular-nums text-neutral-400 dark:text-neutral-500">
                {rank + 1}
              </span>
              <TickCell row={activity} index={index} onTick={() => void store().tick(activity.id)} />
              <div className="min-w-0 flex-1 py-1">
                <button
                  type="button"
                  className="max-w-full rounded text-start outline-none hover:underline focus-visible:ring-2 focus-visible:ring-indigo-500"
                  title={t("priority.goTo")}
                  onClick={() => goToLine(activity.id)}
                >
                  <span className="break-words">{activity.title || activity.rawInput || t("priority.untitled")}</span>
                  <span className="sr-only"> · {t("priority.goTo")}</span>
                </button>
                {(labels.length > 0 || cronActive) && (
                  <div className="mt-0.5 flex flex-wrap gap-1 text-xs">
                    {cronActive && (
                      <span className="rounded bg-amber-100 px-1.5 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                        {t("priority.now")}
                      </span>
                    )}
                    {labels.map((label) => (
                      <span key={label} className="rounded bg-neutral-100 px-1.5 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                        {label}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <button
                type="button"
                data-more-for={activity.id}
                data-testid={`priority-more-${rank}`}
                aria-label={t("line.more", { n: index + 1 })}
                title={t("line.more", { n: index + 1 })}
                onClick={() => store().openPanel(activity.id)}
                className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded text-neutral-400 outline-none hover:bg-neutral-100 hover:text-neutral-700 focus-visible:ring-2 focus-visible:ring-indigo-500 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
              >
                <span aria-hidden="true">⋯</span>
              </button>
            </li>
          );
        })}
      </ol>

      <LinePanel />
      <UndoToast />
    </section>
  );
}
