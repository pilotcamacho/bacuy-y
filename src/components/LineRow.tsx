import { memo, useEffect, useMemo, useRef, type ClipboardEvent, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useLineSuggestions } from "@/hooks/useLineSuggestions";
import type { ActivityRow } from "@/lib/db/types";
import type { EditorLine } from "@/services/editor";
import { isRemovedFromTitle, parseLine, type FlagLite, type MarkSpan } from "@/services/marks";
import type { FocusRequest } from "@/stores/pageStore";
import { SuggestionList } from "./SuggestionList";
import { TickCell } from "./TickCell";

/**
 * One line of the page: a drag handle and the text. The text is a transparent auto-growing
 * <textarea> over a mirror <div> that draws the same text with the marks colored
 * (docs/05-line-mapping.md §3, "Rendering"). Both must share font, padding and wrapping.
 */

export interface LineHandlers {
  onType(id: string, raw: string): void;
  onCommit(id: string): void;
  onEnter(id: string, selStart: number, selEnd: number): void;
  onBackspaceAtStart(id: string): Promise<boolean>;
  onDeleteAtEnd(id: string): Promise<boolean>;
  onPaste(id: string, selStart: number, selEnd: number, text: string): void;
  onMove(id: string, delta: number): void;
  onFocusNeighbour(id: string, direction: -1 | 1, caret: number): void;
  onTick(id: string): void;
  onOpenPanel(id: string): void;
}

interface Props extends LineHandlers {
  line: EditorLine;
  /** The stored row (undefined for the ghost line of an empty page). */
  row: ActivityRow | undefined;
  index: number;
  flags: FlagLite[];
  focus: FocusRequest | null;
  draggable: boolean;
  placeholder?: string;
}

const TEXT_CLASS = "block w-full whitespace-pre-wrap break-words px-1 py-1 text-base leading-7 font-[inherit]";

const MARK_CLASS: Record<string, string> = {
  ok: "rounded-sm bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300",
  warn: "rounded-sm bg-amber-50 text-amber-800 underline decoration-amber-500 decoration-dotted underline-offset-4 dark:bg-amber-950 dark:text-amber-300",
  unknown: "underline decoration-amber-500 decoration-dotted underline-offset-4",
};

function markClass(m: MarkSpan): string {
  if (m.status === "ok") return MARK_CLASS.ok!;
  if (isRemovedFromTitle(m)) return MARK_CLASS.warn!;
  return MARK_CLASS.unknown!;
}

function Mirror({ text, flags, className = "" }: { text: string; flags: FlagLite[]; className?: string }) {
  const parts = useMemo(() => {
    const marks = parseLine(text, { flags, today: new Date() }).marks;
    const out: { text: string; className?: string }[] = [];
    let at = 0;
    for (const m of marks) {
      if (m.start > at) out.push({ text: text.slice(at, m.start) });
      out.push({ text: text.slice(m.start, m.end), className: markClass(m) });
      at = m.end;
    }
    if (at < text.length) out.push({ text: text.slice(at) });
    return out;
  }, [text, flags]);

  return (
    <div aria-hidden="true" className={`${TEXT_CLASS} pointer-events-none ${className}`}>
      {parts.map((p, i) => (
        <span key={i} className={p.className}>
          {p.text}
        </span>
      ))}
      {/* keeps the height of an empty line and of a trailing space */}
      {"​"}
    </div>
  );
}

function isSingleVisualLine(el: HTMLTextAreaElement): boolean {
  const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 0;
  return lineHeight === 0 || el.scrollHeight < lineHeight * 1.8;
}

