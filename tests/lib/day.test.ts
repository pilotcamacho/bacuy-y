import { describe, expect, it } from "vitest";
import { DAY_START_HOUR, addDays, dayStartAt, logicalDayKey, logicalToday } from "@/lib/day";
import { localDay } from "@/services/lifecycle/completed";
import { daysUntil } from "@/services/lifecycle/tick";

describe("the app's day starts at 03:00", () => {
  it("before 03:00 the night belongs to the day before", () => {
    expect(DAY_START_HOUR).toBe(3);
    expect(logicalToday(new Date(2026, 10, 20, 2, 0))).toEqual(new Date(2026, 10, 19));
    expect(logicalToday(new Date(2026, 10, 20, 2, 59))).toEqual(new Date(2026, 10, 19));
    expect(logicalToday(new Date(2026, 10, 20, 3, 0))).toEqual(new Date(2026, 10, 20));
    expect(logicalToday(new Date(2026, 10, 20, 23, 59))).toEqual(new Date(2026, 10, 20));
    expect(logicalToday(new Date(2027, 0, 1, 1))).toEqual(new Date(2026, 11, 31)); // New Year's night
  });

  it("keys, starts and day arithmetic", () => {
    expect(logicalDayKey(new Date(2026, 10, 20, 2, 0))).toBe("2026-11-19");
    expect(dayStartAt(new Date(2026, 10, 20))).toEqual(new Date(2026, 10, 20, 3));
    expect(addDays(new Date(2026, 11, 30), 3)).toEqual(new Date(2027, 0, 2));
  });

  it("the Completed page groups a line done at 01:00 under the day before", () => {
    expect(localDay(new Date(2026, 10, 20, 1, 0).toISOString())).toBe("2026-11-19");
    expect(localDay(new Date(2026, 10, 20, 9, 0).toISOString())).toBe("2026-11-20");
  });

  it("days left count from the app's day; old and new stored dates read the same", () => {
    const due = "2026-11-20T00:00:00.000Z"; // a calendar date (new form)
    const legacy = new Date(2026, 10, 20).toISOString(); // local midnight (before 2026-11-20)
    expect(daysUntil(due, new Date(2026, 10, 20, 10))).toBe(0);
    expect(daysUntil(due, new Date(2026, 10, 20, 1))).toBe(1); // still the 19th
    expect(daysUntil(legacy, new Date(2026, 10, 20, 10))).toBe(0);
    expect(daysUntil(due, new Date(2026, 10, 22, 10))).toBe(-2);
  });
});
