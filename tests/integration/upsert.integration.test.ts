// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Real round trip against the sandbox (`npx ampx sandbox --identifier bacuyy-dev`).
 * Skipped unless a test account is set in .env.test.local (see .env.test.local.example).
 */
const email = process.env.BACUYY_TEST_EMAIL;
const password = process.env.BACUYY_TEST_PASSWORD;
const outputsPath = new URL("../../amplify_outputs.json", import.meta.url);

describe.skipIf(!email || !password || !existsSync(outputsPath))("upsert resolver (sandbox)", () => {
  it("enforces last edit wins", { timeout: 60_000 }, async () => {
    const { Amplify } = await import("aws-amplify");
    const { signIn, signOut } = await import("aws-amplify/auth");
    Amplify.configure(JSON.parse(readFileSync(outputsPath, "utf8")));
    await signOut().catch(() => undefined);
    await signIn({ username: email!, password: password! });
    try {
      const { runUpsertSelfTest } = await import("@/services/sync/diagnostics");
      const results = await runUpsertSelfTest();
      expect(results.filter((r) => !r.ok)).toEqual([]);
      expect(results.length).toBeGreaterThan(5);
    } finally {
      await signOut();
    }
  });
});
