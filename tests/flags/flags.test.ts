import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openLocalDb } from "@/lib/db";
import { setDbForTests } from "@/lib/db/instance";
import type { ActivityRow, FlagRow, LocalDb } from "@/lib/db/types";
import { activityFlagId, flagId } from "@/lib/ids";
import { defaultFlagRows, missingDefaultFlags } from "@/services/flags/defaults";
import { buildTree, cascadeDelete, driftGroups, nameProblem, subtreeIds, sumsTo100 } from "@/services/flags/tree";
import { resetEventsForTests } from "@/lib/events";
import { resetFlagStore, useFlagStore } from "@/stores/flagStore";
import { resetPageStoreForTests, usePageStore } from "@/stores/pageStore";

/** Phase 9: seeding, cascade delete, weight validation, and lines re-parsed on flag changes. */

const SUB = "sub-flags";
const HEALTH = flagId(SUB, "health");
const INCOME = flagId(SUB, "income");
const SALARY = flagId(SUB, "income/salary");

let db: LocalDb;
let n = 0;

const line = (id: string, rawInput: string, position = "a0"): ActivityRow => ({
  id,
  title: rawInput,
  rawInput,
  activityType: "ACTION",
  status: "DRAFT",
  position,
  editedAt: "2026-11-14T00:00:00.000Z",
  deletedAt: null,
});

const flag = (id: string, weight: number, parentId: string | null = null, name = id): FlagRow => ({
  id,
  name,
  parentId,
  weight,
  isSystemDefault: false,
  editedAt: "2026-11-14T00:00:00.000Z",
  deletedAt: null,
});

const store = useFlagStore.getState;

beforeEach(async () => {
  db = await openLocalDb(`bacuyy-flags-${++n}`);
  setDbForTests(db);
  resetFlagStore();
  resetPageStoreForTests();
});

afterEach(() => {
  db.close();
  setDbForTests(null);
  resetEventsForTests();
});

describe("tree rules (pure)", () => {
  it("builds the tree heaviest first and shows an orphan as a root", () => {
    const tree = buildTree([flag("a", 30), flag("b", 70), flag("c", 100, "a"), flag("orphan", 0, "gone")]);
    expect(tree.map((n) => n.flag.id)).toEqual(["b", "a", "orphan"]);
    expect(tree[1]!.children.map((n) => n.flag.id)).toEqual(["c"]);
  });

  it("finds the groups whose weights drifted from 100", () => {
    expect(driftGroups(defaultFlagRows(SUB))).toEqual([]);
    const drifted = defaultFlagRows(SUB).map((f) => (f.id === SALARY ? { ...f, weight: 60 } : f));
    expect(driftGroups(drifted)).toEqual([INCOME]);
    expect(sumsTo100([33.33, 33.33, 33.34])).toBe(true);
    expect(sumsTo100([33.3, 33.3, 33.3])).toBe(false);
  });

  it("checks names: empty, slash, and taken by a sibling or a system flag's alias", () => {
    const flags = defaultFlagRows(SUB);
    expect(nameProblem("  ", null, flags)).toBe("empty");
    expect(nameProblem("a/b", null, flags)).toBe("slash");
    expect(nameProblem("Salud", null, flags)).toBe("taken"); // alias of the system flag `health`
    expect(nameProblem("Salud", INCOME, flags)).toBeNull(); // another group: the path tells them apart
    expect(nameProblem("Gimnasio", null, flags)).toBeNull();
  });

  it("cascade delete covers descendants and their live links, never a system flag", () => {
    const rows = [flag("p", 50), flag("c", 100, "p"), flag("g", 100, "c"), flag("other", 50)];
    expect([...subtreeIds("p", rows)].sort()).toEqual(["c", "g", "p"]);
    const links = [
      { id: "l1", activityId: "x", flagId: "g", editedAt: "2026-11-14T00:00:00.000Z", deletedAt: null },
      { id: "l2", activityId: "x", flagId: "other", editedAt: "2026-11-14T00:00:00.000Z", deletedAt: null },
    ];
    const ops = cascadeDelete("p", rows, links, "2026-11-15T00:00:00.000Z");
    expect(ops.map((o) => o.row.id).sort()).toEqual(["c", "g", "l1", "p"]);
    expect(ops.every((o) => o.row.deletedAt === "2026-11-15T00:00:00.000Z")).toBe(true);
    expect(cascadeDelete(HEALTH, defaultFlagRows(SUB), [], "2026-11-15T00:00:00.000Z")).toEqual([]);
  });
});

describe("seeding", () => {
  it("is idempotent: loading twice keeps the same 10 rows", async () => {
    await store().load(SUB);
    resetFlagStore();
    await store().load(SUB);
    const all = await db.getAll("Flag");
    expect(all).toHaveLength(10);
    expect(missingDefaultFlags(SUB, all)).toEqual([]);
  });

  it("two devices seeding offline create the same ids", async () => {
    await store().load(SUB);
    const other = await openLocalDb(`bacuyy-flags-other-${n}`);
    setDbForTests(other);
    resetFlagStore();
    await store().load(SUB);
    const a = (await db.getAll("Flag")).map((f) => f.id).sort();
    const b = (await other.getAll("Flag")).map((f) => f.id).sort();
    expect(b).toEqual(a);
    other.close();
  });

  it("never revives a default flag the user deleted", async () => {
    await store().load(SUB);
    const health = (await db.get("Flag", HEALTH))!;
    await db.putFromServer("Flag", { ...health, deletedAt: "2026-11-14T00:00:00.000Z" });
    resetFlagStore();
    await store().load(SUB);
    expect((await db.get("Flag", HEALTH))!.deletedAt).toBe("2026-11-14T00:00:00.000Z");
    expect(store().flags.some((f) => f.id === HEALTH)).toBe(false);
  });
});

