import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openLocalDb } from "@/lib/db";
import type { ActivityRow, LocalDb } from "@/lib/db/types";
import { activityFlagId, flagId } from "@/lib/ids";
import { kvRemove } from "@/lib/kv";
import { defaultFlagRows } from "@/services/flags/defaults";
import { getClockOffset, resetClockForTests } from "@/services/sync/clock";
import { leaseLock } from "@/services/sync/lock";
import { pull } from "@/services/sync/pull";
import { Backoff, push } from "@/services/sync/push";
import { createSyncEngine, type SyncSnapshot } from "@/services/sync/syncEngine";
import { FakeServer, memoryLock } from "./fakeServer";

/**
 * The sync engine against an in-memory server with the resolver's rules, and one real
 * (fake-indexeddb) LocalDb per "device". Covers CLAUDE.md, Workflow 4.
 */

const SUB = "14b83488-e001-703e-30a3-cefb7b703fd9";
const T = (minute: number) => new Date(Date.UTC(2026, 10, 14, 10, minute)).toISOString();

let server: FakeServer;
let n = 0;
const dbs: LocalDb[] = [];

async function device(): Promise<LocalDb> {
  const db = await openLocalDb(`bacuyy-sync-${++n}`);
  dbs.push(db);
  return db;
}

function engineFor(db: LocalDb, lock = memoryLock(), owner = SUB) {
  const states: SyncSnapshot[] = [];
  const engine = createSyncEngine({
    db: async () => db,
    remote: server.remote(owner),
    lock,
    canSync: () => true,
    isOnline: () => true,
    onState: (s) => states.push(s),
  });
  return { engine, states, sync: () => engine.requestSync("test") };
}

function activity(id: string, over: Partial<ActivityRow> = {}): ActivityRow {
  const title = over.title ?? id;
  return {
    id,
    title,
    rawInput: title,
    activityType: "ACTION",
    status: "DRAFT",
    position: "a0",
    editedAt: T(1),
    ...over,
  };
}

beforeEach(() => {
  server = new FakeServer();
  resetClockForTests();
});

afterEach(() => {
  dbs.splice(0).forEach((db) => db.close());
  kvRemove("syncLease");
});

describe("push", () => {
  it("upserts dirty rows and clears dirty; the server sets owner and timestamps", async () => {
    const a = await device();
    await a.putLocal("Activity", activity("x"));
    await engineFor(a).sync();
    expect((await a.get("Activity", "x"))!.dirty).toBe(0);
    expect(server.get("Activity", "x")).toMatchObject({ title: "x", owner: SUB });
    expect(server.get("Activity", "x")!.updatedAt).toBeTruthy();
  });

  it("an older edit is rejected (applied: false) and replaced locally by the server's", async () => {
    const a = await device();
    server.put("Activity", activity("x", { title: "from B", editedAt: T(5) }), SUB);
    await a.putLocal("Activity", activity("x", { title: "old A", editedAt: T(2) }));
    const report = await push(a, server.remote(SUB), new Backoff());
    expect(report).toMatchObject({ pushed: 0, rejected: 1 });
    expect(await a.get("Activity", "x")).toMatchObject({ title: "from B", dirty: 0 });
    expect(server.get("Activity", "x")!.title).toBe("from B");
  });

  it("a refused upsert does not move the clock (its updatedAt is the stored row's, maybe old)", async () => {
    const a = await device();
    server.put("Activity", activity("x", { editedAt: T(5) }), SUB);
    const stored = server.get("Activity", "x")!;
    server.tables.Activity.set("x", { ...stored, updatedAt: "2026-11-14T09:00:00.000Z" } as never); // hours ago
    await a.putLocal("Activity", activity("x", { editedAt: T(2) }));
    await push(a, server.remote(SUB), new Backoff());
    expect(getClockOffset()).toBe(0);
    // An applied write does sample (server time ≈ device time here).
    await a.putLocal("Activity", activity("y"));
    await push(a, server.remote(SUB), new Backoff());
    expect(Math.abs(getClockOffset())).toBeLessThan(1_000);
  });

  it("an edit made during the push keeps the row dirty and is pushed next time", async () => {
    const a = await device();
    await a.putLocal("Activity", activity("x", { title: "v1", editedAt: T(1) }));
    server.onUpsert = async () => {
      server.onUpsert = null;
      await a.putLocal("Activity", activity("x", { title: "v2", editedAt: T(2) }));
    };
    await push(a, server.remote(SUB), new Backoff());
    expect(await a.get("Activity", "x")).toMatchObject({ title: "v2", dirty: 1 });
    expect(server.get("Activity", "x")!.title).toBe("v1");

    await push(a, server.remote(SUB), new Backoff());
    expect(await a.get("Activity", "x")).toMatchObject({ title: "v2", dirty: 0 });
    expect(server.get("Activity", "x")!.title).toBe("v2");
  });

  it("refuses to overwrite another owner's row; the row stays dirty and the others still go", async () => {
    const a = await device();
    server.put("Activity", activity("taken", { title: "theirs", editedAt: T(1) }), "someone-else");
    await a.putLocal("Activity", activity("taken", { title: "mine", editedAt: T(9) }));
    await a.putLocal("Activity", activity("ok", { editedAt: T(9) }));
    const report = await push(a, server.remote(SUB), new Backoff());
    expect(report).toMatchObject({ pushed: 1, failed: 1 });
    expect(report.errors[0]!.kind).toBe("rejected");
    expect(server.get("Activity", "taken")).toMatchObject({ title: "theirs", owner: "someone-else" });
    expect((await a.get("Activity", "taken"))!.dirty).toBe(1);
    expect((await a.get("Activity", "ok"))!.dirty).toBe(0);
  });

  it("a failing row waits for its backoff before the next attempt", async () => {
    let clock = 0;
    const backoff = new Backoff(() => clock);
    const a = await device();
    server.put("Activity", activity("taken"), "someone-else");
    await a.putLocal("Activity", activity("taken", { editedAt: T(9) }));
    await push(a, server.remote(SUB), backoff);
    expect((await push(a, server.remote(SUB), backoff)).skipped).toBe(1);
    clock += 2_000;
    expect((await push(a, server.remote(SUB), backoff)).failed).toBe(1);
    clock += 2_000; // second failure waits 4 s
    expect((await push(a, server.remote(SUB), backoff)).skipped).toBe(1);
  });
});

