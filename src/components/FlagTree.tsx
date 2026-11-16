import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { FlagRow } from "@/lib/db/types";
import {
  WEIGHT_TOTAL,
  isValidWeight,
  sumOf,
  sumsTo100,
  type FlagNode,
  type NameProblem,
} from "@/services/flags/tree";
import { useFlagStore, type WeightProblem } from "@/stores/flagStore";

/**
 * The flag tree editor (Phase 9). Each sibling group edits its weights together and can only
 * save when they sum to 100 (CLAUDE.md rule 11). Names, colors and deletions are written at
 * once. System flags keep their name (it is their key) and cannot be deleted.
 */

const INPUT =
  "rounded border border-neutral-300 bg-white px-2 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-neutral-700 dark:bg-neutral-900";
const BUTTON =
  "rounded border border-neutral-300 px-2.5 py-1 text-sm outline-none hover:bg-neutral-100 focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50 disabled:hover:bg-transparent dark:border-neutral-700 dark:hover:bg-neutral-800";
const PRIMARY =
  "rounded bg-indigo-600 px-2.5 py-1 text-sm font-medium text-white outline-none hover:bg-indigo-700 focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:opacity-50 dark:bg-indigo-500 dark:hover:bg-indigo-400";
const DANGER =
  "rounded bg-red-700 px-2.5 py-1 text-sm text-white outline-none hover:bg-red-800 focus-visible:ring-2 focus-visible:ring-red-500 disabled:opacity-50";
const NO_COLOR = "#a3a3a3";
const COLOR_DELAY_MS = 400;

function useFlagName() {
  const { t } = useTranslation();
  return (flag: FlagRow) => (flag.isSystemDefault ? t(`flag.${flag.name}`) : flag.name);
}

function parseWeight(text: string): number {
  return text.trim() === "" ? NaN : Number(text.replace(",", "."));
}

function formatNumber(n: number, locale: string | undefined): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(n);
}

export function FlagTree({ nodes, drift }: { nodes: FlagNode[]; drift: Set<string | null> }) {
  return <FlagGroup parentId={null} nodes={nodes} drift={drift} depth={0} />;
}

function FlagGroup({
  parentId,
  nodes,
  drift,
  depth,
}: {
  parentId: string | null;
  nodes: FlagNode[];
  drift: Set<string | null>;
  depth: number;
}) {
  const { t, i18n } = useTranslation();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<WeightProblem | null>(null);
  const [busy, setBusy] = useState(false);
  const groupKey = parentId ?? "root";

  // Only the drafts of flags still in the group count (one deleted meanwhile is ignored).
  const weightOf = (f: FlagRow) => (draft[f.id] !== undefined ? parseWeight(draft[f.id]!) : f.weight);
  const weights = nodes.map((n) => weightOf(n.flag));
  const allValid = weights.every(isValidWeight);
  const sum = allValid ? sumOf(weights) : NaN;
  const changed = nodes.some((n) => draft[n.flag.id] !== undefined && weightOf(n.flag) !== n.flag.weight);
  const ok = allValid && sumsTo100(weights);
  const drifted = drift.has(parentId) && !changed;

  async function save() {
    const next: Record<string, number> = {};
    for (const n of nodes) next[n.flag.id] = weightOf(n.flag);
    setBusy(true);
    const result = await useFlagStore.getState().saveWeights(parentId, next);
    setBusy(false);
    setProblem(result);
    if (!result) setDraft({});
  }

  return (
    <div className={depth > 0 ? "ms-4 border-s border-neutral-200 ps-3 dark:border-neutral-800" : undefined}>
      {nodes.length > 0 && (
        <ul className="space-y-1">
          {nodes.map((node) => (
            <FlagItem
              key={node.flag.id}
              node={node}
              drift={drift}
              depth={depth}
              weightText={draft[node.flag.id] ?? String(node.flag.weight)}
              onWeight={(text) => {
                setProblem(null);
                setDraft((d) => ({ ...d, [node.flag.id]: text }));
              }}
            />
          ))}
        </ul>
      )}

      {nodes.length > 0 && (
        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm" data-testid={`flags-group-${groupKey}`}>
          <span
            className={ok ? "text-neutral-500 dark:text-neutral-400" : "font-medium text-amber-700 dark:text-amber-400"}
            data-testid={`flags-sum-${groupKey}`}
          >
            {allValid
              ? t("flags.sum", { sum: formatNumber(sum, i18n.resolvedLanguage), total: WEIGHT_TOTAL })
              : t("flags.weightInvalid")}
          </span>
          {drifted && <span className="text-amber-700 dark:text-amber-400">{t("flags.driftGroup")}</span>}
          {changed && (
            <>
              <button
                type="button"
                className={PRIMARY}
                disabled={!ok || busy}
                onClick={() => void save()}
                data-testid={`flags-save-${groupKey}`}
              >
                {t("flags.saveWeights")}
              </button>
              <button
                type="button"
                className={BUTTON}
                disabled={busy}
                onClick={() => {
                  setDraft({});
                  setProblem(null);
                }}
              >
                {t("flags.resetWeights")}
              </button>
            </>
          )}
          {changed && allValid && !ok && <span className="text-amber-700 dark:text-amber-400">{t("flags.mustSum", { total: WEIGHT_TOTAL })}</span>}
          {problem && (
            <span role="alert" className="text-red-700 dark:text-red-400">
              {problem === "sum" ? t("flags.mustSum", { total: WEIGHT_TOTAL }) : t("flags.weightInvalid")}
            </span>
          )}
        </div>
      )}

      {depth === 0 && <AddFlag parentId={null} />}
    </div>
  );
}

