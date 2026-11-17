import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { UNDO_MS, usePageStore } from "@/stores/pageStore";

/** "How did it go?" stays this long; ignoring it does nothing (docs/05-line-mapping.md §4). */
export const FEEDBACK_PROMPT_MS = 6000;

const TOAST =
  "fixed inset-x-0 bottom-4 z-40 mx-auto flex w-fit max-w-[calc(100%-2rem)] flex-wrap items-center gap-3 rounded-lg bg-neutral-900 px-4 py-2 text-sm text-white shadow-lg dark:bg-neutral-100 dark:text-neutral-900";
const ACTION =
  "rounded px-1 font-semibold text-indigo-300 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-indigo-400 dark:text-indigo-700";

/**
 * Non-blocking toasts of the page: "line merged / deleted — undo" for UNDO_MS, and the habit
 * hint "target streak reached — mark as formed?" (docs/05-line-mapping.md §4).
 */
export function UndoToast() {
  const { t, i18n } = useTranslation();
  const undo = usePageStore((s) => s.undo);
  const notice = usePageStore((s) => s.notice);

  useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(() => usePageStore.getState().dismissUndo(), UNDO_MS);
    return () => clearTimeout(timer);
  }, [undo]);

  useEffect(() => {
    if (!notice) return;
    const ms = notice.kind === "habitFormed" ? UNDO_MS * 2 : FEEDBACK_PROMPT_MS;
    const timer = setTimeout(() => usePageStore.getState().dismissNotice(), ms);
    return () => clearTimeout(timer);
  }, [notice]);

  if (undo) {
    return (
      <div role="status" className={TOAST}>
        <span>{t(undo.kind === "deleted" ? "page.lineDeleted" : "page.lineMerged")}</span>
        <button type="button" onClick={() => void usePageStore.getState().undoLast()} className={ACTION}>
          {t("page.undo")}
        </button>
      </div>
    );
  }

  if (notice?.kind === "hidden" || notice?.kind === "completed") {
    const store = usePageStore.getState;
    const date = notice.until
      ? new Intl.DateTimeFormat(i18n.resolvedLanguage, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(
          new Date(notice.until),
        )
      : "";
    return (
      <div role="status" className={TOAST} data-testid={notice.kind === "hidden" ? "hidden-toast" : "completed-toast"}>
        <span>
          {notice.kind === "completed"
            ? t("page.completed.toast")
            : !notice.manual
              ? t("page.hidden.toast", { date })
              : date
                ? t("page.hidden.manualToast", { date })
                : t("page.hidden.manualToastIndefinite")}
        </span>
        <button type="button" className={ACTION} onClick={() => void store().undoHide()}>
          {t("page.undo")}
        </button>
        {!notice.manual && (
        <button
          type="button"
          className={ACTION}
          data-testid="feedback-prompt"
          onClick={() => {
            store().dismissNotice();
            store().openPanel(notice.id, "feedback");
          }}
        >
          {t("feedback.rate")}
        </button>
        )}
      </div>
    );
  }

  if (notice) {
    const store = usePageStore.getState;
    return (
      <div role="status" className={TOAST}>
        <span>{t("panel.habitFormed")}</span>
        <button
          type="button"
          className={ACTION}
          onClick={() => {
            void store().statusAction(notice.id, "complete");
            store().dismissNotice();
          }}
        >
          {t("panel.markFormed")}
        </button>
        <button type="button" className={ACTION} onClick={() => store().dismissNotice()}>
          {t("panel.dismiss")}
        </button>
      </div>
    );
  }

  return null;
}
