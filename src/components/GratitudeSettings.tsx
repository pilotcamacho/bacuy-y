import { useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CronExpressionParser } from "cron-parser";
import { useAuth } from "@/hooks/useAuth";
import { checkGratitude } from "@/hooks/useGratitude";
import { DEFAULT_GRATITUDE_CRON, getGratitudeSettings, isValidCron, setGratitudeSettings } from "@/services/gratitude/autoCreate";

const INPUT =
  "w-full rounded border border-neutral-300 bg-white px-2 py-1 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-neutral-700 dark:bg-neutral-900";

/** Settings: the automatic gratitude entry (device-local, `bacuyy_gratitude*`). */
export function GratitudeSettings() {
  const { t, i18n } = useTranslation();
  const auth = useAuth();
  const ownerSub = auth.status === "signedIn" ? auth.user.userId : null;
  const [settings, setSettings] = useState(getGratitudeSettings);
  const [cronText, setCronText] = useState(settings.cron);
  const enabledId = useId();
  const cronId = useId();
  const hintId = useId();

  const valid = isValidCron(cronText);
  const next = useMemo(() => {
    if (!valid) return null;
    try {
      const date = CronExpressionParser.parse(cronText.trim()).next().toDate();
      return new Intl.DateTimeFormat(i18n.resolvedLanguage, { dateStyle: "full", timeStyle: "short" }).format(date);
    } catch {
      return null;
    }
  }, [cronText, valid, i18n.resolvedLanguage]);

  function save(patch: { enabled?: boolean; cron?: string }) {
    setGratitudeSettings(patch);
    setSettings(getGratitudeSettings());
    if (ownerSub) void checkGratitude(ownerSub).catch(() => {});
  }

  return (
    <section className="space-y-2 border-t border-neutral-200 pt-4 dark:border-neutral-800" data-testid="gratitude-settings">
      <h2 className="font-semibold">{t("settings.gratitude")}</h2>
      <p className="text-sm text-neutral-500 dark:text-neutral-400">{t("settings.gratitudeHint")}</p>
      <div className="flex items-center gap-2">
        <input
          id={enabledId}
          type="checkbox"
          className="h-4 w-4 accent-indigo-600"
          checked={settings.enabled}
          onChange={(e) => save({ enabled: e.target.checked })}
        />
        <label htmlFor={enabledId}>{t("settings.gratitudeEnabled")}</label>
      </div>
      {settings.enabled && (
        <div className="max-w-sm">
          <label htmlFor={cronId} className="mb-1 block text-sm">
            {t("settings.gratitudeCron")}
          </label>
          <input
            id={cronId}
            className={INPUT}
            value={cronText}
            spellCheck={false}
            aria-invalid={!valid || undefined}
            aria-describedby={hintId}
            placeholder={DEFAULT_GRATITUDE_CRON}
            onChange={(e) => {
              setCronText(e.target.value);
              // Only a valid schedule is stored; an invalid one keeps the last valid one.
              if (isValidCron(e.target.value)) save({ cron: e.target.value });
            }}
          />
          <p id={hintId} className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
            {!valid ? (
              <span className="text-red-700 dark:text-red-400">{t("panel.cronInvalid")}</span>
            ) : next ? (
              t("settings.gratitudeNext", { date: next })
            ) : (
              t("panel.cronHint")
            )}
          </p>
        </div>
      )}
    </section>
  );
}
