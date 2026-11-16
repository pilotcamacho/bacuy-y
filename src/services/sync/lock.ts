import { kvGetJson, kvRemove, kvSetJson } from "@/lib/kv";

/**
 * One sync at a time across every tab (CLAUDE.md, "When sync runs").
 * `navigator.locks` where available; otherwise a localStorage lease that expires, so a tab
 * that died while syncing never blocks the others for long.
 */
export interface SyncLock {
  /** Runs `work` holding the lock, waiting for another holder to finish. */
  run<T>(work: () => Promise<T>): Promise<T>;
}

export const LOCK_NAME = "bacuyy-sync";

export function webLocks(locks: LockManager): SyncLock {
  return { run: (work) => locks.request(LOCK_NAME, () => work()) };
}

const LEASE_KEY = "syncLease";
export const LEASE_MS = 60_000;
const POLL_MS = 500;

interface Lease {
  holder: string;
  until: number;
}

export function leaseLock(clock: () => number = Date.now, sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))): SyncLock {
  const me = crypto.randomUUID();
  return {
    async run(work) {
      for (;;) {
        const lease = kvGetJson<Lease | null>(LEASE_KEY, null);
        if (!lease || lease.until < clock()) {
          kvSetJson(LEASE_KEY, { holder: me, until: clock() + LEASE_MS });
          // Another tab may have written at the same moment: the last writer holds it.
          if (kvGetJson<Lease | null>(LEASE_KEY, null)?.holder === me) break;
        }
        await sleep(POLL_MS);
      }
      // Renew while working, so a long sync never outlives its lease.
      const renew = setInterval(() => {
        if (kvGetJson<Lease | null>(LEASE_KEY, null)?.holder === me) kvSetJson(LEASE_KEY, { holder: me, until: clock() + LEASE_MS });
      }, LEASE_MS / 3);
      try {
        return await work();
      } finally {
        clearInterval(renew);
        if (kvGetJson<Lease | null>(LEASE_KEY, null)?.holder === me) kvRemove(LEASE_KEY);
      }
    },
  };
}

export function defaultLock(): SyncLock {
  const locks = globalThis.navigator?.locks;
  return locks ? webLocks(locks) : leaseLock();
}
