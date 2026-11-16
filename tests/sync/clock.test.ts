import { afterEach, describe, expect, it, vi } from "vitest";
import { openLocalDb } from "@/lib/db";
import {
  getClockOffset,
  loadClockOffset,
  now,
  nowIso,
  observeServerTime,
  resetClockForTests,
} from "@/services/sync/clock";

describe("clock", () => {
  afterEach(() => {
    resetClockForTests();
    vi.useRealTimers();
  });

  it("without samples, now() is the device clock", () => {
    vi.useFakeTimers({ now: new Date("2026-11-14T12:00:00.000Z") });
    expect(nowIso()).toBe("2026-11-14T12:00:00.000Z");
  });

  it("estimates the offset from the midpoint of the round trip", async () => {
    // device thinks it is 12:00:00; server says 12:00:05 at the midpoint
    const start = Date.parse("2026-11-14T11:59:59.900Z");
    const end = Date.parse("2026-11-14T12:00:00.100Z");
    await observeServerTime("2026-11-14T12:00:05.000Z", start, end);
    expect(getClockOffset()).toBe(5000);
    vi.useFakeTimers({ now: new Date("2026-11-14T12:00:00.000Z") });
    expect(nowIso()).toBe("2026-11-14T12:00:05.000Z");
  });

  it("uses the median, so one outlier does not move it", async () => {
    for (const ms of [1000, 1100, 900, 60_000]) {
      await observeServerTime(new Date(10_000 + ms).toISOString(), 9_900, 10_100);
    }
    expect(getClockOffset()).toBe(1050);
  });

  it("ignores missing server times and slow round trips", async () => {
    await observeServerTime(undefined, 0, 100);
    await observeServerTime(new Date(50_000).toISOString(), 0, 20_000);
    expect(getClockOffset()).toBe(0);
  });

  it("persists the offset in sync_meta and loads it back", async () => {
    const db = await openLocalDb("bacuyy-clock");
    await observeServerTime(new Date(12_000).toISOString(), 9_900, 10_100, db);
    resetClockForTests();
    expect(getClockOffset()).toBe(0);
    await loadClockOffset(db);
    expect(getClockOffset()).toBe(2000);
    expect(now() - Date.now()).toBeGreaterThanOrEqual(1999);
    db.close();
  });

  it("ignores an offset stored in the old format (it may have been sampled wrongly)", async () => {
    const db = await openLocalDb("bacuyy-clock-old");
    await db.setMeta("clockOffsetMs", -2_600_000);
    await loadClockOffset(db);
    expect(getClockOffset()).toBe(0);
    db.close();
  });
});
