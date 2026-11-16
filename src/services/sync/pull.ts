import { MODELS, type LocalDb, type ModelName } from "@/lib/db/types";
import { nowIso } from "./clock";
import type { ListPage, Remote } from "./remote";

/**
 * Pull (docs/02-backend-architecture.md §4): per model, every row updated since the last pull
 * (minus an overlap), all pages. The later `editedAt` wins (tie → server). `lastPulledAt` is
 * saved only after the whole model is committed, so an interrupted pull starts over.
 */

/** Covers clock skew between resolvers; re-applying a row is idempotent. */
export const PULL_OVERLAP_MS = 60_000;

export interface PullReport {
  /** Activities whose stored row changed (to reconcile). */
  changedActivities: Set<string>;
  /** Some Flag row changed: reconcile every line. */
  flagsChanged: boolean;
  /** Rows written locally by the pull, all models. */
  written: number;
}

export async function pull(db: LocalDb, remote: Remote): Promise<PullReport> {
  const report: PullReport = { changedActivities: new Set(), flagsChanged: false, written: 0 };

  for (const model of MODELS) {
    const last = await db.getMeta<string>(`lastPulledAt:${model}`);
    const since = last ? new Date(Date.parse(last) - PULL_OVERLAP_MS).toISOString() : null;
    const startedAt = nowIso();
    let nextToken: string | null = null;
    do {
      const page: ListPage<ModelName> = await remote.list(model as ModelName, since, nextToken);
      for (const row of page.items) {
        const outcome = await db.mergeFromServer(model, row as never);
        if (outcome === "keptLocal") continue;
        report.written++;
        if (model === "Activity") report.changedActivities.add(row.id);
        if (model === "Flag") report.flagsChanged = true;
      }
      nextToken = page.nextToken;
    } while (nextToken);
    await db.setMeta(`lastPulledAt:${model}`, startedAt);
  }
  return report;
}
