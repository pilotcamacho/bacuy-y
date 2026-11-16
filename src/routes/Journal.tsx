import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { LinePanel } from "@/components/LinePanel";
import { useAuth } from "@/hooks/useAuth";
import { subscribe } from "@/lib/events";
import { journalEntries } from "@/services/gratitude/journal";
import { usePageStore } from "@/stores/pageStore";

export function Journal() {
  const { t, i18n } = useTranslation();
  const status = usePageStore((s) => s.status);
  const activities = usePageStore((s) => s.activities);
  const store = usePageStore.getState;
  const auth = useAuth();
  const ownerSub = auth.status === "signedIn" ? auth.user.userId : null;

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

  const entries = useMemo(() => journalEntries(activities), [activities]);
  const pending = useMemo(
    () => Object.values(activities).filter((a) => !a.deletedAt && a.activityType === "GRATITUDE" && a.status !== "COMPLETED" && a.status !== "ARCHIVED").length,
    [activities],
  );
  const dateFormat = new Intl.DateTimeFormat(i18n.resolvedLanguage, { dateStyle: "full" });

  return (
    <section className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold">{t("journal.title")}</h1>
        {pending > 0 && <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">{t("journal.pending", { count: pending })}</p>}
      </header>

      {status === "ready" && entries.length === 0 && (
        <p className="text-neutral-500 dark:text-neutral-400">{t("journal.empty")}</p>
      )}

      <ol className="space-y-3" data-testid="journal">
        {entries.map((entry) => (
          <li key={entry.id} className="rounded border border-neutral-200 p-3 dark:border-neutral-800" data-testid="journal-entry">
            <div className="flex items-baseline gap-2">
              <h2 className="min-w-0 flex-1 font-medium">{entry.title}</h2>
              <button
                type="button"
                className="rounded px-1.5 text-sm text-indigo-700 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-300"
                onClick={() => store().openPanel(entry.id, "description")}
              >
                {t("journal.edit")}
              </button>
            </div>
            <time className="text-xs text-neutral-500 dark:text-neutral-400" dateTime={entry.editedAt}>
              {dateFormat.format(new Date(entry.editedAt))}
            </time>
            {entry.description && <p className="mt-2 whitespace-pre-wrap">{entry.description}</p>}
          </li>
        ))}
      </ol>

      <LinePanel />
    </section>
  );
}
