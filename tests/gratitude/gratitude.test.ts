import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openLocalDb } from "@/lib/db";
import { setDbForTests } from "@/lib/db/instance";
import type { FlagRow, LocalDb, WriteOp } from "@/lib/db/types";
import { activityFlagId, flagId, gratitudeId, legacyGratitudeId } from "@/lib/ids";
import { defaultFlagRows } from "@/services/flags/defaults";
import {
  autoCreateGratitude,
  getGratitudeSettings,
  gratitudeWindow,
  setGratitudeSettings,
  type GratitudeContext,
} from "@/services/gratitude/autoCreate";
import { journalEntries } from "@/services/gratitude/journal";

/** Phase 10: one automatic gratitude entry per schedule window, the same id on every device. */

const SUB = "sub-gratitude";
const PERSONAL = flagId(SUB, "personal");
const ON = { enabled: true, cron: "0 20 * * *" };

let db: LocalDb;
let n = 0;

const at = (y: number, m: number, d: number, h: number, min = 0) => new Date(y, m - 1, d, h, min);
const ctx = (now: Date): GratitudeContext => ({
  ownerSub: SUB,
  now,
  locale: "es",
  title: (d) => `Gratitud — ${d.getDate()}/${d.getMonth() + 1}`,
});

async function freshDevice(name: string): Promise<LocalDb> {
  const d = await openLocalDb(name);
  await d.putManyLocal(defaultFlagRows(SUB).map((row: FlagRow): WriteOp => ({ model: "Flag", row })));
  await d.setMeta("lastPulledAt:Activity", "2026-11-01T00:00:00.000Z"); // pulled once
  return d;
}

beforeEach(async () => {
  db = await freshDevice(`bacuyy-gratitude-${++n}`);
  setDbForTests(db);
  localStorage.clear();
});

afterEach(() => {
  db.close();
  setDbForTests(null);
});

describe("schedule window", () => {
  it("is the last fire time at or before now", () => {
    expect(gratitudeWindow("0 20 * * *", at(2026, 11, 15, 21))).toEqual(at(2026, 11, 15, 20));
    expect(gratitudeWindow("0 20 * * *", at(2026, 11, 15, 19))).toEqual(at(2026, 11, 14, 20));
    expect(gratitudeWindow("0 20 * * *", at(2026, 11, 15, 20))).toEqual(at(2026, 11, 15, 20));
    expect(gratitudeWindow("not a cron", at(2026, 11, 15, 20))).toBeNull();
    expect(gratitudeWindow("", at(2026, 11, 15, 20))).toBeNull();
  });

  it("settings are device-local, off by default, 20:00 daily", () => {
    expect(getGratitudeSettings()).toEqual({ enabled: false, cron: "0 20 * * *" });
    setGratitudeSettings({ enabled: true, cron: " 0 9 * * 1 " });
    expect(getGratitudeSettings()).toEqual({ enabled: true, cron: "0 9 * * 1" });
    expect(localStorage.getItem("bacuyy_gratitudeEnabled")).toBe("1");
  });
});