describe("weights", () => {
  beforeEach(() => store().load(SUB));

  it("refuses to save a group that does not sum to 100, and writes nothing", async () => {
    const before = await db.countDirty();
    expect(await store().saveWeights(INCOME, { [SALARY]: 60 })).toBe("sum");
    expect(await store().saveWeights(INCOME, { [SALARY]: -10, [flagId(SUB, "income/project")]: 90 })).toBe("invalid");
    expect(await store().saveWeights(INCOME, { [SALARY]: Number.NaN })).toBe("invalid");
    expect(await db.countDirty()).toBe(before);
    expect((await db.get("Flag", SALARY))!.weight).toBe(50);
  });

  it("saves a group that sums to 100 (only the rows that changed)", async () => {
    const project = flagId(SUB, "income/project");
    const rent = flagId(SUB, "income/rent");
    expect(await store().saveWeights(INCOME, { [SALARY]: 60, [project]: 20, [rent]: 20 })).toBeNull();
    expect((await db.get("Flag", SALARY))!.weight).toBe(60);
    expect((await db.get("Flag", project))!.weight).toBe(20);
    expect((await db.get("Flag", rent))!.editedAt).toBe("1970-01-01T00:00:00.000Z"); // unchanged, not rewritten
    expect((await db.get("Flag", SALARY))!.dirty).toBe(1);
  });

  it("a new flag keeps the sum: the first child takes 100, later ones 0", async () => {
    const first = await store().create("Gimnasio", HEALTH);
    const second = await store().create("Correr", HEALTH);
    if (!("id" in first) || !("id" in second)) throw new Error("not created");
    expect((await db.get("Flag", first.id))!.weight).toBe(100);
    expect((await db.get("Flag", second.id))!.weight).toBe(0);
    const root = await store().create("Viajes", null);
    if (!("id" in root)) throw new Error("not created");
    expect((await db.get("Flag", root.id))!.weight).toBe(0);
    expect(driftGroups(store().flags)).toEqual([]);
  });

  it("two quick creates (not awaited) see each other: one 100, one 0; a duplicate is refused", async () => {
    const [a, b, dup] = await Promise.all([
      store().create("Gimnasio", HEALTH),
      store().create("Correr", HEALTH),
      store().create("correr", HEALTH),
    ]);
    if (!("id" in a) || !("id" in b)) throw new Error("not created");
    expect((await db.get("Flag", a.id))!.weight).toBe(100);
    expect((await db.get("Flag", b.id))!.weight).toBe(0);
    expect(dup).toEqual({ problem: "taken" });
  });
});

describe("flag changes re-parse every line", () => {
  beforeEach(async () => {
    await db.putLocal("Activity", line("x", "nadar #natación"));
    await db.putLocal("Activity", line("y", "pagar #salario", "a1"));
    await usePageStore.getState().load(SUB);
    await store().load(SUB);
  });

  const activity = (id: string) => db.get("Activity", id);
  const linkOf = (activityId: string, fid: string) => db.get("ActivityFlag", activityFlagId(activityId, fid));

  it("creating a flag resolves the marks that name it", async () => {
    expect((await activity("x"))!.status).toBe("DRAFT");
    const result = await store().create("Natación", HEALTH);
    if (!("id" in result)) throw new Error("not created");
    expect((await activity("x"))!.status).toBe("ACTIVE");
    expect((await linkOf("x", result.id))?.deletedAt ?? null).toBeNull();
    // The page on screen follows.
    expect(usePageStore.getState().activities["x"]!.status).toBe("ACTIVE");
  });

  it("renaming a flag unresolves the old name and resolves the new one", async () => {
    const result = await store().create("natación", null);
    if (!("id" in result)) throw new Error("not created");
    expect(await store().rename(result.id, "piscina")).toBeNull();
    expect((await activity("x"))!.status).toBe("DRAFT");
    expect((await activity("x"))!.rawInput).toBe("nadar #natación"); // text is never rewritten
    expect((await linkOf("x", result.id))!.deletedAt).not.toBeNull();
    expect(await store().rename(result.id, "Salud")).toBe("taken");
  });

  it("system flags cannot be renamed or deleted", async () => {
    expect(await store().rename(SALARY, "sueldo")).toBeNull();
    await store().remove(SALARY);
    const salary = (await db.get("Flag", SALARY))!;
    expect(salary.name).toBe("salary");
    expect(salary.deletedAt ?? null).toBeNull();
    expect((await activity("y"))!.status).toBe("ACTIVE");
  });

  it("deleting a flag soft-deletes its subtree and links; the line keeps its text and becomes DRAFT", async () => {
    const parent = await store().create("Deporte", null);
    if (!("id" in parent)) throw new Error("not created");
    const child = await store().create("natación", parent.id);
    if (!("id" in child)) throw new Error("not created");
    expect((await activity("x"))!.status).toBe("ACTIVE");

    await store().remove(parent.id);
    expect((await db.get("Flag", parent.id))!.deletedAt).not.toBeNull();
    expect((await db.get("Flag", child.id))!.deletedAt).not.toBeNull();
    expect((await linkOf("x", child.id))!.deletedAt).not.toBeNull();
    const x = (await activity("x"))!;
    expect(x.status).toBe("DRAFT");
    expect(x.rawInput).toBe("nadar #natación");
    expect(store().flags.some((f) => f.id === parent.id || f.id === child.id)).toBe(false);
    expect(usePageStore.getState().flags.some((f) => f.id === child.id)).toBe(false);
  });
});
