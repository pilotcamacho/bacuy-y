import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Link, useInRouterContext } from "react-router-dom";
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
  const reviewTitle = usePageStore((s) => (s.notice?.kind === "review" ? s.activities[s.notice.id]?.title : undefined));
  const goodRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(() => usePageStore.getState().dismissUndo(), UNDO_MS);
    return () => clearTimeout(timer);
  }, [undo]);

  // The review question takes the focus (it was asked by a tick or Ctrl+Enter) and waits.
  useEffect(() => {
    if (notice?.kind === "review") goodRef.current?.focus();
  }, [notice]);

  useEffect(() => {
    if (!notice || notice.kind === "review") return;
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

  if (notice?.kind === "review") {
    const store = usePageStore.getState;
    const answer = (good: boolean) => {
      store().dismissNotice();
      void store().review(notice.id, good);
    };
    return (
      <div
        role="dialog"
        aria-label={t("review.question")}
        className={TOAST}
        data-testid="review-prompt"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            store().dismissNotice();
            store().setFocus(notice.id, 0);
          }
        }}
      >
        <span>
          {t("review.question")}
          {reviewTitle ? <span className="ms-1 font-semibold">«{reviewTitle}»</span> : null}
        </span>
        <button ref={goodRef} type="button" className={ACTION} data-testid="review-good" onClick={() => answer(true)}>
          {t("review.good")}
        </button>
        <button type="button" className={ACTION} data-testid="review-bad" onClick={() => answer(false)}>
          {t("review.bad")}
        </button>
        <button
          type="button"
          className={ACTION}
          onClick={() => {
            store().dismissNotice();
            store().setFocus(notice.id, 0);
          }}
        >
          {t("panel.dismiss")}
        </button>
      </div>
    );
  }

  if (notice?.kind === "expirationWaiting") {
    const fmt = new Intl.DateTimeFormat(i18n.resolvedLanguage, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
    return (
      <div role="status" className={TOAST} data-testid="expiration-waiting">
        <span>{t("expirations.waitingToast", { date: fmt.format(new Date(notice.until!)) })}</span>
        <ExpirationsLink onClick={() => usePageStore.getState().dismissNotice()} />
        <button type="button" className={ACTION} onClick={() => usePageStore.getState().dismissNotice()}>
          {t("panel.dismiss")}
        </button>
      </div>
    );
  }

  if (notice?.kind === "movedToGroceries") {
    return (
      <div role="status" className={TOAST} data-testid="moved-to-groceries">
        <span>{t("groceries.movedToast")}</span>
        <GroceriesLink onClick={() => usePageStore.getState().dismissNotice()} />
        <button type="button" className={ACTION} onClick={() => usePageStore.getState().dismissNotice()}>
          {t("panel.dismiss")}
        </button>
      </div>
    );
  }

  if (notice?.kind === "spacingOverride") {
    return (
      <div role="status" className={TOAST} data-testid="spacing-override">
        <span>{t("review.overridesFrequency")}</span>
        <button type="button" className={ACTION} onClick={() => usePageStore.getState().dismissNotice()}>
          {t("panel.dismiss")}
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
          {notice.grocery
            ? t("groceries.boughtToast")
            : notice.review
            ? notice.kind === "completed"
              ? t("review.internalized")
              : t(notice.review.good ? "review.backGood" : "review.backBad", { date })
            : notice.kind === "completed"
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
        {!notice.manual && !notice.review && !notice.grocery && (
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

/** "See Vencimientos" (only inside the router; the editor's tests render it alone). */
function ExpirationsLink({ onClick }: { onClick(): void }) {
  const { t } = useTranslation();
  const inRouter = useInRouterContext();
  if (!inRouter) return null;
  return (
    <Link to="/expirations" className={ACTION} onClick={onClick}>
      {t("expirations.see")}
    </Link>
  );
}

function GroceriesLink({ onClick }: { onClick(): void }) {
  const { t } = useTranslation();
  const inRouter = useInRouterContext();
  if (!inRouter) return null;
  return (
    <Link to="/groceries" className={ACTION} onClick={onClick}>
      {t("groceries.see")}
    </Link>
  );
}
