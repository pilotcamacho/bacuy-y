import { afterEach, describe, expect, it, vi } from "vitest";
import { kvGet, kvGetJson, kvRemove, kvSet, kvSetJson } from "@/lib/kv";

describe("kv", () => {
  afterEach(() => vi.restoreAllMocks());

  it("prefixes keys with bacuyy_", () => {
    kvSet("theme", "dark");
    expect(localStorage.getItem("bacuyy_theme")).toBe("dark");
    expect(kvGet("theme")).toBe("dark");
    kvRemove("theme");
    expect(kvGet("theme")).toBeNull();
  });

  it("round-trips JSON and falls back on bad JSON", () => {
    kvSetJson("obj", { a: 1 });
    expect(kvGetJson("obj", null)).toEqual({ a: 1 });
    localStorage.setItem("bacuyy_bad", "{nope");
    expect(kvGetJson("bad", "fallback")).toBe("fallback");
  });

  it("never throws when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("full");
    });
    expect(() => kvSet("x", "1")).not.toThrow();
    expect(kvGet("x")).toBeNull();
  });
});
