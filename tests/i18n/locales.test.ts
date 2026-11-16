import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SUPPORTED_LOCALES } from "@/lib/i18n";

const dir = join(__dirname, "../../src/locales");

function flatKeys(obj: unknown, prefix = ""): string[] {
  if (typeof obj !== "object" || obj === null) return [prefix];
  return Object.entries(obj).flatMap(([k, v]) => flatKeys(v, prefix ? `${prefix}.${k}` : k));
}

function load(code: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, `${code}.json`), "utf8")) as Record<string, unknown>;
}

describe("locale files", () => {
  it("has exactly one file per supported locale", () => {
    const files = readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => f.replace(".json", ""));
    expect(files.sort()).toEqual([...SUPPORTED_LOCALES].sort());
  });

  const reference = flatKeys(load("es")).sort();

  it.each(SUPPORTED_LOCALES.filter((l) => l !== "es"))("%s has the same keys as es", (code) => {
    expect(flatKeys(load(code)).sort()).toEqual(reference);
  });

  it.each(SUPPORTED_LOCALES)("%s has only non-empty string values", (code) => {
    const data = load(code);
    const bad = flatKeys(data).filter((key) => {
      const value = key
        .split(".")
        .reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], data);
      return typeof value !== "string" || value.trim() === "";
    });
    expect(bad).toEqual([]);
  });
});
