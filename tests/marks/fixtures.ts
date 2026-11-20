import type { FlagLite } from "@/services/marks";

/** The system flags (names = keys, as seeded) plus two user flags. */
export const FLAGS: FlagLite[] = [
  { id: "personal", name: "personal", isSystemDefault: true },
  { id: "family", name: "family", isSystemDefault: true },
  { id: "income", name: "income", isSystemDefault: true },
  { id: "salary", name: "salary", parentId: "income", isSystemDefault: true },
  { id: "project", name: "project", parentId: "income", isSystemDefault: true },
  { id: "rent", name: "rent", parentId: "income", isSystemDefault: true },
  { id: "spiritual", name: "spiritual", isSystemDefault: true },
  { id: "health", name: "health", isSystemDefault: true },
  { id: "errand", name: "errand", isSystemDefault: true },
  { id: "fun", name: "fun", isSystemDefault: true },
  // user flags: "Mi proyecto" (spaces), and a second "Proyecto" under family → leaf ambiguity
  { id: "mine", name: "Mi proyecto" },
  { id: "famproj", name: "Proyecto", parentId: "family" },
];

/** Saturday 14 Nov 2026, local time. */
export const TODAY = new Date(2026, 10, 14, 10, 30);

export const CTX = { flags: FLAGS, today: TODAY };

/** A calendar date as stored: UTC midnight (the same day in every time zone). */
export const day = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).toISOString();
