import { defineConfig, devices } from "@playwright/test";
import { loadEnv } from "vite";

// Test account for the gated specs: BACUYY_TEST_* from .env.test.local (git-ignored).
// Variables already set in the shell win.
for (const [key, value] of Object.entries(loadEnv("test", process.cwd(), "BACUYY_TEST_"))) {
  process.env[key] ??= value;
}

const PORT = 4173;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  use: { baseURL: `http://localhost:${PORT}`, trace: "on-first-retry" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "npm run build && npm run preview",
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