describe("pull", () => {
  it("a newer local edit is kept (still dirty); an older one is replaced", async () => {
    const a = await device();
    server.put("Activity", activity("newer-local", { title: "server", editedAt: T(1) }), SUB);
    server.put("Activity", activity("older-local", { title: "server", editedAt: T(5) }), SUB);
    await a.putLocal("Activity", activity("newer-local", { title: "local", editedAt: T(3) }));
    await a.putLocal("Activity", activity("older-local", { title: "local", editedAt: T(3) }));
    await pull(a, server.remote(SUB));
    expect(await a.get("Activity", "newer-local")).toMatchObject({ title: "local", dirty: 1 });
    expect(await a.get("Activity", "older-local")).toMatchObject({ title: "server", dirty: 0 });
  });

  it("a tie goes to the server", async () => {
    const a = await device();
    server.put("Activity", activity("x", { title: "server", editedAt: T(3) }), SUB);
    await a.putLocal("Activity", activity("x", { title: "local", editedAt: T(3) }));
    await pull(a, server.remote(SUB));
    expect(await a.get("Activity", "x")).toMatchObject({ title: "server", dirty: 0 });
  });

  it("pages through every result and only asks for changes since the last pull", async () => {
    const a = await device();
    server.pageSize = 2;
    for (const id of ["a", "b", "c", "d", "e"]) server.put("Activity", activity(id), SUB);
    await pull(a, server.remote(SUB));
    expect((await a.getAll("Activity")).map((r) => r.id).sort()).toEqual(["a", "b", "c", "d", "e"]);
    expect(await a.getMeta("lastPulledAt:Activity")).toBeTruthy();

    // Second pull: lastPulledAt − 60 s still covers these rows (the overlap), but a row
    // last updated long before is not asked for again.
    const old = server.get("Activity", "a")!;
    server.tables.Activity.set("a", { ...old, updatedAt: "2000-01-01T00:00:00.000Z" } as never);
    const before = server.listCalls;
    await pull(a, server.remote(SUB));
    expect(server.listCalls - before).toBe(5); // Flag, ActivityFlag, Feedback: 1 each; Activity: b–e in 2 pages
  });

  it("only sees the owner's rows", async () => {
    const a = await device();
    server.put("Activity", activity("mine"), SUB);
    server.put("Activity", activity("theirs"), "someone-else");
    await pull(a, server.remote(SUB));
    expect((await a.getAll("Activity")).map((r) => r.id)).toEqual(["mine"]);
  });
});

