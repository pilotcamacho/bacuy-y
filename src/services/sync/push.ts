import { MODELS, type LocalDb, type ModelName, type RowByModel } from "@/lib/db/types";
import { observeServerTime } from "./clock";
import { classifyError, type Remote, type RemoteError } from "./remote";

/**
 * Push (docs/02-backend-architecture.md §3): every dirty row, parents first, oldest edit
 * first. One failing row never blocks the others; it stays dirty and is retried with
 * exponential backoff.
 */

const CONCURRENCY = 4;
export const BACKOFF_BASE_MS = 2_000;
export const BACKOFF_MAX_MS = 5 * 60_000;

export interface PushReport {
  pushed: number;
  /** Rows the server refused because it holds a newer edit (replaced locally). */
  rejected: number;
  failed: number;
  skipped: number; // waiting for their backoff
  errors: RemoteError[];
}

/** Per-row retry schedule. Kept in memory: a reload retries everything at once. */
export class Backoff {
  private entries = new Map<string, { failures: number; nextAt: number }>();

  constructor(private readonly clock: () => number = Date.now) {}

  ready(key: string): boolean {
    const e = this.entries.get(key);
    return !e || e.nextAt <= this.clock();
  }

  fail(key: string): void {
    const failures = (this.entries.get(key)?.failures ?? 0) + 1;
    const delay = Math.min(BACKOFF_BASE_MS * 2 ** (failures - 1), BACKOFF_MAX_MS);
    this.entries.set(key, { failures, nextAt: this.clock() + delay });
  }

  succeed(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }
}

async function pool<T>(items: T[], size: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) await work(items[next++]!);
  });
  await Promise.all(runners);
}

export async function push(db: LocalDb, remote: Remote, backoff: Backoff): Promise<PushReport> {
  const report: PushReport = { pushed: 0, rejected: 0, failed: 0, skipped: 0, errors: [] };

  // No connection or no session: stop at the first such error. The rows are not to blame,
  // so their backoff is not touched.
  let abort = false;
  for (const model of MODELS) {
    if (abort) break;
    const rows = await db.dirty(model);
    await pool(rows, CONCURRENCY, async (stored) => {
      const key = `${model}:${stored.id}`;
      if (abort) return;
      if (!backoff.ready(key)) {
        report.skipped++;
        return;
      }
      const { dirty: _dirty, ...row } = stored;
      const sent = row.editedAt;
      const started = Date.now();
      try {
        const result = await remote.upsert(model as ModelName, row as RowByModel[ModelName]);
        // Only an applied write has `updatedAt` = server time now. A refused one returns the
        // stored row, whose `updatedAt` can be hours old: sampling it skewed the clock.
        if (result.applied) await observeServerTime(result.item?.updatedAt, started, Date.now(), db);
        if (result.applied) {
          // An edit made while the request was in flight keeps the row dirty.
          await db.clearDirtyIf(model, row.id, sent);
          report.pushed++;
        } else {
          // The server holds a newer edit. Keep whichever is later now: the server's, or a
          // local edit made during the push (that one is pushed next time).
          if (result.item) await db.mergeFromServer(model, result.item as RowByModel[typeof model]);
          report.rejected++;
        }
        backoff.succeed(key);
      } catch (e) {
        const err = classifyError(e);
        if (err.kind === "network" || err.kind === "auth") abort = true;
        else backoff.fail(key);
        report.failed++;
        report.errors.push(err);
      }
    });
  }
  return report;
}
