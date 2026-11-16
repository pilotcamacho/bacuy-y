import { canonicalDateBody, isoToDay } from "./dates";
import {
  frequencyKeyword,
  normalizeFlagName,
  systemFlagWord,
  typeKeyword,
  type ActivityType,
  type Frequency,
  type MarkLocale,
} from "./keywords";
import { buildFlagIndex, parseLine, type FlagLite, type MarkSpan, type ParseContext } from "./parse";

/**
 * Writing marks back into the text. The panel never sets a text-owned field directly: it
 * rewrites the mark, and the field is re-derived by parsing (docs/05-line-mapping.md §1).
 * Every function returns a new rawInput; user text outside the touched marks is kept as is.
 */

/** Removes the given spans and the one space that separated each from its neighbour. */
function removeSpans(raw: string, spans: { start: number; end: number }[]): string {
  let out = raw;
  for (const span of [...spans].sort((a, b) => b.start - a.start)) {
    let { start, end } = span;
    if (out[end] === " ") end++;
    else if (start > 0 && out[start - 1] === " ") start--;
    out = out.slice(0, start) + out.slice(end);
  }
  return out;
}

function append(raw: string, mark: string): string {
  if (raw.length === 0) return mark;
  return /\s$/.test(raw) ? raw + mark : `${raw} ${mark}`;
}

function replaceSpan(raw: string, span: { start: number; end: number }, text: string): string {
  return raw.slice(0, span.start) + text + raw.slice(span.end);
}

const recognized = (m: MarkSpan) => m.status !== "unknown" && m.status !== "ambiguous";

// ─── !type ────────────────────────────────────────────────────────────────────────

/**
 * Sets the type. Removes every recognized `!type` mark, then writes one only if the line
 * would not already have that type by default (ACTION, or REPETITIVE_ACTION with ~frequency).
 */
export function setTypeMark(raw: string, type: ActivityType, ctx: ParseContext, locale: MarkLocale): string {
  const parsed = parseLine(raw, ctx);
  const without = removeSpans(raw, parsed.marks.filter((m) => m.kind === "type" && recognized(m)));
  if (parseLine(without, ctx).activityType === type) return without;
  return append(without, `!${typeKeyword(type, locale)}`);
}

// ─── ~frequency ───────────────────────────────────────────────────────────────────

/** Sets (or with null / CUSTOM removes) the `~frequency` mark. */
export function setFrequencyMark(
  raw: string,
  frequency: Frequency | null,
  ctx: ParseContext,
  locale: MarkLocale,
): string {
  const marks = parseLine(raw, ctx).marks.filter((m) => m.kind === "frequency" && recognized(m));
  const without = removeSpans(raw, marks);
  if (!frequency || frequency === "CUSTOM") return without;
  return append(without, `~${frequencyKeyword(frequency, locale)}`);
}

// ─── @date ────────────────────────────────────────────────────────────────────────

/** Sets (or with null removes) the `@date` mark, always in canonical form. */
export function setDateMark(raw: string, iso: string | null, ctx: ParseContext): string {
  const marks = parseLine(raw, ctx).marks.filter((m) => m.kind === "date" && recognized(m));
  if (!iso) return removeSpans(raw, marks);
  const text = `@${canonicalDateBody(isoToDay(iso))}`;
  const winner = marks.at(-1);
  if (!winner) return append(raw, text);
  // Replace the winning mark in place, drop the others.
  const replaced = replaceSpan(raw, winner, text);
  const shift = text.length - (winner.end - winner.start);
  return removeSpans(
    replaced,
    marks.slice(0, -1).map((m) => (m.start > winner.start ? { start: m.start + shift, end: m.end + shift } : m)),
  );
}

/**
 * On commit (the cursor leaves the line, Enter, page hidden): rewrites every valid date mark
 * that is not canonical (`@viernes`, `@hoy`, `@31/12`) to `@yyyy-mm-dd`, so the line means the
 * same day tomorrow and on every device. Invalid or unknown `@…` text is left alone.
 */
export function commitLine(raw: string, ctx: ParseContext): string {
  const marks = parseLine(raw, ctx).marks.filter((m) => m.kind === "date" && m.date && !m.date.canonical);
  let out = raw;
  for (const m of [...marks].sort((a, b) => b.start - a.start)) {
    out = replaceSpan(out, m, `@${canonicalDateBody(m.date!)}`);
  }
  return out;
}

// ─── #flag ────────────────────────────────────────────────────────────────────────

/**
 * The mark text for a flag: the shortest form that resolves to exactly this flag (leaf name,
 * else the path). System flags use the word of the UI locale (`#salud` / `#health`).
 */
export function flagMarkText(flag: FlagLite, flags: FlagLite[], locale: MarkLocale): string {
  const byId = new Map(flags.map((f) => [f.id, f]));
  // Written form keeps accents and case ("#diversión", "#Mi-proyecto"); lookups normalize.
  const word = (f: FlagLite) =>
    ((f.isSystemDefault && systemFlagWord(normalizeFlagName(f.name), locale)) || f.name)
      .trim()
      .replace(/\s+/g, "-");

  const index = buildFlagIndex(flags);
  const leaf = word(flag);
  if (index.byLeaf.get(normalizeFlagName(leaf))?.size === 1) return `#${leaf}`;

  const parts: string[] = [];
  const seen = new Set<string>();
  for (let f: FlagLite | undefined = flag; f && !seen.has(f.id); f = f.parentId ? byId.get(f.parentId) : undefined) {
    seen.add(f.id);
    parts.unshift(word(f));
  }
  return `#${parts.join("/")}`;
}

export function addFlagMark(raw: string, flag: FlagLite, ctx: ParseContext, locale: MarkLocale): string {
  if (parseLine(raw, ctx).flagIds.includes(flag.id)) return raw;
  return append(raw, flagMarkText(flag, ctx.flags, locale));
}

export function removeFlagMark(raw: string, flagId: string, ctx: ParseContext): string {
  const marks = parseLine(raw, ctx).marks.filter((m) => m.kind === "flag" && m.flagId === flagId);
  return removeSpans(raw, marks);
}
