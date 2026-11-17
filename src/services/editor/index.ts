import { generateKeyBetween } from "fractional-indexing";
import { newId } from "@/lib/ids";

/**
 * Pure line operations of the page (docs/05-line-mapping.md §3). No DOM, no database:
 * each function takes the ordered lines and returns the new list plus what changed, so the
 * store can write exactly those rows. Unit-tested in tests/editor/editor.test.ts.
 */

export interface EditorLine {
  id: string;
  rawInput: string;
  position: string;
}

export interface Caret {
  id: string;
  offset: number;
}

export interface EditResult {
  lines: EditorLine[];
  /** Rows to write: new ones and ones whose text or position changed. */
  changed: EditorLine[];
  /** Ids in `changed` that are new rows. */
  created: string[];
  /** Ids removed from the page (to soft-delete). */
  deleted: string[];
  focus: Caret | null;
}

type IdFactory = () => string;

/** Page order: position, then id (equal positions can happen when two devices insert at once). */
export function compareLines(a: { position: string; id: string }, b: { position: string; id: string }): number {
  if (a.position !== b.position) return a.position < b.position ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * A position for a new row placed right after `lines[index]` (index −1 = at the top).
 * Equal neighbour positions are skipped, because no key fits strictly between two equal keys.
 */
export function positionAfter(lines: EditorLine[], index: number): string {
  const before = index >= 0 ? lines[index]?.position ?? null : null;
  let after: string | null = null;
  for (let i = index + 1; i < lines.length; i++) {
    const p = lines[i]!.position;
    if (before === null || p > before) {
      after = p;
      break;
    }
  }
  return generateKeyBetween(before, after);
}

function result(
  lines: EditorLine[],
  changed: EditorLine[],
  focus: Caret | null,
  created: string[] = [],
  deleted: string[] = [],
): EditResult {
  return { lines, changed, created, deleted, focus };
}

function replaceAt(lines: EditorLine[], index: number, line: EditorLine): EditorLine[] {
  const next = lines.slice();
  next[index] = line;
  return next;
}

/**
 * Enter: split at the caret. The current row keeps the text before; a new row gets the rest.
 * At the very start of a non-empty line, an empty row is inserted above instead: the line
 * keeps its row (type, panel fields, history) and the caret, as in a text editor.
 */
export function splitLine(lines: EditorLine[], index: number, caret: number, ids: IdFactory = newId): EditResult {
  const line = lines[index];
  if (!line) return result(lines, [], null);
  if (caret === 0 && line.rawInput.length > 0) {
    const above: EditorLine = { id: ids(), rawInput: "", position: positionAfter(lines, index - 1) };
    const next = lines.slice();
    next.splice(index, 0, above);
    return result(next, [above], { id: line.id, offset: 0 }, [above.id]);
  }
  const before = line.rawInput.slice(0, caret);
  const after = line.rawInput.slice(caret);
  const created: EditorLine = { id: ids(), rawInput: after, position: positionAfter(lines, index) };
  const current = { ...line, rawInput: before };
  const next = replaceAt(lines, index, current);
  next.splice(index + 1, 0, created);
  const changed = before === line.rawInput ? [created] : [current, created];
  return result(next, changed, { id: created.id, offset: 0 }, [created.id]);
}

/** Inserts an empty row after `index` (−1 = top) and focuses it. */
export function insertEmpty(lines: EditorLine[], index: number, ids: IdFactory = newId): EditResult {
  const created: EditorLine = { id: ids(), rawInput: "", position: positionAfter(lines, index) };
  const next = lines.slice();
  next.splice(index + 1, 0, created);
  return result(next, [created], { id: created.id, offset: 0 }, [created.id]);
}

/**
 * Backspace at the start of a line: merge it into the line above. The line above keeps its id
 * and fields; a single space joins two non-empty texts. On an empty line this is a delete.
 */
export function mergeUp(lines: EditorLine[], index: number): EditResult {
  const line = lines[index];
  const prev = lines[index - 1];
  if (!line || !prev) return result(lines, [], null);
  // Into an empty line: that empty row goes, and this line keeps its row (type, panel fields,
  // history), the mirror of Enter at the start of a line.
  if (prev.rawInput.length === 0 && line.rawInput.length > 0) {
    const next = lines.slice();
    next.splice(index - 1, 1);
    return result(next, [], { id: line.id, offset: 0 }, [], [prev.id]);
  }
  // One space between two words; none when either side already has it, so Enter followed by
  // Backspace gives back exactly the original line.
  const joiner =
    prev.rawInput.length > 0 && line.rawInput.length > 0 && !/\s$/.test(prev.rawInput) && !/^\s/.test(line.rawInput) ? " " : "";
  const merged = { ...prev, rawInput: prev.rawInput + joiner + line.rawInput };
  const next = replaceAt(lines, index - 1, merged);
  next.splice(index, 1);
  const changed = merged.rawInput === prev.rawInput ? [] : [merged];
  return result(next, changed, { id: prev.id, offset: prev.rawInput.length + joiner.length }, [], [line.id]);
}

/** Delete at the end of a line: merge the line below into this one. */
export function mergeDown(lines: EditorLine[], index: number): EditResult {
  return mergeUp(lines, index + 1);
}

/**
 * Backspace on an empty line: remove it and focus the end of the line above (or the start of
 * the line below when it is the first). The last remaining line is never removed.
 */
export function deleteEmpty(lines: EditorLine[], index: number): EditResult {
  const line = lines[index];
  if (!line || lines.length <= 1) return result(lines, [], line ? { id: line.id, offset: 0 } : null);
  const next = lines.slice();
  next.splice(index, 1);
  const prev = lines[index - 1];
  const focus = prev ? { id: prev.id, offset: prev.rawInput.length } : { id: lines[index + 1]!.id, offset: 0 };
  return result(next, [], focus, [], [line.id]);
}

/**
 * Paste. The first pasted line goes into the current line at the selection; each following
 * line becomes a new row below, in order; the text that was after the selection ends up at the
 * end of the last pasted line. Empty pasted lines are skipped. A line never holds a newline.
 */
export function pasteText(
  lines: EditorLine[],
  index: number,
  selStart: number,
  selEnd: number,
  text: string,
  ids: IdFactory = newId,
): EditResult {
  const line = lines[index];
  if (!line) return result(lines, [], null);
  const parts = text.split(/\r\n|\r|\n/);
  const head = line.rawInput.slice(0, selStart);
  const tail = line.rawInput.slice(selEnd);

  if (parts.length === 1) {
    const current = { ...line, rawInput: head + parts[0] + tail };
    return result(replaceAt(lines, index, current), [current], {
      id: line.id,
      offset: head.length + parts[0]!.length,
    });
  }

  const [first, ...rest] = parts;
  const extra = rest.filter((p) => p.trim().length > 0);
  const current = { ...line, rawInput: head + first };
  if (extra.length === 0) {
    const joined = { ...line, rawInput: head + first + tail };
    return result(replaceAt(lines, index, joined), [joined], { id: line.id, offset: (head + first).length });
  }

  const next = replaceAt(lines, index, current);
  const created: EditorLine[] = [];
  let at = index;
  extra.forEach((textPart, i) => {
    const isLast = i === extra.length - 1;
    const row = { id: ids(), rawInput: isLast ? textPart + tail : textPart, position: positionAfter(next, at) };
    next.splice(at + 1, 0, row);
    created.push(row);
    at++;
  });
  const last = created.at(-1)!;
  return result(
    next,
    [current, ...created],
    { id: last.id, offset: last.rawInput.length - tail.length },
    created.map((c) => c.id),
  );
}

/** Moves the line at `from` to index `to` (Alt+↑/↓, drag). Only the moved row changes. */
export function moveLine(lines: EditorLine[], from: number, to: number): EditResult {
  const line = lines[from];
  if (!line || from === to || to < 0 || to >= lines.length) return result(lines, [], null);
  const without = lines.slice();
  without.splice(from, 1);
  const moved = { ...line, position: positionAfter(without, to - 1) };
  without.splice(to, 0, moved);
  return result(without, [moved], null);
}

/** Replaces the text of one line (typing). */
export function setText(lines: EditorLine[], index: number, rawInput: string): EditResult {
  const line = lines[index];
  if (!line || line.rawInput === rawInput) return result(lines, [], null);
  const current = { ...line, rawInput: rawInput.replace(/\r\n|\r|\n/g, " ") };
  return result(replaceAt(lines, index, current), [current], null);
}
