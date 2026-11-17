import { addFlagMark, parseLine, type FlagLite, type MarkLocale, type ParseContext } from "@/services/marks";
import type { EditorLine } from "./index";

/**
 * Filtering the page by flag (docs/05-line-mapping.md §6). Pure.
 * - The filter is a list of flag ids, plus NO_FLAG for "lines without a flag".
 * - A line matches when any of its `#flag` marks is a selected flag or a descendant of one
 *   (a parent includes its children), or it has no flag and NO_FLAG is selected.
 * - Marks are read from the text, so a line matches the moment its mark is typed.
 */

export const NO_FLAG = "__none__";

/** The selected flags and all their descendants (deleted / unknown ids are ignored). */
export function allowedFlagIds(filter: readonly string[], flags: readonly FlagLite[]): Set<string> {
  const children = new Map<string, string[]>();
  for (const f of flags) {
    if (!f.parentId) continue;
    const list = children.get(f.parentId);
    if (list) list.push(f.id);
    else children.set(f.parentId, [f.id]);
  }
  const known = new Set(flags.map((f) => f.id));
  const out = new Set<string>();
  const stack = filter.filter((id) => known.has(id));
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (out.has(id)) continue;
    out.add(id);
    stack.push(...(children.get(id) ?? []));
  }
  return out;
}

/** The filter's ids that still mean something (existing flags, and NO_FLAG). */
export function activeFilter(filter: readonly string[], flags: readonly FlagLite[]): string[] {
  const known = new Set(flags.map((f) => f.id));
  return filter.filter((id) => id === NO_FLAG || known.has(id));
}

export function lineMatches(rawInput: string, filter: readonly string[], ctx: ParseContext, allowed = allowedFlagIds(filter, ctx.flags)): boolean {
  const ids = parseLine(rawInput, ctx).flagIds;
  if (ids.length === 0) return filter.includes(NO_FLAG);
  return ids.some((id) => allowed.has(id));
}

/** The page's lines that pass the filter (all of them when it is empty). */
export function filterLines(lines: EditorLine[], filter: readonly string[], ctx: ParseContext): EditorLine[] {
  const active = activeFilter(filter, ctx.flags);
  if (active.length === 0) return lines;
  const allowed = allowedFlagIds(active, ctx.flags);
  return lines.filter((line) => lineMatches(line.rawInput, active, ctx, allowed));
}

/**
 * A line created while the page is filtered gets the filter's first flag, so it does not
 * vanish as soon as it is typed. An empty line gets " #flag" (typing at its start then reads
 * "text #flag"). Lines that already match, or a filter of only "no flag", are left alone.
 */
export function withFilterFlag(rawInput: string, filter: readonly string[], ctx: ParseContext, locale: MarkLocale): string {
  const active = activeFilter(filter, ctx.flags);
  if (active.length === 0 || lineMatches(rawInput, active, ctx)) return rawInput;
  const flag = ctx.flags.find((f) => f.id === active.find((id) => id !== NO_FLAG));
  if (!flag) return rawInput;
  return rawInput.length === 0 ? ` ${addFlagMark("", flag, ctx, locale)}` : addFlagMark(rawInput, flag, ctx, locale);
}
