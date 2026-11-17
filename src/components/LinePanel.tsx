import { useEffect, useId, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { CronExpressionParser } from "cron-parser";
import type { ActivityRow } from "@/lib/db/types";
import {
  TYPE_KEYWORDS,
  addFlagMark,
  canonicalDateBody,
  dayToIso,
  isoToDay,
  parseLine,
  removeFlagMark,
  setDateMark,
  setFrequencyMark,
  setTypeMark,
  type ActivityType,
  type Frequency,
  type MarkLocale,
  type ParseContext,
} from "@/services/marks";
import { FeedbackSection } from "@/components/FeedbackForm";
import { flagLabel } from "@/services/flags/label";
import { canComplete, statusActions } from "@/services/lifecycle/status";
import { isHiddenNow } from "@/services/lifecycle/nextShow";
import { HideChooser } from "./HideChooser";
import { useFlagStore } from "@/stores/flagStore";
import { usePageStore } from "@/stores/pageStore";

/**
 * The side panel of one line (docs/05-line-mapping.md §5): a drawer on wide screens, a bottom
 * sheet on phones. Fields that have a mark are edited by rewriting the mark in the text; the
 * rest are written directly. Every change is written at once (no debounce).
 */

const TYPES = Object.keys(TYPE_KEYWORDS) as ActivityType[];
const FREQUENCIES: Frequency[] = ["DAILY", "WEEKLY", "MONTHLY", "CUSTOM"];
const LEVELS = ["BEGINNER", "INTERMEDIATE", "ADVANCED", "EXPERT"] as const;

const INPUT =
  "w-full rounded border border-neutral-300 bg-white px-2 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-neutral-700 dark:bg-neutral-900";
const BUTTON =
  "rounded border border-neutral-300 px-2.5 py-1 text-sm outline-none hover:bg-neutral-100 focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50 disabled:hover:bg-transparent dark:border-neutral-700 dark:hover:bg-neutral-800";
const PRIMARY =
  "rounded bg-indigo-600 px-2.5 py-1 text-sm font-medium text-white outline-none hover:bg-indigo-700 focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:opacity-50 dark:bg-indigo-500 dark:hover:bg-indigo-400";

function markLocale(language: string | undefined): MarkLocale {
  return language?.startsWith("en") ? "en" : "es";
}

function toDateInput(iso: string | null | undefined): string {
  return iso ? canonicalDateBody(isoToDay(iso)) : "";
}

function fromDateInput(value: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return m ? dayToIso({ year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) }) : null;
}

