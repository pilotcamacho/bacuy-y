import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { HIDE_PRESETS, hidePresetAt } from "@/services/lifecycle/nextShow";

const BUTTON =
  "rounded border border-neutral-300 px-2.5 py-1 text-sm outline-none hover:bg-neutral-100 focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800";
const INPUT =
  "rounded border border-neutral-300 bg-white px-2 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-neutral-700 dark:bg-neutral-900";

/** `YYYY-MM-DDTHH:mm` (local) for a datetime-local input. */
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * "Hide until…" (docs/05-line-mapping.md §5): quick choices, a date and time, or until shown
 * again (`until` = null). Used by the side panel and the Hidden page.
 */
export function HideChooser({ onHide, testPrefix = "hide" }: { onHide(until: string | null): void; testPrefix?: string }) {
  const { t, i18n } = useTranslation();
  const inputId = useId();
  // The choices' times are fixed when the chooser opens.
  const [now] = useState(() => new Date());
  const [custom, setCustom] = useState(() => toLocalInput(hidePresetAt("tomorrow", now)));
  const when = new Intl.DateTimeFormat(i18n.resolvedLanguage, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const customDate = custom ? new Date(custom) : null;
  const customOk = !!customDate && !Number.isNaN(customDate.getTime()) && customDate.getTime() > now.getTime();

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {HIDE_PRESETS.map((preset) => {
          const at = hidePresetAt(preset, now);
          return (
            <button
              key={preset}
              type="button"
              className={BUTTON}
              data-testid={`${testPrefix}-preset-${preset}`}
              title={when.format(at)}
              onClick={() => onHide(at.toISOString())}
            >
              {t(`hide.presets.${preset}`)}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label htmlFor={inputId} className="flex flex-col text-xs text-neutral-500 dark:text-neutral-400">
          {t("hide.custom")}
          <input
            id={inputId}
            type="datetime-local"
            className={INPUT}
            value={custom}
            min={toLocalInput(now)}
            data-testid={`${testPrefix}-custom`}
            onChange={(e) => setCustom(e.target.value)}
          />
        </label>
        <button
          type="button"
          className={BUTTON}
          disabled={!customOk}
          data-testid={`${testPrefix}-custom-apply`}
          onClick={() => customDate && onHide(customDate.toISOString())}
        >
          {t("hide.apply")}
        </button>
      </div>
      <button type="button" className={BUTTON} data-testid={`${testPrefix}-indefinite`} onClick={() => onHide(null)}>
        {t("hide.indefinite")}
      </button>
    </div>
  );
}
