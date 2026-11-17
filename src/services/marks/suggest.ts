import { parseDateBody, type CalendarDay } from "./dates";
import {
  FREQUENCY_KEYWORDS,
  SYSTEM_FLAG_ALIASES,
  TYPE_KEYWORDS,
  normalize,
  normalizeFlagName,
  type ActivityType,
  type Frequency,
  type MarkLocale,
} from "./keywords";
import type { FlagLite, MarkKind } from "./parse";
import { flagMarkText } from "./serialize";

/**
 * Autocomplete while typing a line (docs/05-line-mapping.md §3, "Autocomplete"). Pure.
 * - Marks: the word at the caret starts with `#`, `!`, `@` or `~` → matching flags, types,
 *   dates or frequencies. Both languages match; the UI language's word comes first and is the
 *   one written, unless only the other language's word matches what was typed.
 * - Rows: text typed in a line → earlier lines (page and completed) that start the same way.
 */

export const SUGGEST_LIMIT = 8;
export const ROW_SUGGEST_LIMIT = 5;
/** Row suggestions start after this many typed characters. */
export const ROW_SUGGEST_MIN = 2;

const SIGILS: Record<string, MarkKind> = { "#": "flag", "!": "type", "@": "date", "~": "frequency" };

export interface MarkQuery {
  kind: MarkKind;
  /** Where the mark starts (its sigil) and ends (end of the word, past the caret too). */
  start: number;
  end: number;
  /** What was typed after the sigil, up to the caret. */
  query: string;
}

/** The mark being typed at the caret, if any. */
export function markQueryAt(raw: string, caret: number): MarkQuery | null {
  let start = caret;
  while (start > 0 && !/\s/.test(raw[start - 1]!)) start--;
  const kind = SIGILS[raw[start] ?? ""];
  if (!kind || caret === start) return null;
  let end = caret;
  while (end < raw.length && !/\s/.test(raw[end]!)) end++;
  return { kind, start, end, query: raw.slice(start + 1, caret) };
}

export type MarkSuggestion =
  | { kind: "flag"; insert: string; flagId: string }
  | { kind: "type"; insert: string; type: ActivityType }
  | { kind: "date"; insert: string; day: CalendarDay }
  | { kind: "frequency"; insert: string; frequency: Frequency };

/** 0 = a word starts with the query, 1 = contains it, −1 = no match. */
function score(words: string[], query: string): number {
  if (query === "") return 0;
  let best = -1;
  for (const w of words) {
    if (w.startsWith(query)) return 0;
    if (w.includes(query)) best = 1;
  }
  return best;
}

interface Candidate<S> {
  suggestion: S;
  rank: number;
  order: number;
  /** What was typed is already this one, in full (in either language). */
  exact: boolean;
}

function pick<S>(candidates: Candidate<S>[], limit: number): S[] {
  return candidates
    .filter((c) => c.rank >= 0 && !c.exact)
    .sort((a, b) => a.rank - b.rank || a.order - b.order)
    .slice(0, limit)
    .map((c) => c.suggestion);
}

/** A keyword in the UI language, or the other language's word when only that one matches. */
function keywordFor(byLocale: Record<MarkLocale, string[]>, locale: MarkLocale, query: string): { word: string; rank: number } {
  const other: MarkLocale = locale === "es" ? "en" : "es";
  // A word typed in full in the other language stays in that language ("!habit").
  const exact = byLocale[other].find((w) => normalize(w) === query);
  if (exact) return { word: exact, rank: 0 };
  const own = score(byLocale[locale].map(normalize), query);
  if (own === 0) return { word: byLocale[locale][0]!, rank: 0 };
  const foreign = byLocale[other].map(normalize);
  const prefixed = byLocale[other].find((_, i) => foreign[i]!.startsWith(query));
  if (prefixed) return { word: prefixed, rank: 0 };
  if (own === 1) return { word: byLocale[locale][0]!, rank: 1 };
  const contains = byLocale[other].find((_, i) => foreign[i]!.includes(query));
  return contains ? { word: contains, rank: 1 } : { word: byLocale[locale][0]!, rank: -1 };
}

const DATE_WORDS: { es: string; en: string; offset?: number; weekday?: number }[] = [
  { es: "hoy", en: "today", offset: 0 },
  { es: "mañana", en: "tomorrow", offset: 1 },
  { es: "lunes", en: "monday", weekday: 1 },
  { es: "martes", en: "tuesday", weekday: 2 },
  { es: "miércoles", en: "wednesday", weekday: 3 },
  { es: "jueves", en: "thursday", weekday: 4 },
  { es: "viernes", en: "friday", weekday: 5 },
  { es: "sábado", en: "saturday", weekday: 6 },
  { es: "domingo", en: "sunday", weekday: 0 },
];

export interface SuggestContext {
  flags: FlagLite[];
  today: Date;
  locale: MarkLocale;
}

export interface MarkSuggestions {
  items: MarkSuggestion[];
  /**
   * The typed mark is already complete ("#salud", "~daily"): it is left as typed and nothing
   * is preselected, so Enter still makes a new line. Longer ones ("#salud-mental") stay listed.
   */
  complete: boolean;
}

