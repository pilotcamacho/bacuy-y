import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { ActivityRow } from "@/lib/db/types";
import { daysUntil, tickIsClickable } from "@/services/lifecycle/tick";

/**
 * The column at the start of a line (docs/05-line-mapping.md §4): a checkbox, a counter, a
 * streak or a badge depending on the type. `data-testid="line-done-<index>"` on all of them.
 */
interface Props {
  row: ActivityRow | undefined;
  index: number;
  onTick(): void;
}

const BOX =
  "mt-1 flex h-7 min-w-7 shrink-0 select-none items-center justify-center rounded px-1 text-xs tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";
const CLICKABLE = "cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-800";
const BADGE = "text-neutral-500 dark:text-neutral-400";

function Checkbox({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`flex h-4 w-4 items-center justify-center rounded border ${
        checked
          ? "border-indigo-500 bg-indigo-500 text-white dark:border-indigo-400 dark:bg-indigo-400 dark:text-neutral-900"
          : "border-neutral-400 dark:border-neutral-500"
      }`}
    >
      {checked && (
        <svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M2.5 6.5l2.5 2.5 4.5-5" />
        </svg>
      )}
    </span>
  );
}

export function TickCell({ row, index, onTick }: Props) {
  const { t } = useTranslation();
  const testId = `line-done-${index}`;
  const n = index + 1;

  if (!row) return <span aria-hidden="true" className={`${BOX} invisible`} />;

  const status = row.status ?? "DRAFT";
  const completed = status === "COMPLETED";

  if (status === "INACTIVE") {
    return (
      <span data-testid={testId} title={t("line.paused")} className={`${BOX} ${BADGE}`}>
        <span aria-hidden="true">‖</span>
        <span className="sr-only">{t("line.paused")}</span>
      </span>
    );
  }

  // Not clickable: a badge with a text alternative (Ctrl+Enter still runs the tick).
  const badge = (content: string, label: string, extra = "") => (
    <span data-testid={testId} title={label} className={`${BOX} ${BADGE} ${extra}`}>
      <span aria-hidden="true">{content}</span>
      <span className="sr-only">{label}</span>
    </span>
  );

  const button = (content: ReactNode, label: string, pressed?: boolean, extra = "") => (
    <button
      type="button"
      data-testid={testId}
      onClick={onTick}
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      disabled={!tickIsClickable(row)}
      className={`${BOX} ${CLICKABLE} disabled:cursor-default disabled:hover:bg-transparent ${extra}`}
    >
      {content}
    </button>
  );

  switch (row.activityType) {
    case "ACTION":
      return button(<Checkbox checked={completed} />, t(completed ? "line.tick.uncomplete" : "line.tick.complete", { n }), completed);

    case "GRATITUDE":
      return button(<Checkbox checked={completed} />, completed ? t("status.COMPLETED") : t("line.tick.gratitude", { n }), completed);

    case "REPETITIVE_ACTION": {
      const count = row.completionCount ?? 0;
      const text = row.targetCount ? `↻ ${count}/${row.targetCount}` : `↻ ${count}`;
      const label = completed
        ? t("line.countOf", { count, target: row.targetCount ?? count })
        : t("line.tick.repeat", { n, count });
      return button(<span aria-hidden="true">{text}</span>, label, undefined, BADGE);
    }

    case "HABIT": {
      const count = row.streak ?? 0;
      const label = completed ? t("line.streak", { count }) : t("line.tick.habit", { n, count });
      return button(<span aria-hidden="true">🔥{count}</span>, label, undefined, BADGE);
    }

    case "EXPIRATION": {
      if (!row.expirationDate) return button(<span aria-hidden="true">⏳</span>, t("line.tick.expiration", { n }), undefined, BADGE);
      const days = daysUntil(row.expirationDate);
      const label = days > 0 ? t("line.daysLeft", { count: days }) : days === 0 ? t("line.dueToday") : t("line.overdue", { count: -days });
      const urgent = days <= (row.renewalLeadDays ?? 30);
      const color = days < 0 ? "text-red-600 dark:text-red-400" : urgent ? "text-amber-700 dark:text-amber-400" : BADGE;
      return button(<span aria-hidden="true">{days}d</span>, `${label} · ${t("line.tick.expiration", { n })}`, undefined, color);
    }

    case "SKILL": {
      const level = row.proficiencyLevel;
      const label = level ? t(`proficiencyLevel.${level}`) : t("activityType.SKILL");
      return badge(level ? label.slice(0, 3) : "◆", label);
    }
    case "ATTITUDE":
      return badge("◇", t("line.attitude"));
    case "MOMENTO":
      return badge("★", t("line.moment"));
  }
}
