import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { AccountSection } from "@/components/AccountSection";
import { GratitudeSettings } from "@/components/GratitudeSettings";
import { InstallSection } from "@/components/InstallSection";
import { THEME_MODES, useTheme, type ThemeMode } from "@/hooks/useTheme";
import { SUPPORTED_LOCALES, getLocaleOverride, isLocale, setLocaleOverride } from "@/lib/i18n";

const SYSTEM = "system";

const selectClass =
  "rounded border border-neutral-300 bg-white px-2 py-1 dark:border-neutral-700 dark:bg-neutral-900";

export function Settings() {
  const { t } = useTranslation();
  const [override, setOverride] = useState(getLocaleOverride);
  const { mode, setMode } = useTheme();
  const languageId = useId();
  const themeId = useId();

  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold">{t("settings.title")}</h1>

      <div className="flex items-center gap-3">
        <label htmlFor={languageId} className="w-24">
          {t("settings.language")}
        </label>
        <select
          id={languageId}
          className={selectClass}
          value={override ?? SYSTEM}
          onChange={(e) => {
            const next = isLocale(e.target.value) ? e.target.value : null;
            setOverride(next);
            setLocaleOverride(next);
          }}
        >
          <option value={SYSTEM}>{t("settings.languageSystem")}</option>
          {SUPPORTED_LOCALES.map((l) => (
            <option key={l} value={l}>
              {t(`locale.${l}`)}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-3">
        <label htmlFor={themeId} className="w-24">
          {t("settings.theme")}
        </label>
        <select
          id={themeId}
          className={selectClass}
          value={mode}
          onChange={(e) => setMode(e.target.value as ThemeMode)}
        >
          {THEME_MODES.map((m) => (
            <option key={m} value={m}>
              {t(`theme.${m}`)}
            </option>
          ))}
        </select>
      </div>

      <GratitudeSettings />

      <InstallSection />

      <AccountSection />
    </section>
  );
}
