import type { Schema } from "../../../amplify/data/resource";

/**
 * Mark keywords, accepted in Spanish AND English whatever the UI language
 * (CLAUDE.md, Localization). They are data for the parser, not UI strings, so they live
 * here and not in the locale files. Entries may carry accents (that is how the panel writes
 * them); matching always goes through normalize().
 * Grammar: docs/05-line-mapping.md §2.
 */

export type ActivityType = Schema["ActivityType"]["type"];
export type Frequency = Schema["Frequency"]["type"];
export type MarkLocale = "es" | "en";

/** Lowercase, no accents. Used for every comparison. */
export function normalize(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

/** Flag names compare like marks: normalized, spaces as "-". */
export function normalizeFlagName(name: string): string {
  return normalize(name.trim()).replace(/\s+/g, "-");
}

/** `!type` keywords. The first entry per locale is the one the panel writes. */
export const TYPE_KEYWORDS: Record<ActivityType, Record<MarkLocale, string[]>> = {
  ACTION: { es: ["acción", "tarea"], en: ["action", "task"] },
  REPETITIVE_ACTION: { es: ["repetitiva", "repetir"], en: ["repeat", "repetitive"] },
  HABIT: { es: ["hábito"], en: ["habit"] },
  ATTITUDE: { es: ["actitud"], en: ["attitude"] },
  SKILL: { es: ["habilidad"], en: ["skill"] },
  MOMENTO: { es: ["momento"], en: ["moment"] },
  GRATITUDE: { es: ["gratitud"], en: ["gratitude"] },
  EXPIRATION: { es: ["vence", "vencimiento"], en: ["expires", "expiration"] },
};

/** `~frequency` keywords. CUSTOM has no mark (it is set in the panel with `cron`). */
export const FREQUENCY_KEYWORDS: Record<Exclude<Frequency, "CUSTOM">, Record<MarkLocale, string[]>> = {
  DAILY: { es: ["diario"], en: ["daily"] },
  WEEKLY: { es: ["semanal"], en: ["weekly"] },
  MONTHLY: { es: ["mensual"], en: ["monthly"] },
};

export const DATE_TODAY = ["hoy", "today"];
export const DATE_TOMORROW = ["manana", "tomorrow"];

/** Index = JavaScript `Date.getDay()` (0 = Sunday). */
export const WEEKDAYS: string[][] = [
  ["domingo", "sunday"],
  ["lunes", "monday"],
  ["martes", "tuesday"],
  ["miercoles", "wednesday"],
  ["jueves", "thursday"],
  ["viernes", "friday"],
  ["sabado", "saturday"],
];

/**
 * Names a system flag answers to, besides its stored key (`name`).
 * Same keys as bacuy-x's seedDefaultFlags; display names come from i18n `flag.<key>`.
 */
export const SYSTEM_FLAG_ALIASES: Record<string, string[]> = {
  personal: ["personal"],
  family: ["familia", "family"],
  income: ["ingresos", "income"],
  salary: ["salario", "salary"],
  project: ["proyecto", "project"],
  rent: ["renta", "rent"],
  spiritual: ["espiritual", "spiritual"],
  health: ["salud", "health"],
  errand: ["recados", "errand", "errands"],
  fun: ["diversión", "fun"],
};

/** The alias written for a system flag in each locale (index into SYSTEM_FLAG_ALIASES). */
export function systemFlagWord(key: string, locale: MarkLocale): string | undefined {
  const aliases = SYSTEM_FLAG_ALIASES[key];
  if (!aliases) return undefined;
  if (aliases.length === 1) return aliases[0];
  return locale === "es" ? aliases[0] : aliases[1];
}

const typeIndex = new Map<string, ActivityType>();
for (const [type, byLocale] of Object.entries(TYPE_KEYWORDS) as [ActivityType, Record<MarkLocale, string[]>][]) {
  for (const word of [...byLocale.es, ...byLocale.en]) typeIndex.set(normalize(word), type);
}

const frequencyIndex = new Map<string, Frequency>();
for (const [freq, byLocale] of Object.entries(FREQUENCY_KEYWORDS) as [Frequency, Record<MarkLocale, string[]>][]) {
  for (const word of [...byLocale.es, ...byLocale.en]) frequencyIndex.set(normalize(word), freq);
}

export function typeFromKeyword(word: string): ActivityType | undefined {
  return typeIndex.get(normalize(word));
}

export function frequencyFromKeyword(word: string): Frequency | undefined {
  return frequencyIndex.get(normalize(word));
}

export function typeKeyword(type: ActivityType, locale: MarkLocale): string {
  return TYPE_KEYWORDS[type][locale][0]!;
}

export function frequencyKeyword(freq: Exclude<Frequency, "CUSTOM">, locale: MarkLocale): string {
  return FREQUENCY_KEYWORDS[freq][locale][0]!;
}
