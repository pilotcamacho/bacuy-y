import type { ModelName, RowByModel } from "@/lib/db/types";
import { RemoteError, toArgs, type ListPage, type Remote, type UpsertResult } from "@/services/sync/remote";

/**
 * An in-memory AppSync + DynamoDB with the same rules as amplify/data/upsert.js:
 * - write when the row does not exist, or it is the caller's and the stored `editedAt` is older;
 * - `owner` from the identity, `createdAt` kept, `updatedAt` = server time, null args removed;
 * - otherwise `applied: false` with the stored row, or Unauthorized for another owner's row.
 * `list` is owner-scoped, filtered by `updatedAt >= since`, paginated by `pageSize`.
 */
type Row = Record<string, unknown> & { id: string; owner: string; editedAt: string; updatedAt: string };

export class FakeServer {
  tables: Record<ModelName, Map<string, Row>> = {
    Activity: new Map(),
    Flag: new Map(),
    ActivityFlag: new Map(),
    Feedback: new Map(),
  };
  pageSize = 100;
  listCalls = 0;
  upsertCalls = 0;
  inFlight = 0;
  maxInFlight = 0;
  /** Set to make every call fail like a dropped connection. */
  offline = false;
  /** Set to make every list fail with a server error (not a connection problem). */
  failLists = false;
  /** Called inside each upsert, before the write (to simulate edits during a push). */
  onUpsert: ((model: ModelName, id: string) => Promise<void> | void) | null = null;
  private last = 0;

  now(): string {
    this.last = Math.max(this.last + 1, Date.now());
    return new Date(this.last).toISOString();
  }

  rows<M extends ModelName>(model: M): RowByModel[M][] {
    return [...this.tables[model].values()] as unknown as RowByModel[M][];
  }

  get<M extends ModelName>(model: M, id: string): (RowByModel[M] & { owner: string }) | undefined {
    return this.tables[model].get(id) as never;
  }

  /** Seeds a row as if another device had written it. */
  put(model: ModelName, row: Record<string, unknown> & { id: string; editedAt: string }, owner: string) {
    const now = this.now();
    this.tables[model].set(row.id, { ...toArgs(row), owner, createdAt: now, updatedAt: now } as Row);
  }

  remote(owner: string): Remote {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- the returned object uses its own `this`
    const server = this;
    const enter = async () => {
      server.inFlight++;
      server.maxInFlight = Math.max(server.maxInFlight, server.inFlight);
      await new Promise((r) => setTimeout(r, 1));
      if (server.offline) {
        server.inFlight--;
        throw new RemoteError("Failed to fetch", "network");
      }
    };
    return {
      async upsert<M extends ModelName>(model: M, row: RowByModel[M]): Promise<UpsertResult<M>> {
        await enter();
        try {
          server.upsertCalls++;
          await server.onUpsert?.(model, row.id);
          const args = toArgs(row) as Record<string, unknown> & { id: string; editedAt: string };
          const table = server.tables[model];
          const existing = table.get(args.id);
          if (!existing || (existing.owner === owner && existing.editedAt < args.editedAt)) {
            const next: Row = { ...(existing ?? {}), owner, createdAt: existing?.createdAt ?? server.now(), updatedAt: server.now() } as Row;
            for (const [k, v] of Object.entries(args)) {
              if (v === null) delete next[k];
              else next[k] = v;
            }
            table.set(args.id, next);
            return { applied: true, item: { ...next } as unknown as RowByModel[M] };
          }
          if (existing.owner !== owner) throw new RemoteError("Unauthorized", "rejected");
          return { applied: false, item: { ...existing } as unknown as RowByModel[M] };
        } finally {
          server.inFlight--;
        }
      },

      async list<M extends ModelName>(model: M, since: string | null, nextToken: string | null): Promise<ListPage<M>> {
        await enter();
        try {
          server.listCalls++;
          if (server.failLists) throw new RemoteError("Internal server error", "other");
          const all = [...server.tables[model].values()]
            .filter((r) => r.owner === owner && (!since || r.updatedAt >= since))
            .sort((a, b) => (a.id < b.id ? -1 : 1));
          const start = nextToken ? Number(nextToken) : 0;
          const items = all.slice(start, start + server.pageSize).map((r) => ({ ...r }));
          const next = start + server.pageSize < all.length ? String(start + server.pageSize) : null;
          return { items: items as unknown as RowByModel[M][], nextToken: next };
        } finally {
          server.inFlight--;
        }
      },
    };
  }
}

/** A promise mutex standing in for navigator.locks, shared by the "tabs" of a test. */
export function memoryLock() {
  let chain: Promise<unknown> = Promise.resolve();
  let holders = 0;
  const stats = { maxHolders: 0, runs: 0 };
  return {
    stats,
    run<T>(work: () => Promise<T>): Promise<T> {
      const result = chain.then(async () => {
        holders++;
        stats.runs++;
        stats.maxHolders = Math.max(stats.maxHolders, holders);
        try {
          return await work();
        } finally {
          holders--;
        }
      });
      chain = result.catch(() => undefined);
      return result;
    },
  };
}