describe("auto-create", () => {
  it("does nothing when off, or before this device's first pull", async () => {
    expect(await autoCreateGratitude(db, { ...ON, enabled: false }, ctx(at(2026, 11, 15, 21)))).toBeNull();
    const fresh = await openLocalDb(`bacuyy-gratitude-fresh-${n}`);
    expect(await autoCreateGratitude(fresh, ON, ctx(at(2026, 11, 15, 21)))).toBeNull();
    expect(await fresh.getAll("Activity")).toEqual([]);
    fresh.close();
  });

  it("creates one entry per window, at the top, tagged #personal, stamped with the window start", async () => {
    await db.putLocal("Activity", {
      id: "first",
      title: "x",
      rawInput: "x",
      activityType: "ACTION",
      status: "DRAFT",
      position: "a0",
      editedAt: "2026-11-15T10:00:00.000Z",
    });
    const window = at(2026, 11, 15, 20);
    const id = await autoCreateGratitude(db, ON, ctx(at(2026, 11, 15, 21)));
    expect(id).toBe(gratitudeId(SUB, window));
    const row = (await db.get("Activity", id!))!;
    expect(row).toMatchObject({
      rawInput: "Gratitud — 15/11 !gratitud #personal",
      title: "Gratitud — 15/11",
      activityType: "GRATITUDE",
      status: "ACTIVE",
      editedAt: window.toISOString(),
      dirty: 1,
    });
    expect(row.position < "a0").toBe(true);
    expect(await db.get("ActivityFlag", activityFlagId(id!, PERSONAL))).toMatchObject({ deletedAt: null, dirty: 1 });

    // Same window, later in the evening: nothing new.
    expect(await autoCreateGratitude(db, ON, ctx(at(2026, 11, 15, 23)))).toBeNull();
    // Next day's window: a new entry.
    const next = await autoCreateGratitude(db, ON, ctx(at(2026, 11, 16, 20, 5)));
    expect(next).toBe(gratitudeId(SUB, at(2026, 11, 16, 20)));
    expect((await db.getAll("Activity")).filter((a) => a.activityType === "GRATITUDE")).toHaveLength(2);
  });

  it("the id is the window's local wall-clock time, so devices in different time zones agree", () => {
    // 20:00 on 15 Nov on two clocks: the same key, though the UTC instants differ.
    const id = gratitudeId(SUB, at(2026, 11, 15, 20));
    expect(id).toBe(gratitudeId(SUB, new Date(2026, 10, 15, 20, 0, 30))); // seconds ignored
    expect(id).not.toBe(gratitudeId(SUB, at(2026, 11, 16, 20)));
    expect(id).not.toBe(legacyGratitudeId(SUB, at(2026, 11, 15, 20)));
  });

  it("an entry created with the old id (before 2026-11-20) is not created again", async () => {
    const window = at(2026, 11, 15, 20);
    const legacy = legacyGratitudeId(SUB, window);
    await db.putLocal("Activity", {
      id: legacy,
      title: "Gratitud — 15/11",
      rawInput: "Gratitud — 15/11 !gratitud #personal",
      activityType: "GRATITUDE",
      status: "ACTIVE",
      position: "a0",
      editedAt: window.toISOString(),
    });
    expect(await autoCreateGratitude(db, ON, ctx(at(2026, 11, 15, 21)))).toBeNull();
    expect((await db.getAll("Activity")).filter((a) => a.activityType === "GRATITUDE")).toHaveLength(1);
  });

  it("never brings back an entry the user deleted or completed", async () => {
    const id = (await autoCreateGratitude(db, ON, ctx(at(2026, 11, 15, 21))))!;
    const row = (await db.get("Activity", id))!;
    await db.putLocal("Activity", { ...row, deletedAt: "2026-11-15T21:30:00.000Z", editedAt: "2026-11-15T21:30:00.000Z" });
    expect(await autoCreateGratitude(db, ON, ctx(at(2026, 11, 15, 22)))).toBeNull();
    expect((await db.get("Activity", id))!.deletedAt).toBe("2026-11-15T21:30:00.000Z");
  });

  it("two devices in the same window create the same row (same id, same content)", async () => {
    const other = await freshDevice(`bacuyy-gratitude-other-${n}`);
    const a = await autoCreateGratitude(db, ON, ctx(at(2026, 11, 15, 20, 1)));
    const b = await autoCreateGratitude(other, ON, ctx(at(2026, 11, 15, 22, 40)));
    expect(b).toBe(a);
    const { dirty: _a, ...rowA } = (await db.get("Activity", a!))!;
    const { dirty: _b, ...rowB } = (await other.get("Activity", b!))!;
    expect(rowB).toEqual(rowA); // a tie on editedAt: the server keeps the first, nothing is lost
    other.close();
  });

  it("a version edited on another device beats this device's copy", async () => {
    const id = gratitudeId(SUB, at(2026, 11, 15, 20));
    const fromServer = {
      id,
      title: "Gratitud — 15/11",
      rawInput: "Gratitud — 15/11 !gratitud #personal",
      activityType: "GRATITUDE" as const,
      status: "COMPLETED" as const,
      description: "el café con mamá",
      position: "Zz",
      editedAt: at(2026, 11, 15, 20, 30).toISOString(), // notes written at 20:30
    };
    const other = await freshDevice(`bacuyy-gratitude-late-${n}`);
    await autoCreateGratitude(other, ON, ctx(at(2026, 11, 15, 21)));
    expect(await other.mergeFromServer("Activity", fromServer)).toBe("replaced");
    expect((await other.get("Activity", id))!.description).toBe("el café con mamá");
    other.close();
  });
});

describe("journal", () => {
  it("lists completed gratitude entries, newest first", () => {
    const base = { rawInput: "", title: "", position: "a0", deletedAt: null };
    const rows = {
      a: { ...base, id: "a", activityType: "GRATITUDE" as const, status: "COMPLETED" as const, editedAt: "2026-11-10T00:00:00.000Z" },
      b: { ...base, id: "b", activityType: "GRATITUDE" as const, status: "COMPLETED" as const, editedAt: "2026-11-12T00:00:00.000Z" },
      c: { ...base, id: "c", activityType: "GRATITUDE" as const, status: "ACTIVE" as const, editedAt: "2026-11-13T00:00:00.000Z" },
      d: { ...base, id: "d", activityType: "ACTION" as const, status: "COMPLETED" as const, editedAt: "2026-11-14T00:00:00.000Z" },
      e: { ...base, id: "e", activityType: "GRATITUDE" as const, status: "COMPLETED" as const, editedAt: "2026-11-15T00:00:00.000Z", deletedAt: "2026-11-15T00:00:00.000Z" },
    };
    expect(journalEntries(rows).map((r) => r.id)).toEqual(["b", "a"]);
  });
});