function toInt(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function Section({ title, children, id }: { title: string; children: ReactNode; id?: string }) {
  return (
    <section className="border-t border-neutral-200 py-3 dark:border-neutral-800" aria-labelledby={id}>
      <h3 id={id} className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
        {title}
      </h3>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm text-neutral-700 dark:text-neutral-300">
        {label}
      </label>
      {children(id)}
    </div>
  );
}

export function LinePanel() {
  const panel = usePageStore((s) => s.panel);
  const row = usePageStore((s) => (s.panel ? s.activities[s.panel.id] : undefined));
  if (!panel || !row || row.deletedAt) return null;
  return <PanelBody key={panel.id} row={row} section={panel.section} nonce={panel.nonce} />;
}

function PanelBody({ row, section, nonce }: { row: ActivityRow; section: string | null; nonce: number }) {
  const { t, i18n } = useTranslation();
  const flags = usePageStore((s) => s.flags);
  const store = usePageStore.getState;
  const locale = markLocale(i18n.resolvedLanguage);
  const titleId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const renewRef = useRef<HTMLInputElement>(null);
  const feedbackRef = useRef<HTMLHeadingElement>(null);

  const raw = row.rawInput ?? "";
  const ctx: ParseContext = useMemo(() => ({ flags, today: new Date() }), [flags]);
  const parsed = useMemo(() => parseLine(raw, ctx), [raw, ctx]);
  const lineFlags = parsed.flagIds.map((id) => flags.find((f) => f.id === id)).filter((f) => f !== undefined);
  const otherFlags = flags
    .filter((f) => !parsed.flagIds.includes(f.id))
    .map((f) => ({ flag: f, label: flagLabel(f, flags, t) }))
    .sort((a, b) => a.label.localeCompare(b.label));
  // `#name` marks no flag answers to: offer to create them (a path needs the Flags screen).
  const unknownFlags = [
    ...new Set(parsed.marks.filter((m) => m.kind === "flag" && m.status === "unknown" && !m.body.includes("/")).map((m) => m.body)),
  ];
  const type = row.activityType;
  const status = row.status ?? "DRAFT";

  // Focus the section the tick asked for, else the text.
  useEffect(() => {
    const target =
      section === "description"
        ? descriptionRef.current
        : section === "expiration"
          ? renewRef.current
          : section === "feedback"
            ? feedbackRef.current
            : textRef.current;
    target?.focus();
  }, [section, nonce]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && rootRef.current?.contains(document.activeElement as Node)) {
        e.preventDefault();
        store().closePanel();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [store]);

  const rewrite = (next: string, patch?: Partial<ActivityRow>) => void store().setRawInput(row.id, next, patch);
  const update = (patch: Partial<ActivityRow>) => void store().updateFields(row.id, patch);

  const dateField = (field: "deadline" | "eventDate" | "expirationDate", label: string) => (
    <Field label={label}>
      {(id) => (
        <input
          id={id}
          type="date"
          className={INPUT}
          value={toDateInput(row[field])}
          onChange={(e) => rewrite(setDateMark(raw, fromDateInput(e.target.value), ctx))}
        />
      )}
    </Field>
  );

  const intField = (field: "targetCount" | "completionCount" | "streak" | "targetStreak" | "renewalLeadDays", label: string) => (
    <Field label={label}>
      {(id) => (
        <input
          id={id}
          type="number"
          min={0}
          inputMode="numeric"
          className={INPUT}
          value={row[field] ?? ""}
          onChange={(e) => update({ [field]: toInt(e.target.value) })}
        />
      )}
    </Field>
  );

  const textField = (field: "affirmation" | "recipient" | "documentRef" | "renewalUrl", label: string, inputType = "text") => (
    <Field label={label}>
      {(id) => (
        <input id={id} type={inputType} className={INPUT} value={row[field] ?? ""} onChange={(e) => update({ [field]: e.target.value || null })} />
      )}
    </Field>
  );

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      data-testid="line-panel"
      className="fixed inset-x-0 bottom-0 z-30 flex max-h-[85vh] flex-col rounded-t-2xl border-t border-neutral-200 bg-white shadow-2xl dark:border-neutral-800 dark:bg-neutral-950 md:inset-y-0 md:end-0 md:start-auto md:max-h-none md:w-96 md:rounded-none md:border-s md:border-t-0"
    >
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <h2 id={titleId} className="font-semibold">
          {t("panel.title")}
        </h2>
        <button type="button" className={BUTTON} onClick={() => store().closePanel()}>
          {t("panel.close")}
        </button>
      </div>

      <div className="overflow-y-auto px-4 pb-6">
        {/* 1. Text */}
        <Field label={t("panel.text")}>
          {(id) => (
            <input
              id={id}
              ref={textRef}
              className={INPUT}
              value={raw}
              onChange={(e) => store().type(row.id, e.target.value)}
              onBlur={() => void store().commit(row.id)}
            />
          )}
        </Field>

        {/* 2. Type and status */}
        <Section title={t("panel.type")}>
          <Field label={t("panel.type")}>
            {(id) => (
              <select id={id} className={INPUT} value={type} onChange={(e) => rewrite(setTypeMark(raw, e.target.value as ActivityType, ctx, locale))}>
                {TYPES.map((ty) => (
                  <option key={ty} value={ty}>
                    {t(`activityType.${ty}`)}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <p className="text-sm">
            {t("panel.status")}: <span data-testid="panel-status">{t(`status.${status}`)}</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {statusActions(row).map((action) => (
              <button
                key={action}
                type="button"
                className={BUTTON}
                disabled={action === "complete" && !canComplete(row)}
                onClick={() => void store().statusAction(row.id, action)}
              >
                {t(`panel.actions.${action}`)}
              </button>
            ))}
          </div>
        </Section>

        {/* 2b. Hide until… (not for completed or archived lines: they are off the page already) */}
        {status !== "COMPLETED" && status !== "ARCHIVED" && (
          <Section title={t("hide.title")}>
            {isHiddenNow(row, new Date()) ? (
              <div className="flex flex-wrap items-center gap-2" data-testid="panel-hidden">
                <p className="text-sm">
                  {row.isHidden
                    ? t("hidden.untilShown")
                    : t("page.hidden.returns", {
                        date: new Intl.DateTimeFormat(i18n.resolvedLanguage, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(
                          new Date(row.hiddenUntil!),
                        ),
                      })}
                </p>
                <button type="button" className={BUTTON} onClick={() => void store().showNow(row.id)}>
                  {t("page.hidden.showNow")}
                </button>
              </div>
            ) : (
              <HideChooser testPrefix="panel-hide" onHide={(until) => void store().hide(row.id, until)} />
            )}
          </Section>
        )}

        {/* 3. Flags */}
        <Section title={t("panel.flags")}>
          {lineFlags.length === 0 ? (
            <p className="text-sm text-neutral-500 dark:text-neutral-400">{t("panel.noFlags")}</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {lineFlags.map((f) => {
                const label = flagLabel(f, flags, t);
                return (
                  <li key={f.id} className="flex items-center gap-1 rounded-full bg-indigo-100 py-0.5 pe-1 ps-2.5 text-sm text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200">
                    {label}
                    <button
                      type="button"
                      aria-label={t("panel.removeFlag", { name: label })}
                      className="flex h-5 w-5 items-center justify-center rounded-full outline-none hover:bg-indigo-200 focus-visible:ring-2 focus-visible:ring-indigo-500 dark:hover:bg-indigo-900"
                      onClick={() => rewrite(removeFlagMark(raw, f.id, ctx))}
                    >
                      <span aria-hidden="true">×</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {unknownFlags.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {unknownFlags.map((name) => (
                <li key={name}>
                  <button
                    type="button"
                    className={BUTTON}
                    data-testid="panel-create-flag"
                    onClick={() => void useFlagStore.getState().create(name, null)}
                  >
                    {t("panel.createFlag", { name })}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {otherFlags.length > 0 && (
            <Field label={t("panel.addFlag")}>
              {(id) => (
                <select
                  id={id}
                  className={INPUT}
                  value=""
                  onChange={(e) => {
                    const flag = flags.find((f) => f.id === e.target.value);
                    if (flag) rewrite(addFlagMark(raw, flag, ctx, locale));
                  }}
                >
                  <option value="">—</option>
                  {otherFlags.map(({ flag, label }) => (
                    <option key={flag.id} value={flag.id}>
                      {label}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          )}
        </Section>

        {/* 4. Type fields */}
        <TypeFields
          row={row}
          dateField={dateField}
          intField={intField}
          textField={textField}
          update={update}
          renewRef={renewRef}
          onRenew={(iso) => rewrite(setDateMark(raw, iso, ctx), { isRenewed: false })}
        />

        {/* 5. Description */}
        <Section title={type === "GRATITUDE" ? t("panel.gratitudeNotes") : t("panel.description")}>
          <Field label={type === "GRATITUDE" ? t("panel.gratitudeNotes") : t("panel.description")}>
            {(id) => (
              <textarea
                id={id}
                ref={descriptionRef}
                rows={4}
                className={INPUT}
                value={row.description ?? ""}
                onChange={(e) => update({ description: e.target.value || null })}
              />
            )}
          </Field>
          {type === "GRATITUDE" && status !== "COMPLETED" && (
            <div className="flex items-center gap-3">
              <button
                type="button"
                className={PRIMARY}
                disabled={!canComplete(row)}
                onClick={() => void store().statusAction(row.id, "complete")}
              >
                {t("panel.saveComplete")}
              </button>
              {!canComplete(row) && <span className="text-xs text-neutral-500 dark:text-neutral-400">{t("panel.needsNotes")}</span>}
            </div>
          )}
        </Section>

        {/* 6. Schedule */}
        <Schedule row={row} raw={raw} ctx={ctx} locale={locale} rewrite={rewrite} update={update} />

        {/* 7. Feedback */}
        <FeedbackSection activityId={row.id} headingRef={feedbackRef} />

        {/* 8. Delete */}
        <div className="border-t border-neutral-200 pt-3 dark:border-neutral-800">
          <button
            type="button"
            className="rounded px-2.5 py-1 text-sm text-red-700 outline-none hover:bg-red-50 focus-visible:ring-2 focus-visible:ring-red-500 dark:text-red-400 dark:hover:bg-red-950"
            onClick={() => void store().deleteLine(row.id)}
          >
            {t("panel.delete")}
          </button>
        </div>
      </div>
    </div>
  );
}

interface TypeFieldsProps {
  row: ActivityRow;
  dateField(field: "deadline" | "eventDate" | "expirationDate", label: string): ReactNode;
  intField(field: "targetCount" | "completionCount" | "streak" | "targetStreak" | "renewalLeadDays", label: string): ReactNode;
  textField(field: "affirmation" | "recipient" | "documentRef" | "renewalUrl", label: string, inputType?: string): ReactNode;
  update(patch: Partial<ActivityRow>): void;
  renewRef: RefObject<HTMLInputElement | null>;
  onRenew(iso: string): void;
}

function TypeFields({ row, dateField, intField, textField, update, renewRef, onRenew }: TypeFieldsProps) {
  const { t } = useTranslation();
  const [renewTo, setRenewTo] = useState("");
  const title = t(`activityType.${row.activityType}`);

  switch (row.activityType) {
    case "ACTION":
      return <Section title={title}>{dateField("deadline", t("panel.deadline"))}</Section>;
    case "REPETITIVE_ACTION":
      return (
        <Section title={title}>
          {dateField("deadline", t("panel.deadline"))}
          {intField("targetCount", t("panel.targetCount"))}
          {intField("completionCount", t("panel.completionCount"))}
        </Section>
      );
    case "HABIT":
      return (
        <Section title={title}>
          {intField("streak", t("panel.streak"))}
          {intField("targetStreak", t("panel.targetStreak"))}
          <button type="button" className={BUTTON} disabled={!row.streak} onClick={() => update({ streak: 0 })}>
            {t("panel.resetStreak")}
          </button>
        </Section>
      );
    case "ATTITUDE":
      return <Section title={title}>{textField("affirmation", t("panel.affirmation"))}</Section>;
    case "SKILL":
      return (
        <Section title={title}>
          <Field label={t("panel.proficiencyLevel")}>
            {(id) => (
              <select
                id={id}
                className={INPUT}
                value={row.proficiencyLevel ?? ""}
                onChange={(e) => update({ proficiencyLevel: (e.target.value || null) as ActivityRow["proficiencyLevel"] })}
              >
                <option value="">{t("panel.noLevel")}</option>
                {LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {t(`proficiencyLevel.${l}`)}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label={t("panel.learningResources")}>
            {(id) => (
              <textarea
                id={id}
                rows={3}
                className={INPUT}
                value={(row.learningResources ?? []).join("\n")}
                onChange={(e) => {
                  const list = e.target.value.split("\n");
                  update({ learningResources: list.some((l) => l.trim()) ? list : null });
                }}
              />
            )}
          </Field>
        </Section>
      );
    case "MOMENTO":
      return <Section title={title}>{dateField("eventDate", t("panel.eventDate"))}</Section>;
    case "GRATITUDE":
      return <Section title={title}>{textField("recipient", t("panel.recipient"))}</Section>;
    case "EXPIRATION": {
      const renewIso = fromDateInput(renewTo);
      return (
        <Section title={title}>
          {dateField("expirationDate", t("panel.expirationDate"))}
          {intField("renewalLeadDays", t("panel.renewalLeadDays"))}
          {textField("documentRef", t("panel.documentRef"))}
          {textField("renewalUrl", t("panel.renewalUrl"), "url")}
          <Field label={t("panel.renewDate")}>
            {(id) => <input id={id} ref={renewRef} type="date" className={INPUT} value={renewTo} onChange={(e) => setRenewTo(e.target.value)} />}
          </Field>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={PRIMARY}
              disabled={!renewIso}
              onClick={() => {
                if (renewIso) onRenew(renewIso);
                setRenewTo("");
              }}
            >
              {t("panel.renew")}
            </button>
            <button type="button" className={BUTTON} onClick={() => void usePageStore.getState().statusAction(row.id, "archive")}>
              {t("panel.archiveExpired")}
            </button>
          </div>
        </Section>
      );
    }
  }
}

interface ScheduleProps {
  row: ActivityRow;
  raw: string;
  ctx: ParseContext;
  locale: MarkLocale;
  rewrite(next: string, patch?: Partial<ActivityRow>): void;
  update(patch: Partial<ActivityRow>): void;
}

function Schedule({ row, raw, ctx, locale, rewrite, update }: ScheduleProps) {
  const { t, i18n } = useTranslation();
  const usesFrequency = row.activityType === "REPETITIVE_ACTION" || row.activityType === "HABIT";
  const cron = row.cron ?? "";

  const next = useMemo(() => {
    if (!cron.trim()) return null;
    try {
      const date = CronExpressionParser.parse(cron.trim()).next().toDate();
      return new Intl.DateTimeFormat(i18n.resolvedLanguage, { dateStyle: "full", timeStyle: "short" }).format(date);
    } catch {
      return false;
    }
  }, [cron, i18n.resolvedLanguage]);

  const setFrequency = (value: string) => {
    if (value === "") rewrite(setFrequencyMark(raw, null, ctx, locale), { frequency: null });
    else if (value === "CUSTOM") rewrite(setFrequencyMark(raw, null, ctx, locale), { frequency: "CUSTOM" });
    else rewrite(setFrequencyMark(raw, value as Frequency, ctx, locale));
  };

  return (
    <Section title={t("panel.schedule")}>
      {usesFrequency && (
        <Field label={t("panel.frequency")}>
          {(id) => (
            <select id={id} className={INPUT} value={row.frequency ?? ""} onChange={(e) => setFrequency(e.target.value)}>
              <option value="">{t("panel.noFrequency")}</option>
              {FREQUENCIES.map((f) => (
                <option key={f} value={f}>
                  {t(`frequency.${f}`)}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}
      <Field label={t("panel.cron")}>
        {(id) => (
          <>
            <input
              id={id}
              className={`${INPUT} font-mono`}
              value={cron}
              placeholder="0 8 * * 1-5"
              aria-describedby={`${id}-hint`}
              onChange={(e) => update({ cron: e.target.value || null })}
            />
            <p id={`${id}-hint`} className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
              {next === false ? (
                <span className="text-red-700 dark:text-red-400">{t("panel.cronInvalid")}</span>
              ) : next ? (
                t("panel.cronNext", { date: next })
              ) : (
                t("panel.cronHint")
              )}
            </p>
          </>
        )}
      </Field>
    </Section>
  );
}
