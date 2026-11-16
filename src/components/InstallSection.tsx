import { useState } from "react";
import { useTranslation } from "react-i18next";
import { usePwaStore } from "@/lib/pwa";

const BUTTON =
  "rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white outline-none hover:bg-indigo-700 focus-visible:ring-2 focus-visible:ring-indigo-400 dark:bg-indigo-500 dark:hover:bg-indigo-400";

/** Settings: install the app. The browser's own prompt when it offers one; otherwise how-to. */
export function InstallSection() {
  const { t } = useTranslation();
  const installed = usePwaStore((s) => s.installed);
  const prompt = usePwaStore((s) => s.installPrompt);
  const [dismissed, setDismissed] = useState(false);

  async function install() {
    if (!prompt) return;
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    // A prompt can be used once; the browser fires a new event if it may ask again.
    usePwaStore.setState({ installPrompt: null });
    if (outcome === "dismissed") setDismissed(true);
  }

  return (
    <section className="space-y-2 border-t border-neutral-200 pt-4 dark:border-neutral-800" data-testid="install-section">
      <h2 className="font-semibold">{t("pwa.installTitle")}</h2>
      {installed ? (
        <p className="text-sm text-neutral-600 dark:text-neutral-400">{t("pwa.installed")}</p>
      ) : prompt ? (
        <>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">{t("pwa.installHint")}</p>
          <button type="button" className={BUTTON} onClick={() => void install()}>
            {t("pwa.install")}
          </button>
        </>
      ) : (
        <>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">{t(dismissed ? "pwa.installLater" : "pwa.installHint")}</p>
          <ul className="list-disc space-y-1 ps-5 text-sm text-neutral-600 dark:text-neutral-400">
            <li>{t("pwa.howDesktop")}</li>
            <li>{t("pwa.howAndroid")}</li>
            <li>{t("pwa.howIos")}</li>
          </ul>
        </>
      )}
    </section>
  );
}
