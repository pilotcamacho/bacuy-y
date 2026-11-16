/// <reference types="vitest/config" />
import { fileURLToPath, URL } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // "prompt", not "autoUpdate": a silent reload could lose text still in its 300 ms
      // debounce. The app shows "new version" and saves pending text before reloading.
      registerType: "prompt",
      injectRegister: false, // registered from src/lib/pwa.ts
      manifest: {
        name: "bacuy-y",
        short_name: "bacuy-y",
        description: "Una página de texto donde cada renglón es una actividad. Funciona sin conexión.",
        lang: "es",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#ffffff",
        theme_color: "#ffffff",
        icons: [
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
          { src: "maskable-icon-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // The app shell and every built asset (revisioned URLs); any route → index.html.
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2,webmanifest}"],
        navigateFallback: "/index.html",
        // First install: control the open page at once, so it works offline without a reload.
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
    }),
  ],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    // Test account for the gated integration tests: BACUYY_TEST_* from .env.test.local
    // (git-ignored). Only process.env in tests; never part of the app bundle (not VITE_*).
    env: loadEnv("test", process.cwd(), "BACUYY_TEST_"),
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
    // The UI tests type character by character; with every jsdom file running in parallel a
    // slow machine passes 5 s, and a timed-out test's typing then leaks into the next one.
    testTimeout: 20_000,
  },
});