const allWords = (byLocale: Record<MarkLocale, string[]>) => [...byLocale.es, ...byLocale.en].map(normalize);

export function suggestMarks(q: MarkQuery, ctx: SuggestContext, limit = SUGGEST_LIMIT): MarkSuggestions {
  const query = normalize(q.query);
  let candidates: Candidate<MarkSuggestion>[];

  if (q.kind === "flag") {
    const byId = new Map(ctx.flags.map((f) => [f.id, f]));
    const words = (f: FlagLite): string[] => {
      const own = normalizeFlagName(f.name);
      return f.isSystemDefault ? [own, ...(SYSTEM_FLAG_ALIASES[own] ?? []).map(normalizeFlagName)] : [own];
    };
    const depth = (f: FlagLite) => {
      let d = 0;
      for (let p = f.parentId ? byId.get(f.parentId) : undefined; p && d < 10; p = p.parentId ? byId.get(p.parentId) : undefined) d++;
      return d;
    };
    // "ingresos/pro": the part after the last "/" is matched against the leaf.
    const leafQuery = query.includes("/") ? query.slice(query.lastIndexOf("/") + 1) : query;
    const leaf = normalizeFlagName(leafQuery);
    candidates = ctx.flags.map((flag, i) => ({
      suggestion: { kind: "flag" as const, insert: flagMarkText(flag, ctx.flags, ctx.locale), flagId: flag.id },
      rank: score(words(flag), leaf),
      order: depth(flag) * 1000 + i,
      exact: leaf.length > 0 && words(flag).includes(leaf),
    }));
  } else if (q.kind === "type") {
    candidates = (Object.keys(TYPE_KEYWORDS) as ActivityType[]).map((type, i) => {
      const { word, rank } = keywordFor(TYPE_KEYWORDS[type], ctx.locale, query);
      const exact = allWords(TYPE_KEYWORDS[type]).includes(query);
      return { suggestion: { kind: "type" as const, insert: `!${word}`, type }, rank, order: i, exact };
    });
  } else if (q.kind === "frequency") {
    candidates = (Object.keys(FREQUENCY_KEYWORDS) as Exclude<Frequency, "CUSTOM">[]).map((frequency, i) => {
      const { word, rank } = keywordFor(FREQUENCY_KEYWORDS[frequency], ctx.locale, query);
      const exact = allWords(FREQUENCY_KEYWORDS[frequency]).includes(query);
      return { suggestion: { kind: "frequency" as const, insert: `~${word}`, frequency }, rank, order: i, exact };
    });
  } else {
    candidates = DATE_WORDS.map((d, i) => {
      const { word, rank } = keywordFor({ es: [d.es], en: [d.en] }, ctx.locale, query);
      const day = parseDateBody(word, ctx.today)!;
      const exact = allWords({ es: [d.es], en: [d.en] }).includes(query);
      return { suggestion: { kind: "date" as const, insert: `@${word}`, day }, rank, order: i, exact };
    });
  }
  return { items: pick(candidates, limit), complete: candidates.some((c) => c.exact) };
}

/** The line after accepting a mark: the mark replaces the word, followed by one space. */
export function applyMark(raw: string, q: MarkQuery, insert: string): { raw: string; caret: number } {
  const after = raw.slice(q.end);
  const spaced = after.startsWith(" ") ? after : ` ${after}`;
  const next = raw.slice(0, q.start) + insert + spaced;
  return { raw: next, caret: q.start + insert.length + 1 };
}

// ─── Rows ─────────────────────────────────────────────────────────────────────────

export interface RowCandidate {
  id: string;
  rawInput: string;
  /** Newer first: completedAt for completed rows, editedAt otherwise. */
  at: string;
  /** A completed line (from the Completed page), not one on the page. */
  completed?: boolean;
}

/**
 * Earlier lines that start like the typed text (accents and case ignored), newest first, one
 * per distinct text. A line equal to what was typed is left out (nothing to complete).
 */
export function suggestRows(typed: string, candidates: RowCandidate[], excludeId: string | null, limit = ROW_SUGGEST_LIMIT): RowCandidate[] {
  const query = normalize(typed.trim()).replace(/\s+/g, " ");
  if (query.length < ROW_SUGGEST_MIN) return [];
  const seen = new Set<string>();
  const prefix: RowCandidate[] = [];
  const words: RowCandidate[] = [];
  const sorted = candidates.slice().sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  for (const c of sorted) {
    if (c.id === excludeId) continue;
    const text = normalize(c.rawInput.trim()).replace(/\s+/g, " ");
    if (text.length === 0 || text === query || seen.has(text)) continue;
    if (text.startsWith(query)) {
      seen.add(text);
      prefix.push(c);
    } else if (text.split(" ").some((_, i, all) => all.slice(i).join(" ").startsWith(query))) {
      seen.add(text);
      words.push(c);
    }
    if (prefix.length >= limit) break;
  }
  return [...prefix, ...words].slice(0, limit);
}
