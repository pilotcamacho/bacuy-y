import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Integration tests run in the node environment: no window, no localStorage.
const isBrowser = typeof window !== "undefined";

// jsdom has no matchMedia; default to a light-scheme OS.
if (isBrowser && !window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

afterEach(() => {
  if (!isBrowser) return;
  cleanup();
  localStorage.clear();
});
