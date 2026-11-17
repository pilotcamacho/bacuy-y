import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { activeFilter, NO_FLAG } from "@/services/editor/flagFilter";
import { flagLabel } from "@/services/flags/label";
import { buildTree, type FlagNode } from "@/services/flags/tree";
import type { FlagRow } from "@/lib/db/types";
import { usePageStore } from "@/stores/pageStore";

const LINK =
  "rounded px-1 text-sm text-neutral-500 outline-none hover:text-neutral-900 hover:underline focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-neutral-400 dark:hover:text-neutral-100";
const CHIP =
  "flex items-center gap-1 rounded-full bg-indigo-100 py-0.5 pe-1 ps-2.5 text-sm text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200";

/**
 * Filter the page by flag (docs/05-line-mapping.md §6): pick flags (a parent includes its
 * children; several = any of them) and/or "no flag". The choice is kept on this device; while
 * it is on, the chips say so and one click clears it.
 */
export function FlagFilter() {
  const { t } = useTranslation();
  const flags = usePageStore((s) => s.flags);
  const filter = usePageStore((s) => s.filter);
  const store = usePageStore.getState;
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);

  const active = useMemo(() => activeFilter(filter, flags), [filter, flags]);
  const tree = useMemo(() => buildTree(flags), [flags]);
  const label = (id: string) => {
    if (id === NO_FLAG) return t("filter.noFlag");
    const flag = flags.find((f) => f.id === id);
    return flag ? flagLabel(flag, flags, t) : id;
  };
  const name = (f: FlagRow) => (f.isSystemDefault ? t(`flag.${f.name}`) : f.name);

  const toggle = (id: string) => {
    const next = active.includes(id) ? active.filter((x) => x !== id) : [...active, id];
    store().setFilter(next);
  };
  const close = () => {
    setOpen(false);
    toggleRef.current?.focus();
  };

  const option = (id: string, text: string, depth: number) => (
    <li key={id} style={{ paddingInlineStart: `${depth * 1.25}rem` }}>
      <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 hover:bg-neutral-100 dark:hover:bg-neutral-800">
        <input
          type="checkbox"
          className="h-4 w-4 accent-indigo-600"
          checked={active.includes(id)}
          data-testid={`flag-filter-option-${id === NO_FLAG ? "none" : id}`}
          onChange={() => toggle(id)}
        />
        <span>{text}</span>
      </label>
    </li>
  );
  const branch = (nodes: FlagNode[], depth: number): React.ReactNode[] =>
    nodes.flatMap((node) => [option(node.flag.id, name(node.flag), depth), ...branch(node.children, depth + 1)]);

  return (
    <div className="mb-2" data-testid="flag-filter">
      <div className="flex flex-wrap items-center gap-2">
        <button
          ref={toggleRef}
          type="button"
          className={LINK}
          aria-expanded={open}
          aria-controls="flag-filter-options"
          data-testid="flag-filter-toggle"
          onClick={() => setOpen((o) => !o)}
        >
          <span aria-hidden="true">{open ? "▾" : "▸"} </span>
          {active.length > 0 ? t("filter.filteredBy") : t("filter.button")}
        </button>
        {active.length > 0 && (
          <>
            <ul className="flex flex-wrap gap-1.5" aria-label={t("filter.active")}>
              {active.map((id) => (
                <li key={id} className={CHIP} data-testid={`flag-filter-chip-${id === NO_FLAG ? "none" : id}`}>
                  {label(id)}
                  <button
                    type="button"
                    aria-label={t("filter.remove", { name: label(id) })}
                    className="flex h-5 w-5 items-center justify-center rounded-full outline-none hover:bg-indigo-200 focus-visible:ring-2 focus-visible:ring-indigo-500 dark:hover:bg-indigo-900"
                    onClick={() => toggle(id)}
                  >
                    <span aria-hidden="true">×</span>
                  </button>
                </li>
              ))}
            </ul>
            <button type="button" className={LINK} data-testid="flag-filter-clear" onClick={() => store().setFilter([])}>
              {t("filter.clear")}
            </button>
          </>
        )}
      </div>
      {open && (
        <div
          id="flag-filter-options"
          className="mt-2 rounded border border-neutral-200 p-2 text-sm dark:border-neutral-800"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              close();
            }
          }}
        >
          <p className="mb-1 text-xs text-neutral-500 dark:text-neutral-400">{t("filter.hint")}</p>
          <ul data-testid="flag-filter-options">
            {option(NO_FLAG, t("filter.noFlag"), 0)}
            {branch(tree, 0)}
          </ul>
          <button type="button" className={`${LINK} mt-1`} onClick={close}>
            {t("filter.done")}
          </button>
        </div>
      )}
    </div>
  );
}