describe("two devices, last edit wins", () => {
  it("an edit on A reaches B", async () => {
    const [a, b] = [await device(), await device()];
    await a.putLocal("Activity", activity("x", { title: "hola" }));
    await engineFor(a).sync();
    await engineFor(b).sync();
    expect(await b.get("Activity", "x")).toMatchObject({ title: "hola", dirty: 0 });
  });

  it("offline edits on both: the later edit wins on both devices", async () => {
    const [a, b] = [await device(), await device()];
    await a.putLocal("Activity", activity("x", { title: "base", editedAt: T(1) }));
    await engineFor(a).sync();
    await engineFor(b).sync();

    await a.putLocal("Activity", activity("x", { title: "A later", editedAt: T(8) }));
    await b.putLocal("Activity", activity("x", { title: "B earlier", editedAt: T(5) }));
    await engineFor(b).sync(); // B pushes first, but its edit is older
    await engineFor(a).sync();
    await engineFor(b).sync();
    for (const db of [a, b]) expect(await db.get("Activity", "x")).toMatchObject({ title: "A later", dirty: 0 });
  });

  it("a tombstone beats an older edit, and loses to a newer one", async () => {
    const [a, b] = [await device(), await device()];
    await a.putLocal("Activity", activity("x", { editedAt: T(1) }));
    await engineFor(a).sync();
    await engineFor(b).sync();

    await b.putLocal("Activity", activity("x", { deletedAt: T(6), editedAt: T(6) }));
    await a.putLocal("Activity", activity("x", { title: "edited", editedAt: T(4) }));
    await engineFor(b).sync();
    await engineFor(a).sync();
    expect((await a.get("Activity", "x"))!.deletedAt).toBe(T(6));

    await a.putLocal("Activity", activity("x", { title: "revived", deletedAt: null, editedAt: T(9) }));
    await engineFor(a).sync();
    await engineFor(b).sync();
    expect(server.get("Activity", "x")!.deletedAt).toBeUndefined(); // null removes the attribute
    expect(await b.get("Activity", "x")).toMatchObject({ title: "revived" });
    expect((await b.get("Activity", "x"))!.deletedAt ?? null).toBeNull();
  });

  it("both devices seeding the default flags end with one row per flag (deterministic ids)", async () => {
    const [a, b] = [await device(), await device()];
    const seed = defaultFlagRows(SUB);
    for (const db of [a, b]) await db.putManyLocal(seed.map((row) => ({ model: "Flag" as const, row })));
    // A reweights "fun" before syncing; B's seed must not undo it.
    const fun = seed.find((f) => f.name === "fun")!;
    await a.putLocal("Flag", { ...fun, weight: 40, editedAt: T(3) });

    await engineFor(a).sync();
    await engineFor(b).sync();
    expect(server.rows("Flag")).toHaveLength(10);
    expect(await b.get("Flag", flagId(SUB, "fun"))).toMatchObject({ weight: 40, dirty: 0 });
    expect(await b.countDirty()).toBe(0);
  });

  it("reconciles marks after a pull: links and status follow the text", async () => {
    const [a, b] = [await device(), await device()];
    const seed = defaultFlagRows(SUB);
    for (const db of [a, b]) await db.putManyLocal(seed.map((row) => ({ model: "Flag" as const, row })));
    // B wrote the text but (say, an older app) not the link nor the status.
    await b.putLocal("Activity", activity("run", { rawInput: "correr #salud", title: "correr #salud", status: "DRAFT", editedAt: T(2) }));
    await engineFor(b).sync();

    await engineFor(a).sync();
    const health = flagId(SUB, "health");
    expect(await a.get("Activity", "run")).toMatchObject({ title: "correr", status: "ACTIVE" });
    expect(await a.get("ActivityFlag", activityFlagId("run", health))).toMatchObject({ flagId: health });
    expect((await a.get("ActivityFlag", activityFlagId("run", health)))!.deletedAt ?? null).toBeNull();
    // The fix was pushed in the follow-up run of the same sync.
    expect(server.get("ActivityFlag", activityFlagId("run", health))).toBeTruthy();
    expect(server.get("Activity", "run")!.status).toBe("ACTIVE");
    expect(await a.countDirty()).toBe(0);
  });
});

