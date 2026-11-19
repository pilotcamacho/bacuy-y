/**
 * Text search over lines (the Hidden tab's filter). Pure.
 * A line matches when every word of the query appears somewhere in its text (marks included,
 * so `#salud` or `!hábito` work too), ignoring case and accents: "habito" finds "hábito".
 */

/** Lower case, without accents (é → e, ñ → n). */
export function foldText(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** The query's words, folded. Empty when there is nothing to filter by. */
export function queryWords(query: string): string[] {
  return foldText(query).split(/\s+/).filter(Boolean);
}

export function matchesText(text: string, words: readonly string[]): boolean {
  if (words.length === 0) return true;
  const folded = foldText(text);
  return words.every((w) => folded.includes(w));
}
