import { useTranslation } from "react-i18next";

/** Temporary screen body until the phase that builds the screen. */
export function Placeholder({ titleKey }: { titleKey: string }) {
  const { t } = useTranslation();
  return (
    <section>
      <h1 className="mb-2 text-xl font-semibold">{t(titleKey)}</h1>
      <p className="text-neutral-500 dark:text-neutral-400">{t("app.comingSoon")}</p>
    </section>
  );
}