function FlagItem({
  node,
  drift,
  depth,
  weightText,
  onWeight,
}: {
  node: FlagNode;
  drift: Set<string | null>;
  depth: number;
  weightText: string;
  onWeight(text: string): void;
}) {
  const { t } = useTranslation();
  const nameOf = useFlagName();
  const { flag, children } = node;
  const label = nameOf(flag);
  const [adding, setAdding] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const weightId = useId();
  const addRef = useRef<HTMLButtonElement>(null);

  return (
    <li data-testid={`flag-${flag.id}`}>
      <div className="flex flex-wrap items-center gap-2 py-1">
        <ColorInput flag={flag} label={label} />
        {flag.isSystemDefault ? (
          <span className="min-w-0 flex-1 truncate text-sm" title={t("flags.system")}>
            {label}
          </span>
        ) : (
          <NameInput flag={flag} />
        )}
        <label htmlFor={weightId} className="sr-only">
          {t("flags.weightOf", { name: label })}
        </label>
        <input
          id={weightId}
          type="number"
          inputMode="decimal"
          min={0}
          max={WEIGHT_TOTAL}
          step="any"
          className={`${INPUT} w-20 text-end`}
          value={weightText}
          onChange={(e) => onWeight(e.target.value)}
          data-testid={`flag-weight-${flag.id}`}
        />
        <button
          type="button"
          className={BUTTON}
          ref={addRef}
          onClick={() => setAdding((a) => !a)}
          aria-expanded={adding}
          aria-label={t("flags.addChildTo", { name: label })}
          title={t("flags.addChildTo", { name: label })}
        >
          <span aria-hidden="true">+</span>
        </button>
        {!flag.isSystemDefault && (
          <button
            type="button"
            className={BUTTON}
            onClick={() => setConfirming(true)}
            aria-label={t("flags.delete", { name: label })}
            title={t("flags.delete", { name: label })}
            data-testid={`flag-delete-${flag.id}`}
          >
            <span aria-hidden="true">🗑</span>
          </button>
        )}
      </div>

      {confirming && (
        <div
          role="alertdialog"
          aria-label={t("flags.delete", { name: label })}
          className="mb-2 space-y-2 rounded border border-red-300 bg-red-50 p-3 text-sm dark:border-red-800 dark:bg-red-950"
        >
          <p>{t(children.length > 0 ? "flags.confirmDeleteTree" : "flags.confirmDelete", { name: label })}</p>
          <div className="flex gap-2">
            <button
              type="button"
              className={DANGER}
              onClick={() => {
                setConfirming(false);
                void useFlagStore.getState().remove(flag.id);
              }}
              data-testid={`flag-delete-confirm-${flag.id}`}
            >
              {t("flags.confirm")}
            </button>
            <button type="button" className={BUTTON} onClick={() => setConfirming(false)}>
              {t("flags.cancel")}
            </button>
          </div>
        </div>
      )}

      {(children.length > 0 || adding) && (
        <div className="mb-1">
          <FlagGroup parentId={flag.id} nodes={children} drift={drift} depth={depth + 1} />
          {adding && (
            <div className="ms-4 ps-3">
              <AddFlag parentId={flag.id} onDone={() => {
                  setAdding(false);
                  addRef.current?.focus();
                }}
                autoFocus />
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function problemText(t: (k: string) => string, problem: NameProblem): string {
  return t(`flags.nameProblem.${problem}`);
}

function NameInput({ flag }: { flag: FlagRow }) {
  const { t } = useTranslation();
  const [value, setValue] = useState(flag.name);
  const [problem, setProblem] = useState<NameProblem | null>(null);
  const id = useId();
  const errorId = useId();

  // A rename from another device shows up unless the user is typing a different name.
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setValue(flag.name);
  }, [flag.name]);

  async function commit() {
    editing.current = false;
    if (value.trim() === flag.name) {
      setValue(flag.name);
      setProblem(null);
      return;
    }
    const result = await useFlagStore.getState().rename(flag.id, value);
    setProblem(result);
  }

  return (
    <div className="min-w-0 flex-1">
      <label htmlFor={id} className="sr-only">
        {t("flags.name")}
      </label>
      <input
        id={id}
        className={`${INPUT} w-full`}
        value={value}
        aria-invalid={problem ? true : undefined}
        aria-describedby={problem ? errorId : undefined}
        onFocus={() => (editing.current = true)}
        onChange={(e) => {
          setValue(e.target.value);
          setProblem(null);
        }}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void commit();
          } else if (e.key === "Escape") {
            setValue(flag.name);
            setProblem(null);
          }
        }}
        data-testid={`flag-name-${flag.id}`}
      />
      {problem && (
        <p id={errorId} role="alert" className="mt-1 text-xs text-red-700 dark:text-red-400">
          {problemText(t, problem)}
        </p>
      )}
    </div>
  );
}

function ColorInput({ flag, label }: { flag: FlagRow; label: string }) {
  const { t } = useTranslation();
  const [value, setValue] = useState(flag.color ?? NO_COLOR);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = useId();

  useEffect(() => {
    if (!timer.current) setValue(flag.color ?? NO_COLOR);
  }, [flag.color]);
  // Write a color still waiting for its delay when the row goes away.
  const latest = useRef(value);
  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
        void useFlagStore.getState().setColor(flag.id, latest.current);
      }
    },
    [flag.id],
  );

  return (
    <>
      <label htmlFor={id} className="sr-only">
        {t("flags.colorOf", { name: label })}
      </label>
      <input
        id={id}
        type="color"
        className="h-7 w-7 shrink-0 cursor-pointer rounded border border-neutral-300 bg-transparent p-0.5 dark:border-neutral-700"
        value={value}
        onChange={(e) => {
          const color = e.target.value;
          setValue(color);
          latest.current = color;
          // The picker fires on every move: write once it settles.
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => {
            timer.current = null;
            void useFlagStore.getState().setColor(flag.id, color);
          }, COLOR_DELAY_MS);
        }}
        data-testid={`flag-color-${flag.id}`}
      />
    </>
  );
}

