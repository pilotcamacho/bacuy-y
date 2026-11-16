// @vitest-environment node
import "fake-indexeddb/auto";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The sync engine against the real sandbox: device A pushes a line, device B (another local
 * database) pulls it, A deletes it, B pulls the tombstone. Skipped unless a test account is
 * set in .env.test.local (see .env.test.local.example).
 */
const email = process.env.BACUYY_TEST_EMAIL;
const password = process.env.BACUYY_TEST_PASSWORD;
const outputsPath = new URL("../../amplify_outputs.json", import.meta.url);

describe.skipIf(!email || !password || !existsSync(outputsPath))("sync engine (sandbox)", () => {
  it("push from A, pull on B, tombstone reaches B", { timeout: 120_000 }, async () => {
    const { Amplify } = await import("aws-amplify");
    const { signIn, signOut } = await import("aws-amplify/auth");
    Amplify.configure(JSON.parse(readFileSync(outputsPath, "utf8")));
    await signOut().catch(() => undefined);
    await signIn({ username: email!, password: password! });

    const { openLocalDb } = await import("@/lib/db");
    const { appsyncRemote } = await import("@/services/sync/appsyncRemote");
    const { createSyncEngine } = await import("@/services/sync/syncEngine");
    const lock = { run: <T,>(work: () => Promise<T>) => work() };
    const run = async (name: string) => {
      const db = await openLocalDb(name);
      const engine = createSyncEngine({ db: async () => db, remote: appsyncRemote, lock, canSync: () => true, isOnline: () => true });
      return { db, sync: () => engine.requestSync("test"), state: () => engine.snapshot() };
    };

    const a = await run(`it-a-${Date.now()}`);
    const b = await run(`it-b-${Date.now()}`);
    const id = crypto.randomUUID();
    const text = `integration ${id.slice(0, 8)}`;
    try {
      await a.db.putLocal("Activity", {
        id,
        title: text,
        rawInput: text,
        activityType: "ACTION",
        status: "DRAFT",
        position: "zz",
        editedAt: new Date().toISOString(),
      });
      await a.sync();
      expect(a.state()).toMatchObject({ status: "synced", dirty: 0 });

      await b.sync();
      expect(await b.db.get("Activity", id)).toMatchObject({ title: text, dirty: 0 });

      const row = (await a.db.get("Activity", id))!;
      const { dirty: _d, ...plain } = row;
      const at = new Date().toISOString();
      await a.db.putLocal("Activity", { ...plain, deletedAt: at, editedAt: at });
      await a.sync();
      await b.sync();
      expect((await b.db.get("Activity", id))!.deletedAt).toBe(at);
    } finally {
      a.db.close();
      b.db.close();
      await signOut();
    }
  });
});
