import { useState } from "react";
import { useTranslation } from "react-i18next";
import { usePwaStore } from "@/lib/pwa";
import { usePageStore } from "@/stores/pageStore";

/**
 * "A new version is available" (CLAUDE.md, PWA). Updating saves the text still waiting for its
 * debounce first, then activates the new service worker, which reloads the page.
 */
export function UpdatePrompt() {
  const { t } = useTranslation();
  const needRefresh = usePwaStore((s) => s.needRefresh);
  const [busy, setBusy] = useState(false);
  if (!needRefresh) return null;

  async function update() {
    setBusy(true);
    try {
      await usePageStore.getState().flushAll();
    } finally {
      await usePwaStore.getState().update();
    }
  }

  return (
    <div
      role="status"
      data-testid="update-prompt"
      className="fixed inset-x-0 top-3 z-50 mx-auto flex w-fit max-w-[calc(100%-2rem)] flex-wrap items-center gap-3 rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white shadow-lg dark:bg-indigo-500"
    >
      <span>{t("pwa.newVersion")}</span>
      <button
        type="button"
        disabled={busy}
        onClick={() => void update()}
        className="rounded bg-white px-2 py-0.5 font-semibold text-indigo-700 outline-none hover:bg-indigo-50 focus-visible:ring-2 focus-visible:ring-white disabled:opacity-60"
      >
        {t("pwa.update")}
      </button>
      <button
        type="button"
        onClick={() => usePwaStore.setState({ needRefresh: false })}
        className="rounded px-1 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-white"
      >
        {t("pwa.later")}
      </button>
    </div>
  );
}
