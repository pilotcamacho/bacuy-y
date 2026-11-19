import { describe, expect, it } from "vitest";
import { foldText, matchesText, queryWords } from "@/services/editor/textFilter";

describe("text filter", () => {
  it("folds case and accents", () => {
    expect(foldText("Ñandú ÁRBOL")).toBe("nandu arbol");
  });

  it("every word must appear somewhere in the line; marks count as text", () => {
    const line = "Renovar el pasaporte @2027-03-01 #trámites !vence";
    expect(matchesText(line, queryWords("pasa"))).toBe(true);
    expect(matchesText(line, queryWords("  PORTE  renov "))).toBe(true);
    expect(matchesText(line, queryWords("#tramites"))).toBe(true);
    expect(matchesText(line, queryWords("pasaporte visa"))).toBe(false);
  });

  it("an empty query matches everything", () => {
    expect(queryWords("   ")).toEqual([]);
    expect(matchesText("anything", [])).toBe(true);
  });
});
