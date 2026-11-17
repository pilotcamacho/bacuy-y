import { useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { pageLines } from "@/services/editor/pageLines";
import {
  applyMark,
  markQueryAt,
  suggestMarks,
  suggestRows,
  type FlagLite,
  type MarkLocale,
  type MarkSuggestion,
  type RowCandidate,
} from "@/services/marks";
import { usePageStore } from "@/stores/pageStore";
import { useRowHistory } from "@/stores/rowHistory";

/**
 * Autocomplete for one line (docs/05-line-mapping.md §3, "Autocomplete"). Suggestions show
 * only after typing in the line (not on a click into it), and close on Esc or blur.
 * - Marks (`#` `!` `@` `~`): the first suggestion is selected; Enter or Tab accepts it.
 * - Rows (page + completed lines that start like the text, caret at the end): nothing is
 *   selected until ↓, so Enter still makes a new line; Tab accepts the first.
 * Accepting a row copies its text (marks included) into this line.
 */

export type Suggestion =
  | { source: "mark"; mark: MarkSuggestion }
  | { source: "row"; row: RowCandidate };

interface Options {
  id: string;
  raw: string;
  flags: FlagLite[];
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onType(id: string, raw: string): void;
}

export function useLineSuggestions({ id, raw, flags, inputRef, onType }: Options) {
  const { i18n } = useTranslation();
  const locale: MarkLocale = i18n.resolvedLanguage?.startsWith("en") ? "en" : "es";
  const listId = useId();
  const [focused, setFocused] = useState(false);
  const [typed, setTyped] = useState(false);
  const [caret, setCaret] = useState(raw.length);
  const [dismissedAt, setDismissedAt] = useState<string | null>(null);
  const [today, setToday] = useState(() => new Date());
  const [selection, setSelection] = useState<{ key: string; index: number }>({ key: "", index: 0 });
  const history = useRowHistory((s) => s.completed);
  const pendingCaret = useRef<number | null>(null);

  const open = focused && typed && dismissedAt !== raw;
  const query = useMemo(() => (open ? markQueryAt(raw, caret) : null), [open, raw, caret]);

  const marks = useMemo(() => (query ? suggestMarks(query, { flags, today, locale }) : null), [query, flags, today, locale]);
  const items: Suggestion[] = useMemo(() => {
    if (!open) return [];
    if (marks) return marks.items.map((mark) => ({ source: "mark", mark }));
    if (caret !== raw.length) return [];
    const page: RowCandidate[] = pageLines(usePageStore.getState().activities).map((l) => {
      const row = usePageStore.getState().activities[l.id];
      return { id: l.id, rawInput: l.rawInput, at: row?.editedAt ?? "" };
    });
    const pageIds = new Set(page.map((p) => p.id));
    const done = history.filter((h) => !pageIds.has(h.id)).map((h) => ({ ...h, completed: true }));
    return suggestRows(raw, [...page, ...done], id).map((row) => ({ source: "row", row }));
  }, [open, marks, caret, raw, history, id]);

  // A mark being completed: the first is preselected (Enter/Tab accept it). Rows, or a mark
  // already typed in full: nothing is, so Enter keeps making a new line.
  const preselect = items[0]?.source === "mark" && !marks?.complete;
  const key = items.map((s) => (s.source === "mark" ? s.mark.insert : s.row.id)).join("|");
  const fallback = preselect ? 0 : -1;
  const active = items.length === 0 ? -1 : selection.key === key ? selection.index : fallback;

  // After accepting, put the caret where the accepted text ends (once React has the new value).
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (pendingCaret.current === null || !el) return;
    el.setSelectionRange(pendingCaret.current, pendingCaret.current);
    pendingCaret.current = null;
  }, [raw, inputRef]);

  function accept(index: number) {
    const item = items[index];
    if (!item) return;
    let next: string;
    let at: number;
    if (item.source === "mark" && query) {
      ({ raw: next, caret: at } = applyMark(raw, query, item.mark.insert));
    } else if (item.source === "row") {
      next = item.row.rawInput;
      at = next.length;
    } else return;
    pendingCaret.current = at;
    setCaret(at);
    setDismissedAt(next); // closed until the user types again
    onType(id, next);
  }

  /** Returns true when the key was used by the suggestions (the line must not act on it). */
  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): boolean {
    if (items.length === 0 || e.altKey || e.ctrlKey || e.metaKey) return false;
    const select = (index: number) => setSelection({ key, index });
    if (e.key === "ArrowDown") {
      e.preventDefault();
      select(active + 1 >= items.length ? (preselect ? 0 : -1) : active + 1);
      return true;
    }
    if (e.key === "ArrowUp") {
      if (!preselect && active === -1) return false; // nothing selected: ↑ goes to the line above
      e.preventDefault();
      select(active <= 0 ? (preselect ? items.length - 1 : -1) : active - 1);
      return true;
    }
    if (e.key === "Enter" && !e.shiftKey && active >= 0) {
      e.preventDefault();
      accept(active);
      return true;
    }
    if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      accept(active >= 0 ? active : 0);
      return true;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setDismissedAt(raw);
      return true;
    }
    return false;
  }

  return {
    items,
    active,
    listId,
    optionId: (index: number) => `${listId}-${index}`,
    accept,
    onKeyDown,
    onFocus() {
      setFocused(true);
      setTyped(false);
      setToday(new Date());
      useRowHistory.getState().ensure(); // completed lines, ready by the time a few letters are typed
    },
    onBlur() {
      setFocused(false);
    },
    onChange(el: HTMLTextAreaElement) {
      setTyped(true);
      setCaret(el.selectionStart);
      useRowHistory.getState().ensure();
    },
    onSelect(el: HTMLTextAreaElement) {
      setCaret(el.selectionStart);
    },
  };
}
