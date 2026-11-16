import type { ActivityRow } from "@/lib/db/types";
import { DATE_FIELD_BY_TYPE, parseLine, type ParseContext } from "@/services/marks";
import { statusForFlags } from "./status";

const DATE_FIELDS = ["deadline", "eventDate", "expirationDate"] as const;

/**
 * Re-derives the fields the text owns from `rawInput` (docs/05-line-mapping.md §1):
 * title, activityType, frequency, the type's date field, and the status by the flag rule
 * (DRAFT ↔ ACTIVE). The ActivityFlag rows come from `flagIds` (see activityFlags.ts).
 */
export function deriveTextFields(
  row: Pick<ActivityRow, "frequency" | "status">,
  rawInput: string,
  ctx: ParseContext,
): { fields: Partial<ActivityRow>; flagIds: string[] } {
  const parsed = parseLine(rawInput, ctx);
  const fields: Partial<ActivityRow> = {
    rawInput,
    title: parsed.title,
    activityType: parsed.activityType,
    status: statusForFlags(row.status, parsed.flagIds.length > 0),
  };

  // CUSTOM has no mark: a line without ~frequency keeps a CUSTOM set in the panel.
  if (parsed.frequency || row.frequency !== "CUSTOM") fields.frequency = parsed.frequency;

  // All three date fields belong to the `@date` mark: the type's own gets the value, the
  // others are cleared (a type change must not leave a stale deadline behind).
  const dateField = DATE_FIELD_BY_TYPE[parsed.activityType];
  for (const field of DATE_FIELDS) fields[field] = field === dateField ? (parsed.date?.iso ?? null) : null;

  return { fields, flagIds: parsed.flagIds };
}

/** Field values of a brand-new line (bacuy-x defaults). */
export function newActivityDefaults(): Omit<ActivityRow, "id" | "position" | "editedAt"> {
  return {
    title: "",
    rawInput: "",
    activityType: "ACTION",
    status: "DRAFT",
    isHidden: false,
    completionCount: 0,
    streak: 0,
    renewalLeadDays: 30,
    isRenewed: false,
  };
}
