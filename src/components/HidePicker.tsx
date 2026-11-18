import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { usePageStore } from "@/stores/pageStore";
import { HideChooser } from "./HideChooser";

const BUTTON =
  "rounded px-2.5 py-1 text-sm outline-none hover:bg-neutral-100 focus-visible:ring-2 focus-visible:ring-indigo-500 dark:hover:bg-neutral-800";

/**
 * "Hide until…" for one line, without the panel: opened by a long swipe to the right or
 * Ctrl+Shift+Alt+H (docs/05-line-mapping.md §3). A bottom sheet on phones, centered on wide
 * screens. Escape or Cancel leaves the line as it was.
 */
export function HidePicker() {
  const { t } = useTranslation();
  const id = usePageStore((s) => s.hidePicker);
  const title = usePageStore((s) => (s.hidePicker ? s.activities[s.hidePicker]?.title : undefined));
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (id) ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [id]);

  if (!id) return null;
  const store = usePageStore.getState;
  const cancel = () => store().closeHidePicker();

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 sm:items-center" onClick={cancel}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={t("hide.pickerTitle")}
        data-testid="hide-picker"
        className="w-full max-w-md space-y-3 rounded-t-xl bg-white p-4 shadow-xl sm:rounded-xl dark:bg-neutral-900"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
        }}
      >
        <p className="text-sm font-semibold">
          {t("hide.pickerTitle")}
          {title ? <span className="ms-1 font-normal text-neutral-600 dark:text-neutral-400">«{title}»</span> : null}
        </p>
        <HideChooser
          testPrefix="hide-picker"
          onHide={(until) => {
            store().closeHidePicker(false);
            void store().hide(id, until);
          }}
        />
        <div className="flex justify-end">
          <button type="button" className={BUTTON} data-testid="hide-picker-cancel" onClick={cancel}>
            {t("hide.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
