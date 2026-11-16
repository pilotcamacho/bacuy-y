import { useCallback, useEffect, useSyncExternalStore } from "react";
import { kvGet, kvSet } from "@/lib/kv";

export type ThemeMode = "system" | "light" | "dark";
export const THEME_MODES: readonly ThemeMode[] = ["system", "light", "dark"];

const THEME_KEY = "theme";

/** Raw colors for places Tailwind classes cannot reach (meta theme-color, canvas). */
export const themeTokens = {
  light: { background: "#ffffff", text: "#171717", accent: "#6366f1" },
  dark: { background: "#0a0a0a", text: "#f5f5f5", accent: "#818cf8" },
} as const;

export function readThemeMode(): ThemeMode {
  const v = kvGet(THEME_KEY);
  return v === "light" || v === "dark" || v === "system" ? v : "system";
}

function systemPrefersDark(): boolean {
  return globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

export function resolveTheme(mode: ThemeMode): "light" | "dark" {
  if (mode === "system") return systemPrefersDark() ? "dark" : "light";
  return mode;
}

/** Puts the `dark` class on <html> and updates <meta name="theme-color">. */
export function applyTheme(mode: ThemeMode) {
  const resolved = resolveTheme(mode);
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.style.colorScheme = resolved;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", themeTokens[resolved].background);
}

// Tiny external store so every component sees the same mode.
const listeners = new Set<() => void>();
let currentMode: ThemeMode = readThemeMode();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setThemeMode(mode: ThemeMode) {
  currentMode = mode;
  kvSet(THEME_KEY, mode);
  applyTheme(mode);
  listeners.forEach((l) => l());
}

export function useTheme() {
  const mode = useSyncExternalStore(subscribe, () => currentMode, () => currentMode);

  // Follow OS changes while in "system" mode.
  useEffect(() => {
    applyTheme(mode);
    if (mode !== "system") return;
    const mq = globalThis.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [mode]);

  const setMode = useCallback((m: ThemeMode) => setThemeMode(m), []);
  return { mode, resolved: resolveTheme(mode), setMode, tokens: themeTokens[resolveTheme(mode)] };
}
