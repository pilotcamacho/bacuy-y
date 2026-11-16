import { create } from "zustand";

/**
 * Service worker state for the UI (CLAUDE.md, PWA): a new version waiting, and the browser's
 * install prompt. `initPwa()` runs once from main.tsx; tests set the store directly.
 */

/** Chromium's install prompt event (not in the DOM typings). */
export interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

interface PwaState {
  /** A new version is installed and waiting; `update()` activates it and reloads. */
  needRefresh: boolean;
  installPrompt: InstallPromptEvent | null;
  /** Running as an installed app (standalone window). */
  installed: boolean;
  update: () => Promise<void>;
}

export const usePwaStore = create<PwaState>(() => ({
  needRefresh: false,
  installPrompt: null,
  installed: false,
  update: async () => {},
}));

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia?.("(display-mode: standalone)").matches === true || nav.standalone === true;
}

let started = false;

/** Registers the service worker (production builds only) and listens for the install prompt. */
export async function initPwa(): Promise<void> {
  if (started || typeof window === "undefined") return;
  started = true;
  usePwaStore.setState({ installed: isStandalone() });

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // shown from Settings instead of the browser's mini-bar
    usePwaStore.setState({ installPrompt: e as InstallPromptEvent });
  });
  window.addEventListener("appinstalled", () => usePwaStore.setState({ installPrompt: null, installed: true }));

  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  const { registerSW } = await import("virtual:pwa-register");
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh: () => usePwaStore.setState({ needRefresh: true }),
    onRegisterError: (e) => console.error("[bacuyy] service worker registration failed", e),
  });
  usePwaStore.setState({ update: () => updateSW(true) });
}
