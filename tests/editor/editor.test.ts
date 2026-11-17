import { describe, expect, it } from "vitest";
import {
  compareLines,
  deleteEmpty,
  insertEmpty,
  mergeDown,
  mergeUp,
  moveLine,
  pasteText,
  positionAfter,
  setText,
  splitLine,
  type EditorLine,
} from "@/services/editor";

function counter() {
  let n = 0;
  return () => `new${++n}`;
}

const L = (id: string, rawInput: string, position: string): EditorLine => ({ id, rawInput, position });

const page = () => [L("a", "uno", "a0"), L("b", "dos", "a1"), L("c", "tres", "a2")];

const texts = (lines: EditorLine[]) => lines.map((l) => l.rawInput);
const isSorted = (lines: EditorLine[]) =>
  lines.every((l, i) => i === 0 || compareLines(lines[i - 1]!, l) < 0);

describe("positions", () => {
  it("compareLines orders by position, then id", () => {
    const sorted = [L("z", "", "a1"), L("b", "", "a0"), L("a", "", "a1")].sort(compareLines);
    expect(sorted.map((l) => l.id)).toEqual(["b", "a", "z"]);
  });

  it("positionAfter fits between neighbours, at the top and at the end", () => {
    const lines = page();
    const mid = positionAfter(lines, 0);
    expect(mid > "a0" && mid < "a1").toBe(true);
    expect(positionAfter(lines, -1) < "a0").toBe(true);
    expect(positionAfter(lines, 2) > "a2").toBe(true);
    expect(positionAfter([], -1)).toBeTruthy();
  });

  it("skips an equal neighbour position (two devices inserted at the same spot)", () => {
    const lines = [L("a", "", "a0"), L("b", "", "a0"), L("c", "", "a1")];
    const p = positionAfter(lines, 0);
    expect(p > "a0" && p < "a1").toBe(true);
  });
});

describe("splitLine (Enter)", () => {
  it("in the middle: current keeps the text before, a new row gets the rest", () => {
    const r = splitLine(page(), 1, 2, counter());
    expect(texts(r.lines)).toEqual(["uno", "do", "s", "tres"]);
    expect(r.created).toEqual(["new1"]);
    expect(r.changed.map((l) => l.id)).toEqual(["b", "new1"]);
    expect(r.focus).toEqual({ id: "new1", offset: 0 });
    expect(isSorted(r.lines)).toBe(true);
  });

  it("at the end: an empty line below, the current row is not rewritten", () => {
    const r = splitLine(page(), 2, 4, counter());
    expect(texts(r.lines)).toEqual(["uno", "dos", "tres", ""]);
    expect(r.changed.map((l) => l.id)).toEqual(["new1"]);
    expect(isSorted(r.lines)).toBe(true);
  });

  it("at the start: an empty row above; the line keeps its row and the caret", () => {
    const r = splitLine(page(), 1, 0, counter());
    expect(texts(r.lines)).toEqual(["uno", "", "dos", "tres"]);
    expect(r.lines[2]!.id).toBe("b"); // the text keeps its row (type, panel fields, history)
    expect(r.changed.map((l) => l.id)).toEqual(["new1"]); // and is not rewritten
    expect(r.created).toEqual(["new1"]);
    expect(r.focus).toEqual({ id: "b", offset: 0 });
    expect(isSorted(r.lines)).toBe(true);
    // At the top of the page too.
    const top = splitLine(page(), 0, 0, counter());
    expect(texts(top.lines)).toEqual(["", "uno", "dos", "tres"]);
    expect(top.lines[1]!.id).toBe("a");
    expect(isSorted(top.lines)).toBe(true);
  });

  it("Enter at the start then Backspace: the empty row goes, the line keeps its row", () => {
    const split = splitLine(page(), 1, 0, counter());
    const merged = mergeUp(split.lines, 2);
    expect(texts(merged.lines)).toEqual(["uno", "dos", "tres"]);
    expect(merged.lines[1]!.id).toBe("b");
    expect(merged.deleted).toEqual(["new1"]);
    expect(merged.changed).toEqual([]);
    expect(merged.focus).toEqual({ id: "b", offset: 0 });
  });

  it("marks travel with the text they are in", () => {
    const r = splitLine([L("a", "pan #recados leche #salud", "a0")], 0, 13, counter());
    expect(texts(r.lines)).toEqual(["pan #recados ", "leche #salud"]);
  });
});

describe("insertEmpty", () => {
  it("inserts at the top and focuses the new row", () => {
    const r = insertEmpty(page(), -1, counter());
    expect(r.lines[0]).toMatchObject({ id: "new1", rawInput: "" });
    expect(isSorted(r.lines)).toBe(true);
  });
});

