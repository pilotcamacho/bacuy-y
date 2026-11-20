import { CronExpressionParser } from "cron-parser";
import { generateKeyBetween } from "fractional-indexing";
import type { ActivityRow, LocalDb, WriteOp } from "@/lib/db/types";
import { gratitudeId, legacyGratitudeId } from "@/lib/ids";
import { kvGet, kvSet } from "@/lib/kv";
import { diffActivityFlags } from "@/services/lifecycle/activityFlags";
import { deriveTextFields, newActivityDefaults } from "@/services/lifecycle/derive";
import { systemFlagWord, typeKeyword, type MarkLocale } from "@/services/marks";

/**
 * Automatic gratitude entries (docs/04-implementation-plan.md Phase 10, as bacuy-x
 * `autoCreateGratitude`). When enabled, each window of the user's cron schedule gets one
 * GRATITUDE line at the top of the page, with `!gratitud #personal` in its text.
 *
 * - The id is deterministic per user and window (`gratitudeId`), so two devices create the
 *   same row, and a deleted entry is never created again (its tombstone has that id).
 * - The row is stamped `editedAt = window start`, earlier than any real edit: if another
 *   device already created it and the user wrote notes there, that version wins the merge
 *   and the server refuses this copy (same trick as the default flags).
 * - Nothing is created before this device's first pull: a new device could otherwise create
 *   an entry the account already has, before its flags exist, and re-deriving it once they
 *   arrive would give it a fresh `editedAt` that beats the real one.
 */

export const DEFAULT_GRATITUDE_CRON = "0 20 * * *"; // every day at 20:00, as bacuy-x

export interface GratitudeSettings {
  enabled: boolean;
  cron: string;
}

const ENABLED_KEY = "gratitudeEnabled";
const CRON_KEY = "gratitudeCron";

/**
 * Device-local (CLAUDE.md conventions): `bacuyy_gratitudeEnabled`, `bacuyy_gratitudeCron`.
 * **On by default** (confirmed 2026-11-20): only an explicit "off" ("0") turns it off.
 */
export function getGratitudeSettings(): GratitudeSettings {
  return { enabled: kvGet(ENABLED_KEY) !== "0", cron: kvGet(CRON_KEY) ?? DEFAULT_GRATITUDE_CRON };
}

export function setGratitudeSettings(next: Partial<GratitudeSettings>): void {
  if (next.enabled !== undefined) kvSet(ENABLED_KEY, next.enabled ? "1" : "0");
  if (next.cron !== undefined) kvSet(CRON_KEY, next.cron.trim());
}

/** The start of the schedule's latest window (its last fire time at or before `now`). */
export function gratitudeWindow(cron: string, now: Date): Date | null {
  if (!cron.trim()) return null;
  try {
    // `currentDate` is exclusive for prev(): a fire exactly at `now` counts as the window.
    return CronExpressionParser.parse(cron.trim(), { currentDate: new Date(now.getTime() + 1000) }).prev().toDate();
  } catch {
    return null;
  }
}

export function isValidCron(cron: string): boolean {
  return gratitudeWindow(cron, new Date()) !== null;
}

export interface GratitudeContext {
  ownerSub: string;
  now: Date;
  locale: MarkLocale;
  /** The localized line title, e.g. "Gratitud — 15 nov". */
  title(windowStart: Date): string;
}

/** The entry for a window, as stored rows (activity + its ActivityFlag rows). Pure. */
export function gratitudeEntry(
  windowStart: Date,
  ctx: GratitudeContext,
  flags: Parameters<typeof deriveTextFields>[2]["flags"],
  topPosition: string | null,
): WriteOp[] {
  const id = gratitudeId(ctx.ownerSub, windowStart);
  const stamp = windowStart.toISOString();
  const personal = systemFlagWord("personal", ctx.locale) ?? "personal";
  const rawInput = `${ctx.title(windowStart)} !${typeKeyword("GRATITUDE", ctx.locale)} #${personal}`;
  const base: ActivityRow = {
    ...newActivityDefaults(),
    id,
    rawInput,
    position: generateKeyBetween(null, topPosition),
    editedAt: stamp,
    deletedAt: null,
  };
  const { fields, flagIds } = deriveTextFields(base, rawInput, { flags, today: ctx.now });
  const activity: ActivityRow = { ...base, ...fields };
  const links = diffActivityFlags(id, flagIds, [], stamp);
  return [{ model: "Activity", row: activity }, ...links.map((row): WriteOp => ({ model: "ActivityFlag", row }))];
}

/**
 * Creates this window's entry if gratitude is on and the entry was never created on this
 * device (or pulled from another). Returns the new activity id, or null.
 */
export async function autoCreateGratitude(
  db: LocalDb,
  settings: GratitudeSettings,
  ctx: GratitudeContext,
): Promise<string | null> {
  if (!settings.enabled) return null;
  const windowStart = gratitudeWindow(settings.cron, ctx.now);
  if (!windowStart) return null;
  const id = gratitudeId(ctx.ownerSub, windowStart);
  if (await db.get("Activity", id)) return null; // created, completed, archived or deleted: done
  // Created before the id changed to local time (2026-11-20): the same window, already done.
  if (await db.get("Activity", legacyGratitudeId(ctx.ownerSub, windowStart))) return null;
  if (!(await db.getMeta("lastPulledAt:Activity"))) return null; // see the note above

  const [activities, flags] = await Promise.all([db.getAll("Activity"), db.getAll("Flag")]);
  let top: string | null = null;
  for (const a of activities) if (!a.deletedAt && (top === null || a.position < top)) top = a.position;
  const ops = gratitudeEntry(windowStart, ctx, flags.filter((f) => !f.deletedAt), top);
  await db.putManyLocal(ops);
  return id;
}
