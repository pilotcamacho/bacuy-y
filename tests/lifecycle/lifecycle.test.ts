import { describe, expect, it } from "vitest";
import type { ActivityFlagRow } from "@/lib/db/types";
import { activityFlagId, flagId } from "@/lib/ids";
import { DEFAULT_FLAGS, SEED_EDITED_AT, defaultFlagRows, missingDefaultFlags } from "@/services/flags/defaults";
import { diffActivityFlags } from "@/services/lifecycle/activityFlags";
import { deriveTextFields } from "@/services/lifecycle/derive";
import { applyStatusAction, canComplete, statusActions, statusForFlags } from "@/services/lifecycle/status";
import { hidePresetAt, isHiddenNow, nextShowAt } from "@/services/lifecycle/nextShow";
import { daysUntil, tick, tickIsClickable, type TickRow } from "@/services/lifecycle/tick";

const SUB = "14b83488-e001-703e-30a3-cefb7b703fd9";
const row = (over: Partial<TickRow> = {}): TickRow => ({
  activityType: "ACTION",
  status: "DRAFT",
  completionCount: 0,
  targetCount: null,
  streak: 0,
  targetStreak: null,
  cron: null,
  frequency: null,
  ...over,
});
const NOW = new Date(2026, 10, 15, 18, 30); // Sun 15 Nov 2026, 18:30 local
const local = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).toISOString();

describe("done for this time: when the line comes back", () => {
  it("by frequency, at 00:00: tomorrow, same weekday next week, same day next month", () => {
    expect(nextShowAt({ cron: null, frequency: "DAILY" }, NOW).toISOString()).toBe(local(2026, 11, 16));
    expect(nextShowAt({ cron: null, frequency: "WEEKLY" }, NOW).toISOString()).toBe(local(2026, 11, 22));
    expect(nextShowAt({ cron: null, frequency: "MONTHLY" }, NOW).toISOString()).toBe(local(2026, 12, 15));
    // A shorter next month: its last day.
    expect(nextShowAt({ cron: null, frequency: "MONTHLY" }, new Date(2027, 0, 31, 9)).toISOString()).toBe(local(2027, 2, 28));
    expect(nextShowAt({ cron: null, frequency: "MONTHLY" }, new Date(2026, 11, 20, 9)).toISOString()).toBe(local(2027, 1, 20));
  });

  it("no schedule (or CUSTOM without a cron) -> tomorrow at 00:00", () => {
    expect(nextShowAt({ cron: null, frequency: null }, NOW).toISOString()).toBe(local(2026, 11, 16));
    expect(nextShowAt({ cron: null, frequency: "CUSTOM" }, NOW).toISOString()).toBe(local(2026, 11, 16));
  });

  it("a cron wins over the frequency; an invalid cron falls back to it", () => {
    expect(nextShowAt({ cron: "0 8 * * 1", frequency: "DAILY" }, NOW).toISOString()).toBe(local(2026, 11, 16, 8)); // Monday 08:00
    expect(nextShowAt({ cron: "0 20 * * *", frequency: null }, NOW).toISOString()).toBe(local(2026, 11, 15, 20)); // later today
    expect(nextShowAt({ cron: "nope", frequency: "WEEKLY" }, NOW).toISOString()).toBe(local(2026, 11, 22));
  });

  it("hidden while hiddenUntil is in the future", () => {
    expect(isHiddenNow({ hiddenUntil: local(2026, 11, 16) }, NOW)).toBe(true);
    expect(isHiddenNow({ hiddenUntil: local(2026, 11, 15, 18) }, NOW)).toBe(false);
    expect(isHiddenNow({ hiddenUntil: null }, NOW)).toBe(false);
  });
});

