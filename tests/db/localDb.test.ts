import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openLocalDb } from "@/lib/db";
import type { ActivityFlagRow, ActivityRow, FlagRow, LocalDb } from "@/lib/db/types";

/** Contract tests of LocalDb on fake-indexeddb (one fresh database per test). */

let db: LocalDb;
let n = 0;

beforeEach(async () => {
  db = await openLocalDb(`bacuyy-test-${++n}`);
});
afterEach(() => db.close());

const t = (s: number) => new Date(Date.UTC(2026, 10, 14, 12, 0, s)).toISOString();

function activity(id: string, over: Partial<ActivityRow> = {}): ActivityRow {
  return { id, title: id, activityType: "ACTION", position: "a0", editedAt: t(0), ...over };
}
function flag(id: string, over: Partial<FlagRow> = {}): FlagRow {
  return { id, name: id, weight: 50, editedAt: t(0), ...over };
}

describe("LocalDb: local writes and reads", () => {
  it("putLocal stores the row as dirty; get / getAll read it back", async () => {
    await db.putLocal("Activity", activity("a1", { rawInput: "pan #recados" }));
    expect(await db.get("Activity", "a1")).toMatchObject({ id: "a1", rawInput: "pan #recados", dirty: 1 });
    expect(await db.getAll("Activity")).toHaveLength(1);
    expect(await db.get("Activity", "missing")).toBeUndefined();
  });

  it("strips functions (relation loaders) and undefined values before storing", async () => {
    const withLoader = { ...activity("a1"), feedbacks: () => Promise.resolve([]), description: undefined };
    await db.putFromServer("Activity", withLoader as ActivityRow);
    const stored = (await db.get("Activity", "a1")) as Record<string, unknown>;
    expect(stored.feedbacks).toBeUndefined();
    expect("description" in stored).toBe(false);
  });

  it("listByIndex finds rows by position, status, parentId, activityId, flagId", async () => {
    await db.putLocal("Activity", activity("a1", { position: "a1", status: "ACTIVE" }));
    await db.putLocal("Activity", activity("a2", { position: "a2", status: null }));
    await db.putLocal("Flag", flag("root"));
    await db.putLocal("Flag", flag("child", { parentId: "root" }));
    const af: ActivityFlagRow = { id: "af1", activityId: "a1", flagId: "child", editedAt: t(0) };
    await db.putLocal("ActivityFlag", af);

    expect((await db.listByIndex("Activity", "status", "ACTIVE")).map((r) => r.id)).toEqual(["a1"]);
    expect((await db.listByIndex("Activity", "position", "a2")).map((r) => r.id)).toEqual(["a2"]);
    expect((await db.listByIndex("Flag", "parentId", "root")).map((r) => r.id)).toEqual(["child"]);
    expect((await db.listByIndex("ActivityFlag", "activityId", "a1"))[0]?.flagId).toBe("child");
    expect((await db.listByIndex("ActivityFlag", "flagId", "child"))[0]?.activityId).toBe("a1");
  });

  it("putManyLocal writes several models in one transaction", async () => {
    await db.putManyLocal([
      { model: "Activity", row: activity("a1") },
      { model: "Activity", row: activity("a2") },
      { model: "ActivityFlag", row: { id: "af", activityId: "a1", flagId: "f", editedAt: t(0) } },
    ]);
    expect(await db.getAll("Activity")).toHaveLength(2);
    expect(await db.countDirty()).toBe(3);
  });

  it("putManyLocal is all or nothing", async () => {
    const bad = { id: undefined } as unknown as ActivityRow; // no key → the put fails
    await expect(
      db.putManyLocal([
        { model: "Activity", row: activity("a1") },
        { model: "Activity", row: bad },
      ]),
    ).rejects.toThrow();
    expect(await db.getAll("Activity")).toHaveLength(0);
  });
});

describe("LocalDb: dirty tracking", () => {
  it("dirty() lists dirty rows oldest editedAt first; server rows are not dirty", async () => {
    await db.putLocal("Activity", activity("late", { editedAt: t(30) }));
    await db.putLocal("Activity", activity("early", { editedAt: t(10) }));
    await db.putFromServer("Activity", activity("synced", { editedAt: t(5) }));
    expect((await db.dirty("Activity")).map((r) => r.id)).toEqual(["early", "late"]);
    expect(await db.countDirty()).toBe(2);
  });

  it("clearDirtyIf clears when editedAt is unchanged", async () => {
    await db.putLocal("Activity", activity("a1", { editedAt: t(1) }));
    expect(await db.clearDirtyIf("Activity", "a1", t(1))).toBe(true);
    expect((await db.get("Activity", "a1"))?.dirty).toBe(0);
  });

  it("clearDirtyIf keeps dirty when the row was edited during the push (race)", async () => {
    await db.putLocal("Activity", activity("a1", { title: "sent", editedAt: t(1) }));
    // push starts with editedAt t(1); meanwhile the user types again
    await db.putLocal("Activity", activity("a1", { title: "typed during push", editedAt: t(2) }));
    expect(await db.clearDirtyIf("Activity", "a1", t(1))).toBe(false);
    expect(await db.get("Activity", "a1")).toMatchObject({ title: "typed during push", dirty: 1 });
  });

  it("clearDirtyIf on a missing row does nothing", async () => {
    expect(await db.clearDirtyIf("Flag", "nope", t(1))).toBe(false);
  });
});

