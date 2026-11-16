import { describe, expect, it } from "vitest";
import { activityFlagId, flagId, gratitudeId, newId } from "@/lib/ids";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("ids", () => {
  it("newId is a random v4 UUID", () => {
    const a = newId();
    expect(a).toMatch(UUID);
    expect(a[14]).toBe("4");
    expect(newId()).not.toBe(a);
  });

  it("two devices seeding the same default flag get the same id", () => {
    const deviceA = flagId("sub-1", "income/salary");
    const deviceB = flagId("sub-1", "income/salary");
    expect(deviceA).toBe(deviceB);
    expect(deviceA).toMatch(UUID);
    expect(deviceA[14]).toBe("5");
  });

  it("deterministic ids differ by user, key, pair and window", () => {
    expect(flagId("sub-1", "health")).not.toBe(flagId("sub-2", "health"));
    expect(flagId("sub-1", "health")).not.toBe(flagId("sub-1", "fun"));
    expect(activityFlagId("a1", "f1")).toBe(activityFlagId("a1", "f1"));
    expect(activityFlagId("a1", "f1")).not.toBe(activityFlagId("f1", "a1"));
    const w = new Date("2026-11-14T20:00:00.000Z");
    expect(gratitudeId("sub-1", w)).toBe(gratitudeId("sub-1", new Date(w.getTime())));
    expect(gratitudeId("sub-1", w)).not.toBe(gratitudeId("sub-1", new Date(w.getTime() + 86_400_000)));
  });

  it("is stable across releases (namespace must never change)", () => {
    expect(flagId("sub-1", "personal")).toMatchInlineSnapshot(`"be44c701-a2fd-5035-b89b-3d2c2da17825"`);
  });
});