describe("tick per type", () => {
  it("ACTION: completes (stamped, off the page), and unticking returns to ACTIVE with flags or DRAFT without", () => {
    expect(tick(row(), false, NOW)).toEqual({
      kind: "update",
      patch: { status: "COMPLETED", completedAt: NOW.toISOString() },
      completed: true,
    });
    expect(tick(row({ status: "COMPLETED" }), true)).toEqual({ kind: "update", patch: { status: "ACTIVE", completedAt: null } });
    expect(tick(row({ status: "COMPLETED" }), false)).toEqual({ kind: "update", patch: { status: "DRAFT", completedAt: null } });
  });

  it("REPETITIVE_ACTION: counts up and is hidden until next time; completes (not hidden) at the target", () => {
    const r = row({ activityType: "REPETITIVE_ACTION", status: "ACTIVE", completionCount: 1, frequency: "WEEKLY" });
    expect(tick(r, true, NOW)).toEqual({
      kind: "update",
      patch: { completionCount: 2, hiddenUntil: local(2026, 11, 22) },
      hidden: true,
    });
    expect(tick({ ...r, targetCount: 2 }, true, NOW)).toEqual({
      kind: "update",
      patch: { completionCount: 2, status: "COMPLETED", completedAt: NOW.toISOString() },
      completed: true,
    });
    expect(tick({ ...r, status: "COMPLETED" }, true, NOW)).toEqual({ kind: "none" });
  });

  it("HABIT: adds to the streak, hides the day, hints at the target, never completes by itself", () => {
    const r = row({ activityType: "HABIT", status: "ACTIVE", streak: 4, targetStreak: 5, frequency: "DAILY" });
    expect(tick(r, true, NOW)).toEqual({
      kind: "update",
      patch: { streak: 5, hiddenUntil: local(2026, 11, 16) },
      formedHint: true,
      hidden: true,
    });
    expect(tick({ ...r, targetStreak: 30 }, true, NOW)).toMatchObject({ patch: { streak: 5 }, formedHint: false, hidden: true });
  });

  it("ATTITUDE, GRATITUDE and EXPIRATION open the panel; SKILL and MOMENTO do nothing", () => {
    expect(tick(row({ activityType: "ATTITUDE" }), true)).toEqual({ kind: "panel", section: "feedback" });
    expect(tick(row({ activityType: "GRATITUDE" }), true)).toEqual({ kind: "panel", section: "description" });
    expect(tick(row({ activityType: "GRATITUDE", status: "COMPLETED" }), true)).toEqual({ kind: "none" });
    expect(tick(row({ activityType: "EXPIRATION" }), true)).toEqual({ kind: "panel", section: "expiration" });
    expect(tick(row({ activityType: "SKILL" }), true)).toEqual({ kind: "none" });
    expect(tick(row({ activityType: "MOMENTO" }), true)).toEqual({ kind: "none" });
  });

  it("a paused line has no tick; a DRAFT line can be ticked", () => {
    expect(tick(row({ status: "INACTIVE" }), true)).toEqual({ kind: "none" });
    expect(tickIsClickable(row({ status: "INACTIVE" }))).toBe(false);
    expect(tickIsClickable(row({ status: "DRAFT" }))).toBe(true);
    expect(tickIsClickable(row({ activityType: "MOMENTO" }))).toBe(false);
    expect(tickIsClickable(row({ status: "COMPLETED" }))).toBe(true); // ACTION: untick
    expect(tickIsClickable(row({ activityType: "HABIT", status: "COMPLETED" }))).toBe(false);
  });

  it("daysUntil counts calendar days in local time", () => {
    const today = new Date(2026, 10, 14, 23, 30);
    expect(daysUntil(new Date(2026, 10, 15).toISOString(), today)).toBe(1);
    expect(daysUntil(new Date(2026, 10, 14).toISOString(), today)).toBe(0);
    expect(daysUntil(new Date(2026, 10, 10).toISOString(), today)).toBe(-4);
  });
});

describe("status rules", () => {
  it("DRAFT ↔ ACTIVE follows the flags; other statuses are kept", () => {
    expect(statusForFlags("DRAFT", true)).toBe("ACTIVE");
    expect(statusForFlags("ACTIVE", false)).toBe("DRAFT");
    expect(statusForFlags("ACTIVE", true)).toBe("ACTIVE");
    expect(statusForFlags("COMPLETED", false)).toBe("COMPLETED");
    expect(statusForFlags("INACTIVE", true)).toBe("INACTIVE");
    expect(statusForFlags(null, true)).toBe("ACTIVE");
  });

  it("deriveTextFields applies the flag rule", () => {
    const ctx = { flags: [{ id: "h", name: "health", isSystemDefault: true }], today: new Date(2026, 10, 14) };
    expect(deriveTextFields({ status: "DRAFT", frequency: null }, "correr #salud", ctx)).toMatchObject({
      fields: { status: "ACTIVE", title: "correr" },
      flagIds: ["h"],
    });
    expect(deriveTextFields({ status: "ACTIVE", frequency: null }, "correr", ctx).fields.status).toBe("DRAFT");
  });

  it("panel actions per type", () => {
    expect(statusActions({ activityType: "ACTION", status: "ACTIVE" })).toEqual(["pause", "complete", "archive"]);
    expect(statusActions({ activityType: "MOMENTO", status: "ACTIVE" })).toEqual(["pause", "archive"]);
    expect(statusActions({ activityType: "HABIT", status: "INACTIVE" })).toEqual(["reactivate", "complete", "archive"]);
    expect(statusActions({ activityType: "HABIT", status: "COMPLETED" })).toEqual(["reactivate", "archive"]);
  });

  it("gratitude needs notes to complete; expiration archive marks it renewed", () => {
    expect(canComplete({ activityType: "GRATITUDE", status: "DRAFT", description: "  " })).toBe(false);
    expect(applyStatusAction({ activityType: "GRATITUDE", status: "DRAFT", description: "" }, "complete", false)).toBeNull();
    expect(applyStatusAction({ activityType: "GRATITUDE", status: "DRAFT", description: "sol" }, "complete", false, NOW)).toEqual({
      status: "COMPLETED",
      completedAt: NOW.toISOString(),
    });
    expect(applyStatusAction({ activityType: "EXPIRATION", status: "ACTIVE" }, "archive", true)).toEqual({ status: "ARCHIVED", isRenewed: true });
    expect(applyStatusAction({ activityType: "MOMENTO", status: "ACTIVE" }, "complete", true)).toBeNull();
  });

  it("leaving COMPLETED (reactivate, pause) clears completedAt", () => {
    expect(applyStatusAction({ activityType: "ACTION", status: "INACTIVE" }, "reactivate", false)).toEqual({ status: "DRAFT", completedAt: null });
    expect(applyStatusAction({ activityType: "ACTION", status: "COMPLETED" }, "reactivate", true)).toEqual({ status: "ACTIVE", completedAt: null });
    expect(applyStatusAction({ activityType: "ACTION", status: "ACTIVE" }, "pause", true)).toEqual({ status: "INACTIVE", completedAt: null });
  });
});