function AddFlag({ parentId, onDone, autoFocus }: { parentId: string | null; onDone?: () => void; autoFocus?: boolean }) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [problem, setProblem] = useState<NameProblem | null>(null);
  const id = useId();
  const errorId = useId();
  const groupKey = parentId ?? "root";

  async function submit() {
    // Cleared at once, so keys typed while it saves start the next name.
    const typed = name;
    setName("");
    const result = await useFlagStore.getState().create(typed, parentId);
    if ("problem" in result) {
      setName((now) => (now === "" ? typed : now));
      setProblem(result.problem);
      return;
    }
    // The form stays open (and focused) to add the next sibling; Esc or "+" closes it. The
    // name is not cleared again here: that would wipe what was typed while it saved.
    setProblem(null);
  }

  return (
    <form
      className="mt-2"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={id} className="sr-only">
          {parentId ? t("flags.newChild") : t("flags.newFlag")}
        </label>
        <input
          id={id}
          className={`${INPUT} min-w-0 flex-1`}
          placeholder={parentId ? t("flags.newChild") : t("flags.newFlag")}
          value={name}
          autoFocus={autoFocus}
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? errorId : undefined}
          onChange={(e) => {
            setName(e.target.value);
            setProblem(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") onDone?.();
          }}
          data-testid={`flags-new-${groupKey}`}
        />
        <button type="submit" className={BUTTON} disabled={name.trim() === ""}>
          {t("flags.add")}
        </button>
      </div>
      {problem && (
        <p id={errorId} role="alert" className="mt-1 text-xs text-red-700 dark:text-red-400">
          {problemText(t, problem)}
        </p>
      )}
    </form>
  );
}
