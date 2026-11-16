import { parseDateBody, dayToIso, type ParsedDate } from "./dates";
import {
  SYSTEM_FLAG_ALIASES,
  frequencyFromKeyword,
  normalizeFlagName,
  typeFromKeyword,
  type ActivityType,
  type Frequency,
} from "./keywords";

/**
 * Line text → the fields the text owns (docs/05-line-mapping.md §1–§2). Pure, no network.
 * The result also lists every mark span so the editor can highlight it.
 */

export type MarkKind = "flag" | "type" | "date" | "frequency";

export type MarkStatus =
  | "ok" // recognized and used
  | "unknown" // keyword / flag name not found
  | "ambiguous" // a flag leaf name shared by several flags: use the path
  | "duplicate" // a single-value mark overridden by a later one
  | "notApplicable"; // valid, but the line's type has no such field

export interface MarkSpan {
  kind: MarkKind;
  start: number; // index in rawInput (sigil included)
  end: number; // exclusive; trailing punctuation is not part of the mark
  body: string; // text after the sigil
  status: MarkStatus;
  flagId?: string;
  type?: ActivityType;
  frequency?: Frequency;
  date?: ParsedDate;
}

/** The minimal flag shape the parser needs. Deleted flags must not be passed in. */
export interface FlagLite {
  id: string;
  name: string;
  parentId?: string | null;
  isSystemDefault?: boolean | null;
}

export type DateField = "deadline" | "eventDate" | "expirationDate";

export interface ParsedLine {
  title: string;
  activityType: ActivityType;
  /** true when a `!type` mark set the type (false = default). */
  typeFromMark: boolean;
  flagIds: string[];
  frequency: Frequency | null;
  /** The `@date` value and the field it fills, or null. */
  date: { field: DateField; iso: string } | null;
  marks: MarkSpan[];
}

export interface ParseContext {
  flags: FlagLite[];
  today: Date;
}

const SIGILS: Record<string, MarkKind> = { "#": "flag", "!": "type", "@": "date", "~": "frequency" };
const TRAILING = /[.,;:]+$/;

export const DATE_FIELD_BY_TYPE: Partial<Record<ActivityType, DateField>> = {
  ACTION: "deadline",
  REPETITIVE_ACTION: "deadline",
  MOMENTO: "eventDate",
  EXPIRATION: "expirationDate",
};

const FREQUENCY_TYPES: ActivityType[] = ["REPETITIVE_ACTION", "HABIT"];

// ─── Tokenizer ────────────────────────────────────────────────────────────────────

interface Token {
  kind: MarkKind;
  start: number;
  end: number;
  body: string;
}

interface Scan {
  tokens: Token[];
  /** Indexes of escape backslashes (`\#`), hidden in the title. */
  escapes: number[];
}

function isSpace(ch: string | undefined): boolean {
  return ch === undefined || /\s/.test(ch);
}

export function scanMarks(raw: string): Scan {
  const tokens: Token[] = [];
  const escapes: number[] = [];
  let i = 0;
  while (i < raw.length) {
    const atWordStart = isSpace(raw[i - 1]) || i === 0;
    if (atWordStart && raw[i] === "\\" && raw[i + 1]! in SIGILS) {
      escapes.push(i);
      i += 2;
      continue;
    }
    const kind = atWordStart ? SIGILS[raw[i]!] : undefined;
    if (kind) {
      let end = i + 1;
      while (end < raw.length && !isSpace(raw[end])) end++;
      const word = raw.slice(i + 1, end);
      const body = word.replace(TRAILING, "");
      if (body.length > 0) {
        tokens.push({ kind, start: i, end: i + 1 + body.length, body });
      }
      i = end;
      continue;
    }
    i++;
  }
  return { tokens, escapes };
}

// ─── Flags ────────────────────────────────────────────────────────────────────────

export interface FlagIndex {
  /** normalized full path ("ingresos/salario") → ids */
  byPath: Map<string, Set<string>>;
  /** normalized leaf name → ids */
  byLeaf: Map<string, Set<string>>;
}

function aliasesOf(flag: FlagLite): string[] {
  const own = normalizeFlagName(flag.name);
  const extra = flag.isSystemDefault ? (SYSTEM_FLAG_ALIASES[own] ?? []).map(normalizeFlagName) : [];
  return [...new Set([own, ...extra])];
}

