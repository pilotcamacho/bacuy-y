import { describe, expect, it } from "vitest";
import {
  computeActivityScore,
  computeFlagScore,
  computePriorityList,
  flagPathScore,
  indexFlags,
  isCronActive,
  isExpirationVisible,
} from "@/services/priority/score";

/**
 * Phase 11: the priority score. The first block repeats bacuy-x's tests/phase16/score.test.ts
 * and tests/phase18/expiration.test.ts cases (weights summing to 100: same numbers); the
 * rest covers what bacuy-y changes (drift normalization) and the view's filter and order.
 */

const flag = (id: string, weight: number, parentId: string | null = null, deletedAt: string | null = null) => ({
  id,
  weight,
  parentId,
  deletedAt,
});
const link = (activityId: string, flagId: string, deletedAt: string | null = null) => ({ activityId, flagId, deletedAt });

// The default tree: 7 roots summing to 100, income's children 50/30/20.
const DEFAULTS = [
  flag("personal", 15),
  flag("family", 15),
  flag("income", 20),
  flag("spiritual", 10),
  flag("health", 20),
  flag("errand", 5),
  flag("fun", 15),
  flag("salary", 50, "income"),
  flag("project", 30, "income"),
  flag("rent", 20, "income"),
];
const INDEX = indexFlags(DEFAULTS);
const NOW = new Date(2026, 10, 15, 12, 0); // Sun 15 Nov 2026, 12:00 local
const at = (d: number, h = 12) => new Date(2026, 10, d, h).toISOString();

const activity = (over: Record<string, unknown> = {}) => ({
  id: "a1",
  activityType: "ACTION" as const,
  status: "ACTIVE" as const,
  cron: null as string | null,
  expirationDate: null as string | null,
  isHidden: false,
  hiddenUntil: null as string | null,
  renewalLeadDays: null as number | null,
  position: "a0",
  deletedAt: null as string | null,
  ...over,
});

describe("parity with bacuy-x (sums of 100)", () => {
  it("a root flag scores weight / 100; a child multiplies by its parent", () => {
    expect(flagPathScore("income", INDEX)).toBeCloseTo(0.2);
    expect(flagPathScore("salary", INDEX)).toBeCloseTo(0.1);
    expect(flagPathScore("rent", INDEX)).toBeCloseTo(0.04);
    expect(flagPathScore("unknown", INDEX)).toBe(0);
  });

  it("the flag score is the best path among the activity's flags; 0 without flags", () => {
    expect(computeFlagScore(["income"], INDEX)).toBeCloseTo(0.2);
    expect(computeFlagScore(["salary", "income", "errand"], INDEX)).toBeCloseTo(0.2);
    expect(computeFlagScore([], INDEX)).toBe(0);
  });

  it("no boosts: score = flag score", () => {
    expect(computeActivityScore(activity(), ["income"], INDEX, NOW)).toBeCloseTo(0.2);
  });

  it("a cron starting within 60 minutes multiplies by 1.3; later or invalid does not", () => {
    expect(isCronActive("30 12 * * *", NOW)).toBe(true);
    expect(isCronActive("0 13 * * *", NOW)).toBe(true); // exactly 60 min
    expect(isCronActive("1 13 * * *", NOW)).toBe(false);
    expect(isCronActive("not a cron", NOW)).toBe(false);
    expect(computeActivityScore(activity({ cron: "30 12 * * *" }), ["income"], INDEX, NOW)).toBeCloseTo(0.26);
    expect(computeActivityScore(activity({ cron: "0 20 * * *" }), ["income"], INDEX, NOW)).toBeCloseTo(0.2);
    expect(computeActivityScore(activity({ cron: "garbage" }), ["income"], INDEX, NOW)).toBeCloseTo(0.2);
  });

  it("an expiration divides by the days left (at least 1)", () => {
    const exp = (d: number) => activity({ activityType: "EXPIRATION", expirationDate: at(d) });
    expect(computeActivityScore(exp(25), ["income"], INDEX, NOW)).toBeCloseTo(0.02, 3); // 10 days
    expect(computeActivityScore(exp(10), ["income"], INDEX, NOW)).toBeCloseTo(0.2); // overdue → 1
    expect(computeActivityScore(exp(15), ["income"], INDEX, NOW)).toBeCloseTo(0.2); // today → 1
    expect(computeActivityScore(exp(16), ["income"], INDEX, NOW)).toBeGreaterThan(computeActivityScore(exp(35), ["income"], INDEX, NOW));
    // The cron boost applies on top.
    const boosted = activity({ activityType: "EXPIRATION", expirationDate: at(25), cron: "30 12 * * *" });
    expect(computeActivityScore(boosted, ["income"], INDEX, NOW)).toBeCloseTo(0.026, 4);
  });

  it("an expiration shows from renewalLeadDays before its date (30 by default)", () => {
    expect(isExpirationVisible(at(30), null, NOW)).toBe(true); // 15 days
    expect(isExpirationVisible(at(15) /* today */, null, NOW)).toBe(true);
    expect(isExpirationVisible(at(1), null, NOW)).toBe(true); // overdue
    expect(isExpirationVisible(new Date(2026, 11, 20, 12).toISOString(), null, NOW)).toBe(false); // 35 days
    expect(isExpirationVisible(at(30), 7, NOW)).toBe(false);
    expect(isExpirationVisible(at(20), 7, NOW)).toBe(true);
  });
});