describe("engine", () => {
  it("two tabs syncing at once never overlap, and each row is pushed once", async () => {
    const a = await device();
    for (const id of ["1", "2", "3"]) await a.putLocal("Activity", activity(id));
    const lock = memoryLock();
    const tab1 = engineFor(a, lock);
    const tab2 = engineFor(a, lock);
    await Promise.all([tab1.sync(), tab2.sync(), tab1.sync(), tab2.sync()]);
    expect(lock.stats.maxHolders).toBe(1);
    expect(lock.stats.runs).toBe(2); // one run per tab: repeated requests join the one queued
    expect(server.upsertCalls).toBe(3);
    expect(server.maxInFlight).toBeLessThanOrEqual(4);
  });

  it("triggers during a run are coalesced into one follow-up", async () => {
    const a = await device();
    await a.putLocal("Activity", activity("1"));
    const tab = engineFor(a);
    const first = tab.sync();
    await new Promise((r) => setTimeout(r, 0));
    const more = [tab.sync(), tab.sync(), tab.sync()];
    await Promise.all([first, ...more]);
    const runs = tab.states.filter((s) => s.status === "syncing").length;
    expect(runs).toBe(2);
  });

  it("offline → state offline, rows stay dirty; back online → synced", async () => {
    const a = await device();
    await a.putLocal("Activity", activity("1"));
    const tab = engineFor(a);
    server.offline = true;
    await tab.sync();
    expect(tab.engine.snapshot()).toMatchObject({ status: "offline", dirty: 1 });
    server.offline = false;
    await tab.sync();
    expect(tab.engine.snapshot()).toMatchObject({ status: "synced", dirty: 0, reason: null });
  });

  it("browser offline: no run, but the pending count still updates", async () => {
    const a = await device();
    let online = false;
    const states: SyncSnapshot[] = [];
    const engine = createSyncEngine({
      db: async () => a,
      remote: server.remote(SUB),
      lock: memoryLock(),
      canSync: () => true,
      isOnline: () => online,
      onState: (s) => states.push(s),
    });
    await a.putLocal("Activity", activity("1"));
    await a.putLocal("Activity", activity("2"));
    await engine.requestSync("localWrite");
    expect(engine.snapshot()).toMatchObject({ status: "offline", dirty: 2 });
    expect(states.some((s) => s.status === "syncing")).toBe(false);
    online = true;
    await engine.requestSync("online");
    expect(engine.snapshot()).toMatchObject({ status: "synced", dirty: 0 });
  });

  it("shows error only after repeated failed runs, and recovers", async () => {
    const a = await device();
    const tab = engineFor(a);
    server.failLists = true;
    const statuses: string[] = [];
    for (let i = 0; i < 3; i++) {
      await tab.sync();
      statuses.push(tab.engine.snapshot().status);
    }
    expect(statuses).toEqual(["offline", "offline", "error"]); // never synced yet: not "synced"
    expect(tab.engine.snapshot().reason).toBe("failures");
    server.failLists = false;
    await tab.sync();
    expect(tab.engine.snapshot()).toMatchObject({ status: "synced", reason: null });
    tab.engine.stop();
  });

  it("purges synced tombstones older than 30 days, never dirty ones", async () => {
    const a = await device();
    const old = new Date(Date.now() - 40 * 86_400_000).toISOString();
    await a.putFromServer("Activity", activity("gone", { deletedAt: old, editedAt: old }));
    await a.putLocal("Activity", activity("unsynced", { deletedAt: old, editedAt: old }));
    server.offline = false;
    const tab = engineFor(a);
    server.onUpsert = () => {
      throw new Error("boom"); // keep "unsynced" dirty
    };
    await tab.sync();
    tab.engine.stop();
    expect(await a.get("Activity", "gone")).toBeUndefined();
    expect(await a.get("Activity", "unsynced")).toBeTruthy();
  });
});

describe("lease lock (no navigator.locks)", () => {
  it("serializes two holders", async () => {
    const one = leaseLock(Date.now, (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 5))));
    const two = leaseLock(Date.now, (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 5))));
    let holders = 0;
    let max = 0;
    const work = async () => {
      holders++;
      max = Math.max(max, holders);
      await new Promise((r) => setTimeout(r, 10));
      holders--;
    };
    await Promise.all([one.run(work), two.run(work), one.run(work)]);
    expect(max).toBe(1);
  });
});
