import { describe, expect, it } from "vitest";
import type { ActivityRow } from "@/lib/db/types";
import { boughtLines, hiddenLines, pageLines } from "@/services/editor/pageLines";
import { canComplete, statusActions } from "@/services/lifecycle/status";
import { tick, tickIsClickable } from "@/services/lifecycle/tick";
import { parseLine } from "@/services/marks";
import { isPriorityCandidate } from "@/services/priority/score";
import { withGroceryMark } from "@/stores/pageStore";
import { CTX } from "../marks/fixtures";

/** GROCERY (bacuy-y only): the shopping list. Bought = hidden until put back; never completed. */

const NOW = new Date(2026, 10, 24, 18, 0);
const g = (over: Partial<ActivityRow> = {}) =>
  ({
    id: "g",
    title: "leche",
    rawInput: "leche !mercado",
    activityType: "GROCERY",
    status: "ACTIVE",
    position: "a0",
    editedAt: "2026-11-01T00:00:00.000Z",
    deletedAt: null,
    isHidden: false,
    hiddenUntil: null,
    ...over,
  }) as ActivityRow;

describe("GROCERY", () => {
  it("is written !mercado / !compra / !grocery / !shopping", () => {
    for (const word of ["mercado", "compra", "grocery", "shopping", "Mercado"]) {
      expect(parseLine(`leche !${word}`, CTX).activityType).toBe("GROCERY");
    }
  });

  it("the tick means bought: hidden until shown again, with when and how many times", () => {
    const r = tick(g({ completionCount: 2 }), false, NOW);
    expect(r).toEqual({
      kind: "update",
      patch: { isHidden: true, hiddenUntil: null, completedAt: NOW.toISOString(), completionCount: 3 },
      hidden: true,
      grocery: true,
    });
    expect(tickIsClickable(g())).toBe(true);
  });

  it("is never completed (no Complete in the panel)", () => {
    expect(canComplete(g())).toBe(false);
    expect(statusActions(g())).toEqual(["pause", "archive"]);
    expect(statusActions(g({ activityType: "ACTION" }))).toEqual(["pause", "complete", "archive"]);
  });

  it("is not in Priority nor on Hidden; bought items are listed A→Z for the Mercado tab", () => {
    expect(isPriorityCandidate(g(), NOW)).toBe(false);
    const rows = {
      a: g({ id: "a", title: "leche" }),
      b: g({ id: "b", title: "Arroz", isHidden: true }),
      c: g({ id: "c", title: "azúcar", isHidden: true }),
      d: g({ id: "d", title: "pan", hiddenUntil: "2026-12-01T00:00:00.000Z" }),
      e: g({ id: "e", title: "pagar luz", activityType: "ACTION", isHidden: true }),
      f: g({ id: "f", title: "viejo", isHidden: true, status: "ARCHIVED" }),
    };
    expect(hiddenLines(rows, NOW).map((r) => r.id)).toEqual(["e"]);
    expect(boughtLines(rows, NOW).map((r) => r.title)).toEqual(["Arroz", "azúcar", "pan"]);
    // On the page model it is a normal line: the page editor leaves it out by scope.
    expect(pageLines(rows, NOW).map((l) => l.id)).toEqual(["a"]);
  });

  it("a line typed on the Mercado tab gets !mercado, unless it already says its type", () => {
    expect(withGroceryMark("", CTX, "es")).toBe(" !mercado");
    expect(withGroceryMark("huevos ", CTX, "es")).toBe("huevos !mercado");
    expect(withGroceryMark("eggs", CTX, "en")).toBe("eggs !grocery");
    expect(withGroceryMark("pan !compra", CTX, "es")).toBe("pan !compra");
    expect(withGroceryMark("llamar !tarea", CTX, "es")).toBe("llamar !tarea");
  });
});