export function buildFlagIndex(flags: FlagLite[]): FlagIndex {
  const byId = new Map(flags.map((f) => [f.id, f]));
  const byPath = new Map<string, Set<string>>();
  const byLeaf = new Map<string, Set<string>>();
  const add = (map: Map<string, Set<string>>, key: string, id: string) => {
    if (!map.has(key)) map.set(key, new Set());
    map.get(key)!.add(id);
  };

  const pathsOf = (flag: FlagLite, seen: Set<string>): string[] => {
    const own = aliasesOf(flag);
    const parent = flag.parentId ? byId.get(flag.parentId) : undefined;
    if (!parent || seen.has(parent.id)) return own; // root, missing parent, or a cycle
    seen.add(parent.id);
    return pathsOf(parent, seen).flatMap((p) => own.map((o) => `${p}/${o}`));
  };

  for (const flag of flags) {
    for (const leaf of aliasesOf(flag)) add(byLeaf, leaf, flag.id);
    for (const path of pathsOf(flag, new Set([flag.id]))) add(byPath, path, flag.id);
  }
  return { byPath, byLeaf };
}

function resolveFlag(body: string, index: FlagIndex): { status: MarkStatus; flagId?: string } {
  const key = normalizeFlagName(body);
  const ids = key.includes("/") ? index.byPath.get(key) : index.byLeaf.get(key);
  if (!ids || ids.size === 0) return { status: "unknown" };
  if (ids.size > 1) return { status: "ambiguous" };
  return { status: "ok", flagId: [...ids][0] };
}

// ─── Parse ────────────────────────────────────────────────────────────────────────

export function parseLine(raw: string, ctx: ParseContext, index = buildFlagIndex(ctx.flags)): ParsedLine {
  const { tokens, escapes } = scanMarks(raw);
  const marks: MarkSpan[] = tokens.map((t) => ({ ...t, status: "unknown" }));

  // 1. type: the last recognized `!type` wins
  let activityType: ActivityType | undefined;
  for (const m of marks.filter((m) => m.kind === "type")) {
    const type = typeFromKeyword(m.body);
    if (type) {
      m.type = type;
      m.status = "ok";
    }
  }
  markLastWins(marks.filter((m) => m.kind === "type" && m.status === "ok"));
  activityType = marks.find((m) => m.kind === "type" && m.status === "ok")?.type;

  // 2. frequency keywords (applicability needs the final type)
  for (const m of marks.filter((m) => m.kind === "frequency")) {
    const freq = frequencyFromKeyword(m.body);
    if (freq) {
      m.frequency = freq;
      m.status = "ok";
    }
  }
  markLastWins(marks.filter((m) => m.kind === "frequency" && m.status === "ok"));
  const frequencyMark = marks.find((m) => m.kind === "frequency" && m.status === "ok");

  const typeFromMark = activityType !== undefined;
  if (!activityType) activityType = frequencyMark ? "REPETITIVE_ACTION" : "ACTION";
  if (frequencyMark && !FREQUENCY_TYPES.includes(activityType)) frequencyMark.status = "notApplicable";

  // 3. dates
  for (const m of marks.filter((m) => m.kind === "date")) {
    const date = parseDateBody(m.body, ctx.today);
    if (date) {
      m.date = date;
      m.status = "ok";
    }
  }
  markLastWins(marks.filter((m) => m.kind === "date" && m.status === "ok"));
  const dateMark = marks.find((m) => m.kind === "date" && m.status === "ok");
  const dateField = DATE_FIELD_BY_TYPE[activityType];
  if (dateMark && !dateField) dateMark.status = "notApplicable";

  // 4. flags (several allowed)
  const flagIds: string[] = [];
  for (const m of marks.filter((m) => m.kind === "flag")) {
    const r = resolveFlag(m.body, index);
    m.status = r.status;
    if (r.flagId) {
      m.flagId = r.flagId;
      if (!flagIds.includes(r.flagId)) flagIds.push(r.flagId);
    }
  }

  return {
    title: buildTitle(raw, marks, escapes),
    activityType,
    typeFromMark,
    flagIds,
    frequency: frequencyMark?.status === "ok" ? frequencyMark.frequency! : null,
    date: dateMark?.status === "ok" && dateField ? { field: dateField, iso: dayToIso(dateMark.date!) } : null,
    marks,
  };
}

/** Among recognized single-value marks, all but the last become duplicates. */
function markLastWins(recognized: MarkSpan[]) {
  recognized.slice(0, -1).forEach((m) => (m.status = "duplicate"));
}

/** Marks that leave the title: recognized ones (a duplicate or not-applicable mark is still a mark). */
export function isRemovedFromTitle(m: MarkSpan): boolean {
  return m.status === "ok" || m.status === "duplicate" || m.status === "notApplicable";
}

function buildTitle(raw: string, marks: MarkSpan[], escapes: number[]): string {
  const cut = new Set<number>(escapes);
  for (const m of marks) {
    if (!isRemovedFromTitle(m)) continue;
    for (let i = m.start; i < m.end; i++) cut.add(i);
  }
  let out = "";
  for (let i = 0; i < raw.length; i++) if (!cut.has(i)) out += raw[i];
  return out.replace(/\s+/g, " ").replace(/\s+([.,;:])/g, "$1").trim();
}