describe("LocalDb: mergeFromServer (pull rule)", () => {
  it("inserts a row that does not exist locally, not dirty", async () => {
    expect(await db.mergeFromServer("Activity", activity("a1"))).toBe("inserted");
    expect((await db.get("Activity", "a1"))?.dirty).toBe(0);
  });

  it("a newer remote row replaces the local one and clears dirty", async () => {
    await db.putLocal("Activity", activity("a1", { title: "local", editedAt: t(1) }));
    expect(await db.mergeFromServer("Activity", activity("a1", { title: "remote", editedAt: t(2) }))).toBe(
      "replaced",
    );
    expect(await db.get("Activity", "a1")).toMatchObject({ title: "remote", dirty: 0 });
  });

  it("a newer local row is kept (still dirty, pushed next time)", async () => {
    await db.putLocal("Activity", activity("a1", { title: "local", editedAt: t(3) }));
    expect(await db.mergeFromServer("Activity", activity("a1", { title: "remote", editedAt: t(2) }))).toBe(
      "keptLocal",
    );
    expect(await db.get("Activity", "a1")).toMatchObject({ title: "local", dirty: 1 });
  });

  it("a tie goes to the server", async () => {
    await db.putLocal("Activity", activity("a1", { title: "local", editedAt: t(2) }));
    expect(await db.mergeFromServer("Activity", activity("a1", { title: "remote", editedAt: t(2) }))).toBe(
      "replaced",
    );
    expect((await db.get("Activity", "a1"))?.title).toBe("remote");
  });

  it("a newer remote tombstone beats a local edit; an older one loses", async () => {
    await db.putLocal("Activity", activity("a1", { editedAt: t(1) }));
    await db.mergeFromServer("Activity", activity("a1", { deletedAt: t(2), editedAt: t(2) }));
    expect((await db.get("Activity", "a1"))?.deletedAt).toBe(t(2));

    await db.putLocal("Activity", activity("a2", { title: "edited", editedAt: t(5) }));
    await db.mergeFromServer("Activity", activity("a2", { deletedAt: t(4), editedAt: t(4) }));
    expect(await db.get("Activity", "a2")).toMatchObject({ title: "edited", dirty: 1 });
    expect((await db.get("Activity", "a2"))?.deletedAt).toBeUndefined();
  });
});

describe("LocalDb: tombstones, meta, wipe", () => {
  it("purges synced tombstones older than the cutoff only", async () => {
    await db.putFromServer("Activity", activity("old", { deletedAt: t(1), editedAt: t(1) }));
    await db.putFromServer("Activity", activity("recent", { deletedAt: t(50), editedAt: t(50) }));
    await db.putLocal("Activity", activity("unsynced", { deletedAt: t(1), editedAt: t(1) }));
    await db.putFromServer("Activity", activity("alive"));
    expect(await db.purgeTombstones("Activity", t(10))).toBe(1);
    expect((await db.getAll("Activity")).map((r) => r.id).sort()).toEqual(["alive", "recent", "unsynced"]);
  });

  it("purgeForeign removes another owner's rows in every store, keeps own and owner-less rows", async () => {
    await db.putFromServer("Activity", { ...activity("mine"), owner: "sub-me" });
    await db.putFromServer("Activity", { ...activity("theirs"), owner: "sub-other" });
    await db.putLocal("Activity", { ...activity("theirsDirty"), owner: "sub-other" });
    await db.putLocal("Activity", activity("newHere")); // not pushed yet: no owner
    await db.putFromServer("Flag", { id: "f-theirs", name: "health", weight: 15, editedAt: t(1), owner: "sub-other" });
    await db.putFromServer("Flag", { id: "f-mine", name: "health", weight: 15, editedAt: t(1), owner: "sub-me" });
    expect(await db.purgeForeign("sub-me")).toBe(3);
    expect((await db.getAll("Activity")).map((r) => r.id).sort()).toEqual(["mine", "newHere"]);
    expect((await db.getAll("Flag")).map((r) => r.id)).toEqual(["f-mine"]);
    expect(await db.purgeForeign("sub-me")).toBe(0);
  });

  it("stores meta values", async () => {
    expect(await db.getMeta("ownerSub")).toBeUndefined();
    await db.setMeta("ownerSub", "sub-1");
    await db.setMeta("lastPulledAt:Activity", t(9));
    expect(await db.getMeta("ownerSub")).toBe("sub-1");
    expect(await db.getMeta("lastPulledAt:Activity")).toBe(t(9));
  });

  it("wipe removes every row and meta key", async () => {
    await db.putLocal("Activity", activity("a1"));
    await db.putLocal("Flag", flag("f1"));
    await db.setMeta("ownerSub", "sub-1");
    await db.wipe();
    expect(await db.getAll("Activity")).toEqual([]);
    expect(await db.getAll("Flag")).toEqual([]);
    expect(await db.getMeta("ownerSub")).toBeUndefined();
    expect(await db.countDirty()).toBe(0);
  });

  it("data survives closing and reopening the database (reload)", async () => {
    const name = `bacuyy-reopen-${n}`;
    const first = await openLocalDb(name);
    await first.putLocal("Activity", activity("a1", { rawInput: "sigue aquí" }));
    first.close();
    const second = await openLocalDb(name);
    expect((await second.get("Activity", "a1"))?.rawInput).toBe("sigue aquí");
    second.close();
  });
});
