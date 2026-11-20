import { describe, expect, it } from "vitest";
import type { ActivityRow } from "@/lib/db/types";
import { expirationLines, hiddenLines, nextReveal, pageLines } from "@/services/editor/pageLines";
import { expirationRevealAt, isExpirationWaiting, leadDays } from "@/services/lifecycle/expiration";
import { isPriorityCandidate } from "@/services/priority/score";

const NOW = new Date(2026, 10, 20, 10); // Fri 20 Nov 2026, 10:00 local
const date = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).toISOString();

type Row = Pick<
  ActivityRow,
  "id" | "rawInput" | "position" | "status" | "deletedAt" | "hiddenUntil" | "isHidden" | "activityType" | "expirationDate" | "renewalLeadDays"
>;
const row = (id: string, over: Partial<Row> = {}): Row => ({
  id,
  rawInput: id,
  position: id,
  status: "ACTIVE",
  deletedAt: null,
  hiddenUntil: null,
  isHidden: false,
  activityType: "EXPIRATION",
  expirationDate: null,
  renewalLeadDays: null,
  ...over,
});

describe("expirations wait off the page until their window opens", () => {
  it("the window opens lead days before the date, at 03:00 (30 days by default)", () => {
    expect(leadDays({ renewalLeadDays: null })).toBe(30);
    expect(leadDays({ renewalLeadDays: -4 })).toBe(0);
    expect(expirationRevealAt(row("p", { expirationDate: date(2027, 3, 1) }))).toEqual(new Date(2027, 0, 30, 3));
    expect(expirationRevealAt(row("p", { expirationDate: date(2027, 3, 1), renewalLeadDays: 7 }))).toEqual(new Date(2027, 1, 22, 3));
    expect(expirationRevealAt(row("p", { expirationDate: null }))).toBeNull();
  });

  it("waiting: dated, pending and not yet in the window; never without a date, overdue or done", () => {
    expect(isExpirationWaiting(row("far", { expirationDate: date(2027, 3, 1) }), NOW)).toBe(true);
    expect(isExpirationWaiting(row("in", { expirationDate: date(2026, 12, 20) }), NOW)).toBe(false); // 30 days: in
    expect(isExpirationWaiting(row("out", { expirationDate: date(2026, 12, 21) }), NOW)).toBe(true); // 31 days
    expect(isExpirationWaiting(row("lead0", { expirationDate: date(2026, 11, 21), renewalLeadDays: 0 }), NOW)).toBe(true);
    expect(isExpirationWaiting(row("today0", { expirationDate: date(2026, 11, 20), renewalLeadDays: 0 }), NOW)).toBe(false);
    expect(isExpirationWaiting(row("overdue", { expirationDate: date(2026, 1, 1) }), NOW)).toBe(false);
    expect(isExpirationWaiting(row("nodate"), NOW)).toBe(false);
    expect(isExpirationWaiting(row("done", { expirationDate: date(2027, 3, 1), status: "COMPLETED" }), NOW)).toBe(false);
    expect(isExpirationWaiting(row("action", { activityType: "ACTION", expirationDate: date(2027, 3, 1) }), NOW)).toBe(false);
  });

  it("it shows up at 03:00 on the window's first day, not at midnight", () => {
    const r = row("p", { expirationDate: date(2026, 12, 21) }); // window opens 21 Nov at 03:00
    expect(isExpirationWaiting(r, new Date(2026, 10, 21, 2, 59))).toBe(true);
    expect(isExpirationWaiting(r, new Date(2026, 10, 21, 3, 0))).toBe(false);
  });

  it("off the page and out of Hidden (it lives on Vencimientos); the page wakes up when it opens", () => {
    const rows = {
      far: row("far", { expirationDate: date(2027, 3, 1) }),
      near: row("near", { expirationDate: date(2026, 12, 1) }),
      nodate: row("nodate"),
      todo: row("todo", { activityType: "ACTION" }),
    };
    expect(pageLines(rows, NOW).map((l) => l.id)).toEqual(["near", "nodate", "todo"]);
    expect(pageLines(rows, NOW, new Set(["far"])).map((l) => l.id)).toEqual(["far", "near", "nodate", "todo"]); // being edited
    expect(hiddenLines(rows, NOW)).toEqual([]);
    expect(nextReveal(rows, NOW)).toEqual(new Date(2027, 0, 30, 3));
    expect(expirationLines(rows).map((r) => r.id)).toEqual(["near", "far", "nodate"]);
  });

  it("Priority uses the same rule", () => {
    const base = { cron: null, position: "a" };
    expect(isPriorityCandidate({ ...base, ...row("far", { expirationDate: date(2027, 3, 1) }) }, NOW)).toBe(false);
    expect(isPriorityCandidate({ ...base, ...row("near", { expirationDate: date(2026, 12, 1) }) }, NOW)).toBe(true);
  });
});
