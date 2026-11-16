import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openLocalDb } from "@/lib/db";
import { setDbForTests } from "@/lib/db/instance";
import type { LocalDb } from "@/lib/db/types";
import { resetEventsForTests, subscribe } from "@/lib/events";
import { ensureOwner, pendingChanges, prepareSession, requestPersistentStorage, wipeLocalData } from "@/services/session";

let db: LocalDb;
let n = 0;

const row = (id: string) => ({
  id,
  title: id,
  rawInput: id,
  activityType: "ACTION" as const,
  status: "DRAFT" as const,
  position: "a0",
  editedAt: "2026-11-14T00:00:00.000Z",
});

beforeEach(async () => {
  db = await openLocalDb(`bacuyy-session-${++n}`);
  setDbForTests(db);
});

afterEach(() => {
  db.close();
  setDbForTests(null);
  resetEventsForTests();
});

describe("local data belongs to one user", () => {
  it("the first sign-in records the owner and keeps the data already there", async () => {
    await db.putLocal("Activity", row("x"));
    expect(await ensureOwner(db, "sub-a")).toBe("first");
    expect(await db.getMeta("ownerSub")).toBe("sub-a");
    expect(await db.get("Activity", "x")).toBeTruthy();
  });

  it("the same user again keeps everything", async () => {
    await ensureOwner(db, "sub-a");
    await db.putLocal("Activity", row("x"));
    expect(await ensureOwner(db, "sub-a")).toBe("same");
    expect(await db.get("Activity", "x")).toBeTruthy();
  });

  it("data adopted from before the owner check loses another account's rows (local only)", async () => {
    // A browser used with a test account before the check existed, then with the real one.
    await db.putFromServer("Flag", { id: "f-test", name: "health", weight: 15, editedAt: "1970-01-01T00:00:00.000Z", owner: "sub-test" });
    await db.putLocal("Activity", { ...row("t-line"), owner: "sub-test" });
    await db.putFromServer("Flag", { id: "f-me", name: "health", weight: 15, editedAt: "1970-01-01T00:00:00.000Z", owner: "sub-a" });
    await db.putLocal("Activity", row("draft")); // typed here, not pushed: kept
    expect(await ensureOwner(db, "sub-a")).toBe("cleaned");
    expect((await db.getAll("Flag")).map((f) => f.id)).toEqual(["f-me"]);
    expect((await db.getAll("Activity")).map((a) => a.id)).toEqual(["draft"]);
    expect(await db.countDirty()).toBe(1); // the other account's pending row no longer retries
    // Already recorded as this user's: the check still runs on every start.
    await db.putFromServer("Flag", { id: "f-late", name: "fun", weight: 15, editedAt: "1970-01-01T00:00:00.000Z", owner: "sub-test" });
    expect(await ensureOwner(db, "sub-a")).toBe("cleaned");
    expect(await ensureOwner(db, "sub-a")).toBe("same");
  });

  it("another user on this browser starts clean (rows and sync meta wiped)", async () => {
    await ensureOwner(db, "sub-a");
    await db.putLocal("Activity", row("x"));
    await db.setMeta("lastPulledAt:Activity", "2026-11-14T00:00:00.000Z");
    expect(await prepareSession("sub-b")).toBe("wiped");
    expect(await db.getAll("Activity")).toEqual([]);
    expect(await db.getMeta("lastPulledAt:Activity")).toBeUndefined();
    expect(await db.getMeta("ownerSub")).toBe("sub-b");
  });
});

describe("persistent storage", () => {
  it("asks the browser once, then never again", async () => {
    const storage = { persist: vi.fn(async () => true), persisted: vi.fn(async () => false) } as unknown as StorageManager;
    expect(await requestPersistentStorage(storage)).toBe(true);
    expect(await requestPersistentStorage(storage)).toBe(false);
    expect(storage.persist).toHaveBeenCalledTimes(1);
  });

  it("never throws when the browser refuses or lacks the API", async () => {
    const storage = { persist: vi.fn(async () => Promise.reject(new Error("no"))) } as unknown as StorageManager;
    expect(await requestPersistentStorage(storage)).toBe(false);
    localStorage.clear();
    expect(await requestPersistentStorage(undefined)).toBe(false);
  });
});

describe("sign out", () => {
  it("counts pending changes and wipes everything, telling the other tabs", async () => {
    const seen: string[] = [];
    subscribe((e) => seen.push(e.type));
    await db.putLocal("Activity", row("x"));
    await db.putFromServer("Activity", row("y"));
    expect(await pendingChanges()).toBe(1);
    await wipeLocalData();
    expect(await db.getAll("Activity")).toEqual([]);
    expect(seen).toContain("signedOut");
  });
});
