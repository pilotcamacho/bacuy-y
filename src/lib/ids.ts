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

/** The auto-created gratitude entry of one cron window. */
export function gratitudeId(ownerSub: string, windowStart: Date): string {
  return uuidv5(`${ownerSub}:gratitude:${windowStart.toISOString()}`, BACUYY_NS);
}
