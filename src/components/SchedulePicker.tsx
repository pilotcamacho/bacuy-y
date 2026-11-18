import { useId } from "react";
import { useTranslation } from "react-i18next";
import {
  fromCron,
  MAX_MONTH_DAY,
  toCron,
  WEEK_ORDER,
  type MonthDay,
  type PickedSchedule,
  type ScheduleKind,
} from "@/services/lifecycle/schedule";

const INPUT =
  "rounded border border-neutral-300 bg-white px-2 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-neutral-700 dark:bg-neutral-900";

interface Props {
  kind: ScheduleKind;
  cron: string | null;
  /** When it comes back next, already formatted (null when nothing is picked). */
  next: string | null;
  onChange(cron: string | null): void;
}

/**
 * Pick the weekdays (weekly), the day of the month (monthly) and an optional time for a
 * repeating line; it writes the line's `cron` (services/lifecycle/schedule.ts). With nothing
 * picked the frequency alone decides (7 days / a month / a day after it is ticked).
 */
export function SchedulePicker({ kind, cron, next, onChange }: Props) {
  const { t, i18n } = useTranslation();
  const timeId = useId();
  const dayId = useId();
  const parsed = fromCron(cron);
  const matches = parsed?.kind === kind;
  const custom = !!cron && !matches;
  const state: PickedSchedule = matches ? parsed : { kind, time: null };

  const set = (patch: Partial<PickedSchedule>) => onChange(toCron({ ...state, ...patch, kind }));
  // 1 Feb 2027 is a Monday, so 1 Feb + (d − 1) is weekday d (Sunday, 0, is 7 Feb).
  const weekday = (d: number, style: "short" | "long") =>
    new Intl.DateTimeFormat(i18n.resolvedLanguage, { weekday: style }).format(new Date(2027, 1, d === 0 ? 7 : d));

  const days = state.days ?? [];
  const nothingPicked = !matches || (kind === "daily" ? !state.time : kind === "weekly" ? days.length === 0 : state.monthDay === undefined);

  return (
    <div className="space-y-2" data-testid="schedule-picker">
      {custom && <p className="text-xs text-amber-800 dark:text-amber-300">{t("panel.picker.custom")}</p>}

      {kind === "weekly" && (
        <fieldset>
          <legend className="mb-1 text-sm font-medium">{t("panel.picker.days")}</legend>
          <div className="flex flex-wrap gap-1.5">
            {WEEK_ORDER.map((d) => {
              const on = days.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  aria-label={weekday(d, "long")}
                  data-testid={`schedule-day-${d}`}
                  onClick={() => set({ days: on ? days.filter((x) => x !== d) : [...days, d] })}
                  className={`h-9 min-w-[2.75rem] rounded border px-2 text-sm capitalize outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                    on
                      ? "border-indigo-600 bg-indigo-600 text-white dark:border-indigo-400 dark:bg-indigo-500"
                      : "border-neutral-300 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
                  }`}
                >
                  {weekday(d, "short")}
                </button>
              );
            })}
          </div>
        </fieldset>
      )}

      {kind === "monthly" && (
        <div>
          <label htmlFor={dayId} className="mb-1 block text-sm font-medium">
            {t("panel.picker.monthDay")}
          </label>
          <select
            id={dayId}
            className={INPUT}
            data-testid="schedule-monthday"
            value={state.monthDay === undefined ? "" : String(state.monthDay)}
            onChange={(e) => {
              const v = e.target.value;
              set({ monthDay: v === "" ? undefined : v === "last" ? "last" : (Number(v) as MonthDay) });
            }}
          >
            <option value="">{t("panel.picker.noMonthDay")}</option>
            {Array.from({ length: MAX_MONTH_DAY }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
            <option value="last">{t("panel.picker.lastDay")}</option>
          </select>
        </div>
      )}

      <div>
        <label htmlFor={timeId} className="mb-1 block text-sm font-medium">
          {t("panel.picker.time")}
        </label>
        <input
          id={timeId}
          type="time"
          className={INPUT}
          data-testid="schedule-time"
          value={state.time ?? ""}
          // A time alone pins nothing for weekly / monthly; it is kept once a day is picked.
          disabled={kind !== "daily" && (kind === "weekly" ? days.length === 0 : state.monthDay === undefined)}
          onChange={(e) => set({ time: e.target.value || null })}
        />
      </div>

      {nothingPicked ? (
        <p className="text-xs text-neutral-500 dark:text-neutral-400">{t(`panel.picker.none_${kind}`)}</p>
      ) : (
        next && (
          <p className="text-xs text-neutral-600 dark:text-neutral-300" data-testid="schedule-next">
            {t("panel.cronNext", { date: next })}
          </p>
        )
      )}
    </div>
  );
}
