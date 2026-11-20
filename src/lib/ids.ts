import { v5 as uuidv5 } from "uuid";

/**
 * Row ids are created on the device (CLAUDE.md, rule 3).
 * Rows that two devices could create independently get deterministic ids (UUID v5), so both
 * devices create the same row instead of a duplicate. See docs/03-data-schema.md §5.
 */

/** Fixed namespace for bacuy-y's v5 ids. Never change it: existing ids depend on it. */
export const BACUYY_NS = "3f9d4c2e-8b1a-4e57-9c6d-2a7b5e0f1c84";

export function newId(): string {
  return crypto.randomUUID();
}

/** System flag. `key` = `personal`, … or a child path such as `income/salary`. */
export function flagId(ownerSub: string, key: string): string {
  return uuidv5(`${ownerSub}:flag:${key}`, BACUYY_NS);
}

/** The ActivityFlag row linking one activity and one flag. */
export function activityFlagId(activityId: string, flagIdValue: string): string {
  return uuidv5(`${activityId}:${flagIdValue}`, BACUYY_NS);
}

/**
 * The auto-created gratitude entry of one cron window, keyed by the window's **local wall-clock
 * time** (`2026-11-19T20:00`), not its UTC instant: the schedule is in each device's local time,
 * so two devices in different time zones get the same id for "today at 20:00" instead of two
 * entries (docs/05-line-mapping.md §7).
 */
export function gratitudeId(ownerSub: string, windowStart: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const w = windowStart;
  const local = `${w.getFullYear()}-${pad(w.getMonth() + 1)}-${pad(w.getDate())}T${pad(w.getHours())}:${pad(w.getMinutes())}`;
  return uuidv5(`${ownerSub}:gratitude:local:${local}`, BACUYY_NS);
}

/** The id entries had before 2026-11-20 (the window's UTC instant): still recognized, never created. */
export function legacyGratitudeId(ownerSub: string, windowStart: Date): string {
  return uuidv5(`${ownerSub}:gratitude:${windowStart.toISOString()}`, BACUYY_NS);
}
