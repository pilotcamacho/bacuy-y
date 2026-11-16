import { useEffect, useId, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import type { FeedbackRow } from "@/lib/db/types";
import { subscribe } from "@/lib/events";
import { arousalKey, valenceKey } from "@/services/feedback/emotion";
import { useFeedbackStore } from "@/stores/feedbackStore";

/**
 * Section 7 of the side panel (docs/05-line-mapping.md §5): the line's feedback entries and
 * the form to add one: rating 1–5 (required), emotion as two optional axes (valence −1..1,
 * arousal 0..1, as bacuy-x), and notes.
 */

const INPUT =
  "w-full rounded border border-neutral-300 bg-white px-2 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-neutral-700 dark:bg-neutral-900";
const BUTTON =
  "rounded border border-neutral-300 px-2.5 py-1 text-sm outline-none hover:bg-neutral-100 focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800";
const PRIMARY =
  "rounded bg-indigo-600 px-2.5 py-1 text-sm font-medium text-white outline-none hover:bg-indigo-700 focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:opacity-50 dark:bg-indigo-500 dark:hover:bg-indigo-400";
const EMPTY: FeedbackRow[] = [];

export function FeedbackSection({ activityId, headingRef }: { activityId: string; headingRef: RefObject<HTMLHeadingElement | null> }) {
  const { t, i18n } = useTranslation();
  const entries = useFeedbackStore((s) => s.byActivity[activityId] ?? EMPTY);
  const headingId = useId();

  useEffect(() => {
    void useFeedbackStore.getState().load(activityId);
  }, [activityId]);
  useEffect(
    () =>
      subscribe((event, fromOtherTab) => {
        if ((event.type === "synced" && event.changed) || (event.type === "localWrite" && fromOtherTab)) {
          void useFeedbackStore.getState().refresh();
        }
      }),
    [],
  );

  const dateFormat = new Intl.DateTimeFormat(i18n.resolvedLanguage, { dateStyle: "medium", timeStyle: "short" });

  return (
    <section className="border-t border-neutral-200 py-3 dark:border-neutral-800" aria-labelledby={headingId}>
      <h3
        id={headingId}
        ref={headingRef}
        tabIndex={-1}
        className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500 outline-none dark:text-neutral-400"
      >
        {t("panel.feedback")}
      </h3>

      {entries.length === 0 ? (
        <p className="mb-2 text-sm text-neutral-500 dark:text-neutral-400">{t("feedback.none")}</p>
      ) : (
        <ul className="mb-3 space-y-2" data-testid="feedback-list">
          {entries.map((f) => (
            <li key={f.id} className="rounded border border-neutral-200 p-2 text-sm dark:border-neutral-800">
              <div className="flex items-center gap-2">
                <span className="text-amber-500" aria-label={t("feedback.ratingValue", { rating: f.rating ?? 0 })}>
                  <span aria-hidden="true">{"★".repeat(f.rating ?? 0) + "☆".repeat(5 - (f.rating ?? 0))}</span>
                </span>
                <time className="text-xs text-neutral-500 dark:text-neutral-400" dateTime={f.editedAt}>
                  {dateFormat.format(new Date(f.editedAt))}
                </time>
                <button
                  type="button"
                  className="ms-auto rounded px-1.5 text-xs text-red-700 outline-none hover:bg-red-50 focus-visible:ring-2 focus-visible:ring-red-500 dark:text-red-400 dark:hover:bg-red-950"
                  onClick={() => void useFeedbackStore.getState().remove(f.id)}
                >
                  {t("feedback.delete")}
                </button>
              </div>
              {(f.emotionValence != null || f.emotionArousal != null) && (
                <p className="text-xs text-neutral-600 dark:text-neutral-400">
                  {[
                    f.emotionValence != null ? t(`feedback.valence.${valenceKey(f.emotionValence)}`) : null,
                    f.emotionArousal != null ? t(`feedback.arousal.${arousalKey(f.emotionArousal)}`) : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              )}
              {f.content && <p className="mt-1 whitespace-pre-wrap">{f.content}</p>}
            </li>
          ))}
        </ul>
      )}

      <FeedbackForm activityId={activityId} />
    </section>
  );
}

export function FeedbackForm({ activityId }: { activityId: string }) {
  const { t } = useTranslation();
  const [rating, setRating] = useState(0);
  const [valence, setValence] = useState<number | null>(null);
  const [arousal, setArousal] = useState<number | null>(null);
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const ratingName = useId();
  const valenceId = useId();
  const arousalId = useId();
  const notesId = useId();

  async function save() {
    if (rating < 1) return;
    setBusy(true);
    try {
      await useFeedbackStore.getState().add(activityId, { rating, emotionValence: valence, emotionArousal: arousal, content });
      setRating(0);
      setValence(null);
      setArousal(null);
      setContent("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="space-y-2"
      data-testid="feedback-form"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <fieldset>
        <legend className="mb-1 text-sm text-neutral-700 dark:text-neutral-300">{t("feedback.rating")}</legend>
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <label key={n} className="relative cursor-pointer">
              <input
                type="radio"
                name={ratingName}
                value={n}
                checked={rating === n}
                onChange={() => setRating(n)}
                aria-label={t("feedback.ratingValue", { rating: n })}
                className="peer sr-only"
              />
              <span
                aria-hidden="true"
                className={`block rounded px-0.5 text-2xl leading-none peer-focus-visible:ring-2 peer-focus-visible:ring-indigo-500 ${
                  n <= rating ? "text-amber-500" : "text-neutral-300 dark:text-neutral-600"
                }`}
              >
                ★
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <EmotionSlider
        id={valenceId}
        label={t("feedback.valenceLabel")}
        min={-1}
        max={1}
        neutral={0}
        value={valence}
        onChange={setValence}
        left={t("feedback.valence.negative")}
        right={t("feedback.valence.positive")}
        describe={(v) => t(`feedback.valence.${valenceKey(v)}`)}
      />
      <EmotionSlider
        id={arousalId}
        label={t("feedback.arousalLabel")}
        min={0}
        max={1}
        neutral={0.5}
        value={arousal}
        onChange={setArousal}
        left={t("feedback.arousal.calm")}
        right={t("feedback.arousal.high")}
        describe={(v) => t(`feedback.arousal.${arousalKey(v)}`)}
      />

      <div>
        <label htmlFor={notesId} className="mb-1 block text-sm text-neutral-700 dark:text-neutral-300">
          {t("feedback.notes")}
        </label>
        <textarea id={notesId} rows={2} className={INPUT} value={content} onChange={(e) => setContent(e.target.value)} />
      </div>

      <div className="flex items-center gap-2">
        <button type="submit" className={PRIMARY} disabled={rating < 1 || busy}>
          {t("feedback.save")}
        </button>
        {rating < 1 && <span className="text-xs text-neutral-500 dark:text-neutral-400">{t("feedback.ratingRequired")}</span>}
      </div>
    </form>
  );
}

/** One emotion axis. Untouched = not recorded (null); "clear" goes back to untouched. */
function EmotionSlider(props: {
  id: string;
  label: string;
  min: number;
  max: number;
  neutral: number;
  value: number | null;
  onChange(v: number | null): void;
  left: string;
  right: string;
  describe(v: number): string;
}) {
  const { t } = useTranslation();
  const { id, value } = props;
  return (
    <div>
      <div className="mb-1 flex items-center gap-2 text-sm">
        <label htmlFor={id} className="text-neutral-700 dark:text-neutral-300">
          {props.label}
        </label>
        <span className="text-xs text-neutral-500 dark:text-neutral-400">
          {value === null ? t("feedback.notSet") : props.describe(value)}
        </span>
        {value !== null && (
          <button type="button" className={`${BUTTON} ms-auto px-1.5 py-0 text-xs`} onClick={() => props.onChange(null)}>
            {t("feedback.clear")}
          </button>
        )}
      </div>
      <div className="flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
        <span aria-hidden="true">{props.left}</span>
        <input
          id={id}
          type="range"
          min={props.min}
          max={props.max}
          step={0.1}
          value={value ?? props.neutral}
          aria-valuetext={value === null ? t("feedback.notSet") : props.describe(value)}
          onChange={(e) => props.onChange(Number(e.target.value))}
          className={`flex-1 accent-indigo-600 ${value === null ? "opacity-40" : ""}`}
        />
        <span aria-hidden="true">{props.right}</span>
      </div>
    </div>
  );
}
