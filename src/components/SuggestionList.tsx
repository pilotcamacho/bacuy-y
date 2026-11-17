import { useTranslation } from "react-i18next";
import type { Suggestion } from "@/hooks/useLineSuggestions";
import { flagLabel } from "@/services/flags/label";
import type { FlagLite } from "@/services/marks";

interface Props {
  id: string;
  items: Suggestion[];
  active: number;
  optionId(index: number): string;
  flags: FlagLite[];
  onPick(index: number): void;
}

/**
 * The suggestions under the line being typed (useLineSuggestions). Picking with the mouse or
 * a tap must not take the focus from the line, so the pointer-down default is prevented.
 */
export function SuggestionList({ id, items, active, optionId, flags, onPick }: Props) {
  const { t, i18n } = useTranslation();
  const dayFormat = new Intl.DateTimeFormat(i18n.resolvedLanguage, { weekday: "short", day: "numeric", month: "short" });

  const detail = (s: Suggestion): string | null => {
    if (s.source === "row") return s.row.completed ? t("suggest.completed") : null;
    const m = s.mark;
    if (m.kind === "flag") {
      const flag = flags.find((f) => f.id === m.flagId);
      return flag ? flagLabel(flag, flags, t) : null;
    }
    if (m.kind === "type") return t(`activityType.${m.type}`);
    if (m.kind === "frequency") return t(`frequency.${m.frequency}`);
    return dayFormat.format(new Date(m.day.year, m.day.month - 1, m.day.day));
  };

  return (
    <ul
      id={id}
      role="listbox"
      aria-label={t("suggest.label")}
      data-testid="suggestions"
      className="absolute start-0 top-full z-30 mt-1 max-h-64 w-full max-w-md overflow-y-auto rounded border border-neutral-200 bg-white py-1 text-sm shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
    >
      {items.map((s, i) => {
        const text = s.source === "mark" ? s.mark.insert : s.row.rawInput;
        const info = detail(s);
        return (
          <li
            key={s.source === "mark" ? s.mark.insert : s.row.id}
            id={optionId(i)}
            role="option"
            aria-selected={i === active}
            data-testid={`suggestion-${i}`}
            onPointerDown={(e) => e.preventDefault()}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(i)}
            className={`flex cursor-pointer items-baseline justify-between gap-3 px-3 py-1.5 ${
              i === active ? "bg-indigo-100 dark:bg-indigo-950" : "hover:bg-neutral-100 dark:hover:bg-neutral-800"
            }`}
          >
            <span className={`min-w-0 truncate ${s.source === "mark" ? "font-medium text-indigo-700 dark:text-indigo-300" : ""}`}>{text}</span>
            {info && <span className="shrink-0 text-xs text-neutral-500 dark:text-neutral-400">{info}</span>}
          </li>
        );
      })}
    </ul>
  );
}