describe("drift normalization (CLAUDE.md rule 11)", () => {
  it("each weight is divided by its siblings' real sum", () => {
    // Two devices raised different roots offline: 60 + 60 = 120.
    const drifted = indexFlags([flag("a", 60), flag("b", 60), flag("c", 30, "a"), flag("d", 60, "a")]);
    expect(flagPathScore("a", drifted)).toBeCloseTo(0.5);
    expect(flagPathScore("c", drifted)).toBeCloseTo(0.5 * (30 / 90));
    expect(flagPathScore("d", drifted)).toBeCloseTo(0.5 * (60 / 90));
  });

  it("a group under 100 is scaled up the same way, and a group summing to 0 scores 0", () => {
    const low = indexFlags([flag("a", 20), flag("b", 30)]);
    expect(flagPathScore("a", low)).toBeCloseTo(0.4);
    const zero = indexFlags([flag("a", 0), flag("b", 0)]);
    expect(flagPathScore("a", zero)).toBe(0);
  });

  it("deleted flags leave the sums; a flag whose parent is gone counts as a root", () => {
    const index = indexFlags([flag("a", 50), flag("b", 50, null, "2026-11-01T00:00:00.000Z"), flag("c", 40, "gone")]);
    expect(flagPathScore("a", index)).toBeCloseTo(1);
    expect(flagPathScore("b", index)).toBe(0);
    expect(flagPathScore("c", index)).toBeCloseTo(1); // its own group (parent "gone") sums to 40
  });

  it("negative weights count as 0 and never make a score negative", () => {
    const index = indexFlags([flag("a", -10), flag("b", 50)]);
    expect(flagPathScore("a", index)).toBe(0);
    expect(flagPathScore("b", index)).toBeCloseTo(1);
  });
});

describe("the priority list", () => {
  it("keeps ACTIVE, visible, non-deleted rows and expirations within their lead", () => {
    const rows = [
      activity({ id: "active" }),
      activity({ id: "draft", status: "DRAFT" }),
      activity({ id: "done", status: "COMPLETED" }),
      activity({ id: "paused", status: "INACTIVE" }),
      activity({ id: "archived", status: "ARCHIVED" }),
      activity({ id: "deleted", deletedAt: at(14) }),
      activity({ id: "hidden", isHidden: true }),
      activity({ id: "snoozed", hiddenUntil: at(16) }),
      activity({ id: "woke", hiddenUntil: at(14) }),
      activity({ id: "expSoon", activityType: "EXPIRATION", expirationDate: at(20) }),
      activity({ id: "expFar", activityType: "EXPIRATION", expirationDate: new Date(2027, 2, 1).toISOString() }),
    ];
    const ids = computePriorityList(rows, [], DEFAULTS, NOW).map((s) => s.activity.id);
    expect(ids.sort()).toEqual(["active", "expSoon", "woke"]);
  });

  it("sorts by score, ties by page position; deleted links do not count", () => {
    const rows = [
      activity({ id: "fun", position: "a1" }),
      activity({ id: "salary", position: "a2" }),
      activity({ id: "income", position: "a3" }),
      activity({ id: "none", position: "a0" }),
      activity({ id: "family", position: "a0" }),
      activity({ id: "unlinked", position: "a4" }),
    ];
    const links = [
      link("fun", "fun"),
      link("salary", "salary"),
      link("income", "income"),
      link("family", "family"),
      link("unlinked", "health", "2026-11-01T00:00:00.000Z"),
    ];
    const list = computePriorityList(rows, links, DEFAULTS, NOW);
    expect(list.map((s) => s.activity.id)).toEqual(["income", "family", "fun", "salary", "none", "unlinked"]);
    expect(list[0]!.score).toBeCloseTo(0.2);
    expect(list.at(-1)!.score).toBe(0);
  });

  it("a cron starting soon lifts a line above a heavier one, and is flagged as active", () => {
    const rows = [activity({ id: "heavy", position: "a0" }), activity({ id: "soon", position: "a1", cron: "45 12 * * *" })];
    const links = [link("heavy", "income"), link("soon", "health")]; // both 0.2; soon gets ×1.3
    const list = computePriorityList(rows, links, DEFAULTS, NOW);
    expect(list.map((s) => [s.activity.id, s.cronActive])).toEqual([
      ["soon", true],
      ["heavy", false],
    ]);
  });
});
