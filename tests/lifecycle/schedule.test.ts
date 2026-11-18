import { describe, expect, it } from "vitest";
import { nextShowAt } from "@/services/lifecycle/nextShow";
import { cronAfterFrequencyChange, fromCron, toCron } from "@/services/lifecycle/schedule";

describe("schedule picker ↔ cron", () => {
  it("writes the simple shapes", () => {
    expect(toCron({ kind: "weekly", days: [4, 1, 1], time: "08:30" })).toBe("30 8 * * 1,4");
    expect(toCron({ kind: "weekly", days: [0], time: null })).toBe("0 0 * * 0");
    expect(toCron({ kind: "weekly", days: [], time: "08:00" })).toBeNull(); // nothing picked
    expect(toCron({ kind: "monthly", monthDay: "last", time: null })).toBe("0 0 L * *");
    expect(toCron({ kind: "monthly", monthDay: 15, time: "9:05" })).toBe("5 9 15 * *");
    expect(toCron({ kind: "monthly", time: "9:00" })).toBeNull();
    expect(toCron({ kind: "daily", time: "07:15" })).toBe("15 7 * * *");
    expect(toCron({ kind: "daily", time: null })).toBeNull();
  });

  it("reads them back, ranges included; anything else is custom", () => {
    expect(fromCron("30 8 * * 1,4")).toEqual({ kind: "weekly", days: [1, 4], time: "08:30" });
    expect(fromCron("0 7 * * 1-5")).toEqual({ kind: "weekly", days: [1, 2, 3, 4, 5], time: "07:00" });
    expect(fromCron("0 0 * * 7")).toEqual({ kind: "weekly", days: [0], time: null }); // 7 = Sunday too
    expect(fromCron("0 0 L * *")).toEqual({ kind: "monthly", monthDay: "last", time: null });
    expect(fromCron("5 9 15 * *")).toEqual({ kind: "monthly", monthDay: 15, time: "09:05" });
    expect(fromCron("15 7 * * *")).toEqual({ kind: "daily", time: "07:15" });
    for (const custom of ["0 0 31 * *", "*/15 * * * *", "0 8 1 1 *", "0 8 1 * 1", "nope", "", null]) {
      expect(fromCron(custom)).toBeNull();
    }
  });

  it("a picked schedule of another kind goes when the frequency changes; custom ones stay", () => {
    expect(cronAfterFrequencyChange("0 0 * * 5", "MONTHLY")).toBeNull();
    expect(cronAfterFrequencyChange("0 0 L * *", "WEEKLY")).toBeNull();
    expect(cronAfterFrequencyChange("0 0 * * 5", null)).toBeNull();
    expect(cronAfterFrequencyChange("0 0 * * 5", "WEEKLY")).toBe("0 0 * * 5");
    expect(cronAfterFrequencyChange("0 0 * * 5", "CUSTOM")).toBe("0 0 * * 5"); // edit it from there
    expect(cronAfterFrequencyChange("*/15 * * * *", "MONTHLY")).toBe("*/15 * * * *");
  });

  it("the next time follows the picked days, not the day it was ticked", () => {
    // Ticked on Wednesday 18 Nov 2026 (late), the Monday/Thursday line is back on Thursday.
    const wed = new Date(2026, 10, 18, 21, 0);
    expect(nextShowAt({ cron: "30 8 * * 1,4", frequency: "WEEKLY" }, wed)).toEqual(new Date(2026, 10, 19, 8, 30));
    // Last day of the month, from 20 Jan 2027: 31 Jan, then (ticked then) 28 Feb.
    expect(nextShowAt({ cron: "0 0 L * *", frequency: "MONTHLY" }, new Date(2027, 0, 20))).toEqual(new Date(2027, 0, 31));
    expect(nextShowAt({ cron: "0 0 L * *", frequency: "MONTHLY" }, new Date(2027, 0, 31, 9))).toEqual(new Date(2027, 1, 28));
  });
});
