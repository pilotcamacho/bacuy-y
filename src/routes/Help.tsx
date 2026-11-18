import { useEffect, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";
import { FREQUENCY_KEYWORDS, TYPE_KEYWORDS, type ActivityType, type MarkLocale } from "@/services/marks";

/**
 * The in-app manual (docs/05-line-mapping.md is the source of truth it summarizes). Bundled
 * with the app, so it works offline; every string comes from the `help.*` locale keys.
 * `/help#type-HABIT` jumps to one type (the panel links there).
 */

type DateField = "deadline" | "eventDate" | "expirationDate";

/** What each type does with `@date` and `~frequency`, and its own panel fields (`panel.*`). */
const TYPES: { type: ActivityType; symbol: string; date: DateField | null; frequency: boolean; fields: string[] }[] = [
  { type: "ACTION", symbol: "☐", date: "deadline", frequency: false, fields: [] },
  { type: "REPETITIVE_ACTION", symbol: "↻", date: "deadline", frequency: true, fields: ["targetCount", "completionCount", "cron"] },
  { type: "HABIT", symbol: "🔥", date: null, frequency: true, fields: ["streak", "targetStreak", "cron"] },
  { type: "ATTITUDE", symbol: "◇", date: null, frequency: false, fields: ["affirmation"] },
  { type: "SKILL", symbol: "▲", date: null, frequency: false, fields: ["proficiencyLevel", "learningResources"] },
  { type: "MOMENTO", symbol: "★", date: "eventDate", frequency: false, fields: [] },
  { type: "GRATITUDE", symbol: "♡", date: null, frequency: false, fields: ["recipient", "gratitudeNotes"] },
  {
    type: "EXPIRATION",
    symbol: "⏳",
    date: "expirationDate",
    frequency: false,
    fields: ["renewalLeadDays", "documentRef", "renewalUrl"],
  },
];

const STATUSES = ["DRAFT", "ACTIVE", "INACTIVE", "COMPLETED", "ARCHIVED"] as const;
const VIEWS = ["page", "hidden", "completed", "archived", "priority", "journal", "flags", "settings"] as const;
const KEYS: { keys: string[]; text: string }[] = [
  { keys: ["Enter"], text: "enter" },
  { keys: ["⌫"], text: "backspace" },
  { keys: ["↑", "↓"], text: "arrows" },
  { keys: ["Alt+↑", "Alt+↓"], text: "altArrows" },
  { keys: ["Ctrl+Enter"], text: "ctrlEnter" },
  { keys: ["Ctrl+."], text: "ctrlDot" },
  { keys: ["Tab"], text: "tab" },
  { keys: ["Esc"], text: "escape" },
];
const SECTIONS = ["start", "marks", "types", "lifecycle", "status", "views", "keys"] as const;
/** The life cycle of each type, in the order a line lives it. */
const LIFE_STEPS = ["start", "use", "repeat", "end"] as const;

const CODE = "rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[0.85em] dark:bg-neutral-800";
const MARK = "rounded-sm bg-indigo-100 px-1 font-mono text-[0.85em] text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300";

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-4 border-t border-neutral-200 pt-5 dark:border-neutral-800">
      <h2 id={`${id}-title`} className="mb-3 text-lg font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function Help() {
  const { t, i18n } = useTranslation();
  const { hash } = useLocation();
  const locale: MarkLocale = i18n.resolvedLanguage?.startsWith("en") ? "en" : "es";

  // Router navigation does not scroll to a #fragment by itself.
  useEffect(() => {
    if (!hash) return;
    const target = document.getElementById(decodeURIComponent(hash.slice(1)));
    target?.scrollIntoView({ block: "start" });
    if (target instanceof HTMLElement) target.focus({ preventScroll: true });
  }, [hash]);

  const marks = [
    { sigil: "#", key: "flag" },
    { sigil: "!", key: "type" },
    { sigil: "@", key: "date" },
    { sigil: "~", key: "frequency" },
  ];
  const frequencyWords = Object.values(FREQUENCY_KEYWORDS)
    .map((w) => `~${w[locale][0]}`)
    .join(" · ");

  return (
    <article className="space-y-6 pb-10 leading-relaxed" data-testid="help">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">{t("help.title")}</h1>
        <p className="text-neutral-700 dark:text-neutral-300">{t("help.intro")}</p>
      </header>

      <nav aria-label={t("help.contents")} className="rounded border border-neutral-200 p-3 text-sm dark:border-neutral-800">
        <p className="mb-1 font-medium">{t("help.contents")}</p>
        <ol className="list-inside list-decimal space-y-0.5">
          {SECTIONS.map((s) => (
            <li key={s}>
              <a href={`#${s}`} className="text-indigo-700 underline-offset-2 hover:underline dark:text-indigo-300">
                {t(`help.toc.${s}`)}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <Section id="start" title={t("help.toc.start")}>
        <div className="space-y-2">
          <p>{t("help.start.p1")}</p>
          <p>{t("help.start.p2")}</p>
          <p>{t("help.start.p3")}</p>
        </div>
      </Section>

      <Section id="marks" title={t("help.toc.marks")}>
        <p className="mb-3">{t("help.marks.intro")}</p>
        <dl className="space-y-3">
          {marks.map((m) => (
            <div key={m.key} className="grid gap-1 sm:grid-cols-[4rem_1fr] sm:gap-3">
              <dt>
                <span className={MARK}>{m.sigil}</span>
              </dt>
              <dd className="space-y-1">
                <p>{t(`help.marks.${m.key}`)}</p>
                <p className="text-sm text-neutral-600 dark:text-neutral-400">
                  {t("help.marks.example")}: <code className={CODE}>{t(`help.marks.${m.key}Example`)}</code>
                </p>
              </dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section id="types" title={t("help.toc.types")}>
        <p className="mb-4">{t("help.types.intro")}</p>
        <div className="space-y-4">
          {TYPES.map(({ type, symbol, date, frequency, fields }) => (
            <section
              key={type}
              id={`type-${type}`}
              tabIndex={-1}
              aria-labelledby={`type-${type}-title`}
              className="scroll-mt-4 rounded border border-neutral-200 p-4 outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-neutral-800"
              data-testid={`help-type-${type}`}
            >
              <h3 id={`type-${type}-title`} className="mb-1 flex items-baseline gap-2 font-semibold">
                <span aria-hidden="true" className="w-6 text-center">
                  {symbol}
                </span>
                {t(`activityType.${type}`)}
                <span className={`${MARK} font-normal`}>!{TYPE_KEYWORDS[type][locale][0]}</span>
              </h3>
              <p className="mb-3">{t(`help.types.${type}.what`)}</p>
              <dl className="grid gap-x-3 gap-y-1.5 text-sm sm:grid-cols-[8rem_1fr]">
                <dt className="font-medium text-neutral-600 dark:text-neutral-400">{t("help.types.exampleLabel")}</dt>
                <dd>
                  <code className={CODE}>{t(`help.types.${type}.example`)}</code>
                </dd>
                <dt className="font-medium text-neutral-600 dark:text-neutral-400">{t("help.types.dateLabel")}</dt>
                <dd>{date ? t(`panel.${date}`) : t("help.types.noDate")}</dd>
                <dt className="font-medium text-neutral-600 dark:text-neutral-400">{t("help.types.frequencyLabel")}</dt>
                <dd>
                  {frequency ? (
                    <>
                      {t("help.types.frequencyYes")} <span className="text-neutral-500 dark:text-neutral-400">{frequencyWords}</span>
                    </>
                  ) : (
                    t("help.types.frequencyNo")
                  )}
                </dd>
                <dt className="font-medium text-neutral-600 dark:text-neutral-400">{t("help.types.fieldsLabel")}</dt>
                <dd>{fields.length > 0 ? fields.map((f) => t(`panel.${f}`)).join(" · ") : t("help.types.noFields")}</dd>
              </dl>
              <h4 className="mb-1 mt-3 text-sm font-semibold">{t("help.types.lifeLabel")}</h4>
              <ol className="space-y-1 text-sm" data-testid={`help-life-${type}`}>
                {LIFE_STEPS.map((step, i) => (
                  <li key={step} className="grid grid-cols-[1.25rem_6rem_1fr] gap-x-2">
                    <span aria-hidden="true" className="text-neutral-400">
                      {i + 1}.
                    </span>
                    <span className="font-medium text-neutral-600 dark:text-neutral-400">{t(`help.types.${step}Label`)}</span>
                    <span>{t(`help.types.${type}.${step}`)}</span>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      </Section>

      <Section id="lifecycle" title={t("help.lifecycle.title")}>
        <ul className="list-disc space-y-1.5 ps-5" data-testid="help-lifecycle">
          {(t("help.lifecycle.items", { returnObjects: true }) as string[]).map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </Section>

      <Section id="status" title={t("help.toc.status")}>
        <dl className="grid gap-x-3 gap-y-2 sm:grid-cols-[8rem_1fr]">
          {STATUSES.map((s) => (
            <div key={s} className="contents">
              <dt className="font-medium">{t(`status.${s}`)}</dt>
              <dd className="mb-1 sm:mb-0">{t(`help.statusItems.${s}`)}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section id="views" title={t("help.toc.views")}>
        <ul className="list-disc space-y-1.5 ps-5">
          {VIEWS.map((v) => (
            <li key={v}>{t(`help.views.${v}`)}</li>
          ))}
        </ul>
      </Section>

      <Section id="keys" title={t("help.toc.keys")}>
        <dl className="grid gap-x-3 gap-y-1.5 text-sm sm:grid-cols-[10rem_1fr]">
          {KEYS.map(({ keys, text }) => (
            <div key={text} className="contents">
              <dt className="flex flex-wrap gap-1">
                {keys.map((k) => (
                  <kbd key={k} className="rounded border border-neutral-300 px-1.5 font-mono text-xs dark:border-neutral-700">
                    {k}
                  </kbd>
                ))}
              </dt>
              <dd className="mb-1 sm:mb-0">{t(`help.keys.${text}`)}</dd>
            </div>
          ))}
        </dl>
      </Section>
    </article>
  );
}