export const LineRow = memo(function LineRow(props: Props) {
  const { line, row, index, flags, focus, draggable, placeholder } = props;
  const status = row?.status ?? "DRAFT";
  const textStyle =
    status === "COMPLETED"
      ? "text-neutral-400 line-through decoration-neutral-400 dark:text-neutral-500"
      : status === "INACTIVE"
        ? "italic text-neutral-500 dark:text-neutral-400"
        : "";
  const { t } = useTranslation();
  const ref = useRef<HTMLTextAreaElement>(null);
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: line.id,
    disabled: !draggable,
  });

  const suggestions = useLineSuggestions({ id: line.id, raw: line.rawInput, flags, inputRef: ref, onType: props.onType });
  const listOpen = suggestions.items.length > 0;

  useEffect(() => {
    if (!focus || focus.id !== line.id || !ref.current) return;
    const el = ref.current;
    el.focus();
    const offset = Math.min(focus.offset, el.value.length);
    el.setSelectionRange(offset, offset);
  }, [focus, line.id]);

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.nativeEvent.isComposing) return;
    if (suggestions.onKeyDown(e)) return;
    const el = e.currentTarget;
    const { selectionStart: s, selectionEnd: end, value } = el;
    const plain = !e.altKey && !e.ctrlKey && !e.metaKey;

    const mod = (e.ctrlKey || e.metaKey) && !e.altKey;
    if (e.key === "Enter") {
      e.preventDefault(); // a line never holds a newline
      if (mod && row) props.onTick(line.id);
      else if (plain && !e.shiftKey) props.onEnter(line.id, s, end);
      return;
    }
    if (e.key === "Backspace" && plain && s === 0 && end === 0) {
      e.preventDefault();
      void props.onBackspaceAtStart(line.id);
      return;
    }
    if (e.key === "Delete" && plain && s === value.length && end === value.length) {
      e.preventDefault();
      void props.onDeleteAtEnd(line.id);
      return;
    }
    if ((e.key === "ArrowUp" || e.key === "ArrowDown") && e.altKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      props.onMove(line.id, e.key === "ArrowUp" ? -1 : 1);
      return;
    }
    if ((e.key === "ArrowUp" || e.key === "ArrowDown") && plain && !e.shiftKey) {
      const up = e.key === "ArrowUp";
      const atEdge = up ? s === 0 : s === value.length;
      if (isSingleVisualLine(el) || atEdge) {
        e.preventDefault();
        props.onFocusNeighbour(line.id, up ? -1 : 1, s);
      }
    }
  }

  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const text = e.clipboardData.getData("text/plain");
    if (!/[\r\n]/.test(text)) return; // single-line paste: let the browser do it
    e.preventDefault();
    const el = e.currentTarget;
    props.onPaste(line.id, el.selectionStart, el.selectionEnd, text);
  }

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      // Ctrl/Cmd+. from anywhere in the line (text, tick, handle): open the panel.
      onKeyDown={(e) => {
        if (e.key === "." && (e.ctrlKey || e.metaKey) && !e.altKey && row) {
          e.preventDefault();
          props.onOpenPanel(line.id);
        }
      }}
      className={`group flex items-start gap-1 rounded ${isDragging ? "relative z-10 bg-white shadow-md dark:bg-neutral-900" : ""}`}
      data-testid={`line-row-${index}`}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={t("page.dragHandle", { n: index + 1 })}
        data-testid={`line-handle-${index}`}
        disabled={!draggable}
        className="mt-1 flex h-7 w-5 shrink-0 cursor-grab touch-none select-none items-center justify-center rounded text-neutral-300 opacity-0 outline-none hover:text-neutral-500 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-indigo-500 group-focus-within:opacity-100 group-hover:opacity-100 disabled:invisible dark:text-neutral-600 dark:hover:text-neutral-400 [@media(hover:none)]:opacity-60"
      >
        <svg viewBox="0 0 8 14" width="8" height="14" aria-hidden="true" fill="currentColor">
          <circle cx="2" cy="2" r="1.2" />
          <circle cx="6" cy="2" r="1.2" />
          <circle cx="2" cy="7" r="1.2" />
          <circle cx="6" cy="7" r="1.2" />
          <circle cx="2" cy="12" r="1.2" />
          <circle cx="6" cy="12" r="1.2" />
        </svg>
      </button>
      <TickCell
        row={row}
        index={index}
        onTick={() => {
          props.onTick(line.id);
          // Safari does not focus a clicked button: keep the focus in the line, so typing and
          // Ctrl+. go on working (a panel the tick opens takes the focus after it renders).
          ref.current?.focus();
        }}
      />
      {/* The focus background goes on the wrapper, behind the mirror: a background on the
          textarea itself would cover the mirror and hide the text being typed. */}
      <div className="relative min-w-0 flex-1 rounded focus-within:bg-neutral-50 dark:focus-within:bg-neutral-900">
        <Mirror text={line.rawInput} flags={flags} className={textStyle} />
        <textarea
          ref={ref}
          rows={1}
          value={line.rawInput}
          spellCheck
          placeholder={placeholder}
          aria-label={t("page.lineLabel", { n: index + 1 })}
          aria-autocomplete="list"
          aria-expanded={listOpen}
          aria-controls={listOpen ? suggestions.listId : undefined}
          aria-activedescendant={listOpen && suggestions.active >= 0 ? suggestions.optionId(suggestions.active) : undefined}
          onChange={(e) => {
            suggestions.onChange(e.target);
            props.onType(line.id, e.target.value);
          }}
          onSelect={(e) => suggestions.onSelect(e.currentTarget)}
          onFocus={suggestions.onFocus}
          onBlur={() => {
            suggestions.onBlur();
            props.onCommit(line.id);
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          className={`${TEXT_CLASS} absolute inset-0 h-full resize-none overflow-hidden rounded bg-transparent text-transparent caret-neutral-900 outline-none selection:bg-indigo-500/30 placeholder:text-neutral-400 dark:caret-neutral-100 dark:selection:bg-indigo-400/30`}
        />
        {listOpen && (
          <SuggestionList
            id={suggestions.listId}
            items={suggestions.items}
            active={suggestions.active}
            optionId={suggestions.optionId}
            flags={flags}
            onPick={suggestions.accept}
          />
        )}
      </div>
      <button
        type="button"
        onClick={() => row && props.onOpenPanel(line.id)}
        disabled={!row}
        aria-label={t("line.more", { n: index + 1 })}
        title={t("line.more", { n: index + 1 })}
        data-testid={`line-more-${index}`}
        className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded text-neutral-400 opacity-0 outline-none hover:bg-neutral-100 hover:text-neutral-700 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-indigo-500 group-focus-within:opacity-100 group-hover:opacity-100 disabled:invisible dark:hover:bg-neutral-800 dark:hover:text-neutral-200 [@media(hover:none)]:opacity-60"
      >
        <svg viewBox="0 0 16 4" width="16" height="4" aria-hidden="true" fill="currentColor">
          <circle cx="2" cy="2" r="1.5" />
          <circle cx="8" cy="2" r="1.5" />
          <circle cx="14" cy="2" r="1.5" />
        </svg>
      </button>
    </div>
  );
});
