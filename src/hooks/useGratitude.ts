import { useEffect } from "react";
import { getDb } from "@/lib/db/instance";
import { emit, subscribe } from "@/lib/events";
import i18n from "@/lib/i18n";
import { autoCreateGratitude, getGratitudeSettings } from "@/services/gratitude/autoCreate";
import { usePageStore } from "@/stores/pageStore";

/** While the app is open, look for a new schedule window this often (a visible tab only). */
export const GRATITUDE_CHECK_MS = 60_000;

let chain: Promise<unknown> = Promise.resolve();

/** A page load in progress may have read the database before the new row: wait for it. */
function pageSettled(): Promise<void> {
  if (usePageStore.getState().status !== "loading") return Promise.resolve();
  return new Promise((resolve) => {
    const stop = usePageStore.subscribe((s) => {
      if (s.status !== "loading") {
        stop();
        resolve();
      }
    });
  });
}

/**
 * Creates the current window's gratitude entry if it is due (see services/gratitude), then
 * shows it on the page. Checks run one at a time in this tab; other tabs converge on the same
 * deterministic id.
 */
export function checkGratitude(ownerSub: string): Promise<string | null> {
  const run = async () => {
    const language = i18n.resolvedLanguage ?? "es";
    const id = await autoCreateGratitude(await getDb(), getGratitudeSettings(), {
      ownerSub,
      now: new Date(),
      locale: language.startsWith("en") ? "en" : "es",
      title: (d) =>
        i18n.t("journal.entryTitle", { date: new Intl.DateTimeFormat(language, { day: "numeric", month: "short" }).format(d) }),
    });
    if (id) {
      emit({ type: "localWrite" }); // pushed soon; other tabs reload
      await pageSettled();
      await usePageStore.getState().refresh();
    }
    return id;
  };
  const result = chain.then(run, run);
  chain = result.catch((e) => console.error("[bacuyy] gratitude check failed", e));
  return result;
}

/**
 * On start, when the tab becomes visible, every minute while it is visible, and after each
 * sync (a new device creates nothing until its first pull).
 */
export function useGratitudeAutoCreate(ownerSub: string | null, ready: boolean) {
  useEffect(() => {
    if (!ownerSub || !ready) return;
    const check = () => {
      if (document.visibilityState === "visible") void checkGratitude(ownerSub).catch(() => {});
    };
    check();
    document.addEventListener("visibilitychange", check);
    const timer = setInterval(check, GRATITUDE_CHECK_MS);
    const unsubscribe = subscribe((event, fromOtherTab) => {
      if (event.type === "synced" && !fromOtherTab) check();
    });
    return () => {
      unsubscribe();
      document.removeEventListener("visibilitychange", check);
      clearInterval(timer);
    };
  }, [ownerSub, ready]);
}
