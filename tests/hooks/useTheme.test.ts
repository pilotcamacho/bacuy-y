import { describe, expect, it } from "vitest";
import { applyTheme, readThemeMode, setThemeMode, themeTokens } from "@/hooks/useTheme";

describe("theme", () => {
  it("defaults to system", () => {
    expect(readThemeMode()).toBe("system");
  });

  it("persists the mode and toggles the dark class", () => {
    setThemeMode("dark");
    expect(localStorage.getItem("bacuyy_theme")).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    setThemeMode("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("system follows prefers-color-scheme (light in jsdom)", () => {
    applyTheme("system");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("updates meta theme-color", () => {
    const meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.appendChild(meta);
    applyTheme("dark");
    expect(meta.content).toBe(themeTokens.dark.background);
    meta.remove();
  });
});
