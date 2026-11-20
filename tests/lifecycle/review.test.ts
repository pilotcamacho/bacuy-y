import { describe, expect, it } from "vitest";
import { LAST_REVIEW_STEP, REVIEW_HOUR, REVIEW_LADDER, isSpaced, reviewDueAt, reviewOutcome } from "@/services/lifecycle/review";

describe("spaced review (attitudes and skills)", () => {
  it("only attitudes and skills are spaced", () => {
    expect(isSpaced({ activityType: "ATTITUDE" })).toBe(true);
    expect(isSpaced({ activityType: "SKILL" })).toBe(true);
    expect(isSpaced({ activityType: "HABIT" })).toBe(false);
  });

  it("the ladder: 1d, 3d, 1w, 2w, 1m, 2m, 3m, 6m", () => {
    expect(REVIEW_LADDER).toEqual([{ days: 1 }, { days: 3 }, { days: 7 }, { days: 14 }, { months: 1 }, { months: 2 }, { months: 3 }, { months: 6 }]);
  });

  it("Bien climbs one step; from scratch it starts on the first", () => {
    expect(reviewOutcome(null, true)).toEqual({ step: 0, done: false });
    expect(reviewOutcome(0, true)).toEqual({ step: 1, done: false });
    expect(reviewOutcome(5, true)).toEqual({ step: 6, done: false });
  });

  it("Bien on the last step (6 months) means internalized", () => {
    expect(reviewOutcome(LAST_REVIEW_STEP, true)).toEqual({ step: LAST_REVIEW_STEP, done: true });
  });

  it("Mal goes one step back, never below the first", () => {
    expect(reviewOutcome(4, false)).toEqual({ step: 3, done: false });
    expect(reviewOutcome(0, false)).toEqual({ step: 0, done: false });
    expect(reviewOutcome(null, false)).toEqual({ step: 0, done: false });
  });

  it("odd stored steps are clamped", () => {
    expect(reviewOutcome(99, false)).toEqual({ step: LAST_REVIEW_STEP - 1, done: false });
    expect(reviewOutcome(-3, true)).toEqual({ step: 1, done: false });
  });

  it("comes back at 03:00 local on the day the wait ends", () => {
    const now = new Date(2026, 10, 18, 21, 40); // Wed 18 Nov 2026, 21:40
    expect(reviewDueAt(0, now)).toEqual(new Date(2026, 10, 19, REVIEW_HOUR));
    expect(reviewDueAt(1, now)).toEqual(new Date(2026, 10, 21, REVIEW_HOUR));
    expect(reviewDueAt(2, now)).toEqual(new Date(2026, 10, 25, REVIEW_HOUR));
    expect(reviewDueAt(3, now)).toEqual(new Date(2026, 11, 2, REVIEW_HOUR));
    expect(reviewDueAt(4, now)).toEqual(new Date(2026, 11, 18, REVIEW_HOUR));
    expect(reviewDueAt(7, now)).toEqual(new Date(2027, 4, 18, REVIEW_HOUR));
  });

  it("a month from the 31st lands on the month's last day; before 03:00 counts from the day before", () => {
    expect(reviewDueAt(4, new Date(2027, 0, 31, 10))).toEqual(new Date(2027, 1, 28, REVIEW_HOUR));
    // 19 Nov 01:30 is still the 18th: one day later is the 19th at 03:00.
    expect(reviewDueAt(0, new Date(2026, 10, 19, 1, 30))).toEqual(new Date(2026, 10, 19, REVIEW_HOUR));
  });
});