describe("ActivityFlag rows", () => {
  const now = "2026-11-14T10:00:00.000Z";
  const later = "2026-11-14T11:00:00.000Z";

  it("creates one row per flag with a deterministic id", () => {
    const out = diffActivityFlags("a1", ["f1", "f2"], [], now);
    expect(out.map((r) => r.id)).toEqual([activityFlagId("a1", "f1"), activityFlagId("a1", "f2")]);
    expect(out.every((r) => r.activityId === "a1" && r.deletedAt === null && r.editedAt === now)).toBe(true);
  });

  it("soft-deletes removed flags and revives the same row when the mark comes back", () => {
    const existing: ActivityFlagRow[] = diffActivityFlags("a1", ["f1"], [], now);
    const removed = diffActivityFlags("a1", [], existing, later);
    expect(removed).toEqual([{ ...existing[0], deletedAt: later, editedAt: later }]);
    const revived = diffActivityFlags("a1", ["f1"], removed, later);
    expect(revived).toEqual([{ ...existing[0], deletedAt: null, editedAt: later }]);
  });

  it("writes nothing when the flags did not change, and ignores other activities' rows", () => {
    const existing = [...diffActivityFlags("a1", ["f1"], [], now), ...diffActivityFlags("a2", ["f9"], [], now)];
    expect(diffActivityFlags("a1", ["f1"], existing, later)).toEqual([]);
  });
});

describe("default flags", () => {
  it("are the bacuy-x set: 7 roots and 3 children of income, siblings summing to 100", () => {
    const rows = defaultFlagRows(SUB);
    expect(rows).toHaveLength(10);
    const roots = rows.filter((r) => !r.parentId);
    const income = rows.find((r) => r.name === "income")!;
    const children = rows.filter((r) => r.parentId === income.id);
    expect(roots.reduce((s, r) => s + r.weight, 0)).toBe(100);
    expect(children.map((r) => r.name)).toEqual(["salary", "project", "rent"]);
    expect(children.reduce((s, r) => s + r.weight, 0)).toBe(100);
    expect(rows.every((r) => r.isSystemDefault && r.editedAt === SEED_EDITED_AT)).toBe(true);
  });

  it("two devices seeding get the same ids; seeding again adds nothing; a deleted one is not revived", () => {
    const a = defaultFlagRows(SUB);
    expect(defaultFlagRows(SUB)).toEqual(a);
    expect(a.find((r) => r.name === "salary")!.id).toBe(flagId(SUB, "income/salary"));
    expect(missingDefaultFlags(SUB, a)).toEqual([]);
    const withoutFun = a.filter((r) => r.name !== "fun");
    expect(missingDefaultFlags(SUB, withoutFun).map((r) => r.name)).toEqual(["fun"]);
    expect(missingDefaultFlags(SUB, a.map((r) => ({ ...r, deletedAt: now() })))).toEqual([]);
    expect(DEFAULT_FLAGS).toHaveLength(10);
  });
});

function now() {
  return new Date().toISOString();
}

describe("hide until…", () => {
  // NOW = Sun 15 Nov 2026, 18:30 local.
  it("quick choices: 3 hours, tomorrow 8:00, next Monday 8:00, a month (clamped)", () => {
    expect(hidePresetAt("later", NOW)).toEqual(new Date(2026, 10, 15, 21, 30));
    expect(hidePresetAt("tomorrow", NOW)).toEqual(new Date(2026, 10, 16, 8));
    expect(hidePresetAt("monday", NOW)).toEqual(new Date(2026, 10, 16, 8));
    expect(hidePresetAt("monday", new Date(2026, 10, 16, 7))).toEqual(new Date(2026, 10, 23, 8)); // never today
    expect(hidePresetAt("nextMonth", NOW)).toEqual(new Date(2026, 11, 15, 8));
    expect(hidePresetAt("nextMonth", new Date(2027, 0, 31, 10))).toEqual(new Date(2027, 1, 28, 8));
  });

  it("isHidden hides with no time; hiddenUntil hides until it passes", () => {
    expect(isHiddenNow({ isHidden: true, hiddenUntil: null }, NOW)).toBe(true);
    expect(isHiddenNow({ isHidden: false, hiddenUntil: new Date(2026, 10, 16).toISOString() }, NOW)).toBe(true);
    expect(isHiddenNow({ isHidden: false, hiddenUntil: new Date(2026, 10, 14).toISOString() }, NOW)).toBe(false);
    expect(isHiddenNow({ isHidden: null, hiddenUntil: null }, NOW)).toBe(false);
  });
});
