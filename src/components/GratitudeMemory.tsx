import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { kvGet, kvSet } from "@/lib/kv";
import { memoryCandidates, memoryDate, memorySession, pickMemory } from "@/services/gratitude/memory";
import { usePageStore } from "@/stores/pageStore";

/**
 * "A moment of gratitude": one past gratitude entry, at random, at the top of the page
 * (docs/05-line-mapping.md §6). Quiet, out of the editing flow: a button, not a line.
 *
 * - A new one each time the app is opened (never the one shown last time, kept in
 *   `bacuyy_lastMemory`) and each time the card is tapped or clicked.
 * - The same one while moving between tabs in one visit (module state), and a new one when
 *   the app comes back after a while in the background (a phone "opening" it again).
 */
const LAST_KEY = "lastMemory";
const AWAY_MS = 10 * 60 * 1000;

export function GratitudeMemory() {
  const { t, i18n } = useTranslation();
  const activities = usePageStore((s) => s.activities);
  const candidates = useMemo(() => memoryCandidates(activities), [activities]);
  const ids = useMemo(() => candidates.map((c) => c.id), [candidates]);
  const [current, setCurrent] = useState<string | null>(memorySession.current);

  // First pick of this visit (once the entries are loaded), or a new one if the shown entry
  // was deleted or its notes emptied: adjusted while rendering, as React recommends.
  if (ids.length > 0 && !(current && ids.includes(current))) {
    setCurrent(pickMemory(ids, current ?? kvGet(LAST_KEY)));
  }

  // Remember it for this visit (tabs) and for the next open (never the same one twice).
  useEffect(() => {
    memorySession.current = current;
    if (current) kvSet(LAST_KEY, current);
  }, [current]);

  // Back after a while in the background: like opening the app again.
  useEffect(() => {
    let hiddenAt = 0;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") hiddenAt = Date.now();
      else if (hiddenAt && Date.now() - hiddenAt >= AWAY_MS) setCurrent((shown) => pickMemory(ids, shown));
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [ids]);

  const entry = candidates.find((c) => c.id === current);
  if (!entry) return null;

  const when = memoryDate(entry);
  const date = new Intl.DateTimeFormat(i18n.resolvedLanguage, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(when);
  const single = ids.length < 2;

  return (
    <div className="mb-3" data-testid="gratitude-memory" data-id={entry.id}>
      <button
        type="button"
        disabled={single}
        onClick={() => setCurrent(pickMemory(ids, entry.id))}
        title={single ? undefined : t("memory.another")}
        className="group relative w-full overflow-hidden rounded-xl border border-amber-200/70 bg-gradient-to-br from-amber-50 via-orange-50/60 to-rose-50/70 px-4 py-3 text-start shadow-sm outline-none transition hover:shadow focus-visible:ring-2 focus-visible:ring-amber-500 disabled:cursor-default dark:border-amber-900/40 dark:from-amber-950/40 dark:via-stone-900/40 dark:to-rose-950/30"
      >
        <span className="relative flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-amber-800/80 dark:text-amber-300/70">
          <span aria-hidden="true">✦</span>
          {t("memory.label")}
          {!single && (
            <span
              aria-hidden="true"
              className="ms-auto text-sm normal-case tracking-normal text-amber-700/50 transition group-hover:rotate-180 group-hover:text-amber-700 motion-reduce:transition-none dark:text-amber-400/40 dark:group-hover:text-amber-300"
            >
              ↻
            </span>
          )}
        </span>
        <span key={entry.id} className="relative mt-1.5 block motion-safe:animate-memory-in">
          <q
            className="line-clamp-4 block whitespace-pre-line font-serif text-[15px] italic leading-relaxed text-stone-800 before:content-none after:content-none dark:text-stone-200"
            data-testid="gratitude-memory-text"
          >
            {entry.description?.trim()}
          </q>
          <span className="mt-1.5 block text-end text-xs text-stone-500 dark:text-stone-400">
            <time dateTime={when.toISOString()}>— {date}</time>
          </span>
        </span>
        {!single && <span className="sr-only">{t("memory.another")}</span>}
      </button>
    </div>
  );
}