describe("mergeUp / mergeDown (Backspace at start, Delete at end)", () => {
  it("Enter then Backspace gives back exactly the original line (no extra space)", () => {
    const split = splitLine([L("a", "pan leche", "a0")], 0, 3, counter());
    expect(texts(split.lines)).toEqual(["pan", " leche"]);
    const merged = mergeUp(split.lines, 1);
    expect(texts(merged.lines)).toEqual(["pan leche"]);
    expect(merged.focus).toEqual({ id: "a", offset: 3 });
  });

  it("joins with one space; the line above keeps its id; the current one is deleted", () => {
    const r = mergeUp(page(), 1);
    expect(texts(r.lines)).toEqual(["uno dos", "tres"]);
    expect(r.lines[0]!.id).toBe("a");
    expect(r.deleted).toEqual(["b"]);
    expect(r.changed.map((l) => l.id)).toEqual(["a"]);
    expect(r.focus).toEqual({ id: "a", offset: 4 });
  });

  it("no extra space when one side is empty or already ends with a space", () => {
    expect(texts(mergeUp([L("a", "", "a0"), L("b", "x", "a1")], 1).lines)).toEqual(["x"]);
    expect(texts(mergeUp([L("a", "x ", "a0"), L("b", "y", "a1")], 1).lines)).toEqual(["x y"]);
    const r = mergeUp([L("a", "x", "a0"), L("b", "", "a1")], 1);
    expect(texts(r.lines)).toEqual(["x"]);
    expect(r.changed).toEqual([]);
  });

  it("on the first line it does nothing", () => {
    const r = mergeUp(page(), 0);
    expect(r.lines).toEqual(page());
    expect(r.deleted).toEqual([]);
  });

  it("mergeDown merges the next line into this one", () => {
    const r = mergeDown(page(), 0);
    expect(texts(r.lines)).toEqual(["uno dos", "tres"]);
    expect(r.deleted).toEqual(["b"]);
    expect(mergeDown(page(), 2).deleted).toEqual([]);
  });
});

describe("deleteEmpty (Backspace on an empty line)", () => {
  it("removes the line and focuses the end of the line above", () => {
    const lines = [L("a", "uno", "a0"), L("b", "", "a1"), L("c", "tres", "a2")];
    const r = deleteEmpty(lines, 1);
    expect(texts(r.lines)).toEqual(["uno", "tres"]);
    expect(r.deleted).toEqual(["b"]);
    expect(r.focus).toEqual({ id: "a", offset: 3 });
  });

  it("on the first line it focuses the line below", () => {
    const r = deleteEmpty([L("a", "", "a0"), L("b", "dos", "a1")], 0);
    expect(r.focus).toEqual({ id: "b", offset: 0 });
  });

  it("never removes the last remaining line", () => {
    const r = deleteEmpty([L("a", "", "a0")], 0);
    expect(r.lines).toHaveLength(1);
    expect(r.deleted).toEqual([]);
  });
});

describe("pasteText", () => {
  it("single-line paste replaces the selection", () => {
    const r = pasteText(page(), 0, 1, 2, "XYZ");
    expect(texts(r.lines)[0]).toBe("uXYZo");
    expect(r.focus).toEqual({ id: "a", offset: 4 });
  });

  it("multi-line paste: first part at the caret, one new row per following line, tail at the end", () => {
    const r = pasteText([L("a", "ab", "a0"), L("z", "fin", "a1")], 0, 1, 1, "1\n2\r\n\n3", counter());
    expect(texts(r.lines)).toEqual(["a1", "2", "3b", "fin"]);
    expect(r.created).toEqual(["new1", "new2"]);
    expect(r.changed.map((l) => l.id)).toEqual(["a", "new1", "new2"]);
    expect(r.focus).toEqual({ id: "new2", offset: 1 });
    expect(isSorted(r.lines)).toBe(true);
  });

  it("a paste whose extra lines are all empty stays on one line", () => {
    const r = pasteText([L("a", "ab", "a0")], 0, 1, 1, "x\n\n");
    expect(texts(r.lines)).toEqual(["axb"]);
    expect(r.created).toEqual([]);
  });

  it("many lines keep their order", () => {
    const lines = Array.from({ length: 20 }, (_, i) => `l${i}`);
    const r = pasteText([L("a", "", "a0"), L("b", "end", "a1")], 0, 0, 0, lines.join("\n"), counter());
    expect(texts(r.lines)).toEqual([...lines, "end"]);
    expect(isSorted(r.lines)).toBe(true);
  });
});

describe("moveLine (Alt+↑/↓, drag)", () => {
  it("moves down and up; only the moved row changes", () => {
    const down = moveLine(page(), 0, 2);
    expect(texts(down.lines)).toEqual(["dos", "tres", "uno"]);
    expect(down.changed.map((l) => l.id)).toEqual(["a"]);
    expect(isSorted(down.lines)).toBe(true);

    const up = moveLine(page(), 2, 0);
    expect(texts(up.lines)).toEqual(["tres", "uno", "dos"]);
    expect(isSorted(up.lines)).toBe(true);

    const oneStep = moveLine(page(), 1, 2);
    expect(texts(oneStep.lines)).toEqual(["uno", "tres", "dos"]);
    expect(isSorted(oneStep.lines)).toBe(true);
  });

  it("out of range or same place does nothing", () => {
    expect(moveLine(page(), 0, 0).changed).toEqual([]);
    expect(moveLine(page(), 0, -1).changed).toEqual([]);
    expect(moveLine(page(), 2, 3).changed).toEqual([]);
  });

  it("a long run of moves keeps the order consistent", () => {
    let lines = page();
    for (let i = 0; i < 200; i++) lines = moveLine(lines, i % 3, (i * 7) % 3).lines;
    expect(isSorted(lines)).toBe(true);
    expect(lines).toHaveLength(3);
  });
});

describe("setText", () => {
  it("never stores a newline", () => {
    const r = setText(page(), 0, "a\nb");
    expect(r.lines[0]!.rawInput).toBe("a b");
  });

  it("no change → nothing to write", () => {
    expect(setText(page(), 0, "uno").changed).toEqual([]);
  });
});
