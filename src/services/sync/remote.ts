import type { ModelName, RowByModel } from "@/lib/db/types";

/**
 * What push and pull need from the cloud. The app uses `appsyncRemote.ts`; tests use an
 * in-memory server with the same rules as the resolver (tests/sync/fakeServer.ts).
 */
export interface UpsertResult<M extends ModelName> {
  applied: boolean;
  /** The server row after the call: the written row, or the newer one that was kept. */
  item: RowByModel[M] | null;
}

export interface ListPage<M extends ModelName> {
  items: RowByModel[M][];
  nextToken: string | null;
}

export interface Remote {
  upsert<M extends ModelName>(model: M, row: RowByModel[M]): Promise<UpsertResult<M>>;
  /** Rows with `updatedAt >= since` (all rows when `since` is null), one page. */
  list<M extends ModelName>(model: M, since: string | null, nextToken: string | null): Promise<ListPage<M>>;
}

export type RemoteErrorKind = "network" | "auth" | "rejected" | "other";

/** A failed call. `kind` decides the indicator state (offline / error) and retries. */
export class RemoteError extends Error {
  constructor(
    message: string,
    readonly kind: RemoteErrorKind,
  ) {
    super(message);
    this.name = "RemoteError";
  }
}

/** Fields the server sets: never sent as arguments. */
const SERVER_FIELDS = new Set(["owner", "createdAt", "updatedAt", "dirty", "__typename"]);

/** A stored row → upsert arguments (writable fields only, no functions, no undefined). */
export function toArgs<T extends object>(row: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (SERVER_FIELDS.has(k) || v === undefined || typeof v === "function") continue;
    out[k] = v;
  }
  return out as T;
}

/** Classifies whatever a call threw or returned in `errors`. */
export function classifyError(e: unknown): RemoteError {
  if (e instanceof RemoteError) return e;
  const err = (e ?? {}) as { name?: string; message?: string; errorType?: string };
  const text = `${err.name ?? ""} ${err.errorType ?? ""} ${err.message ?? ""}`;
  if (/NotAuthorized|Unauthenticated|UserUnAuthenticated|No current user|credentials|token/i.test(text)) {
    return new RemoteError(err.message ?? text, "auth");
  }
  if (globalThis.navigator?.onLine === false || /NetworkError|Failed to fetch|Network error|TypeError|fetch failed|timeout/i.test(text)) {
    return new RemoteError(err.message ?? text, "network");
  }
  if (/Unauthorized|ConditionalCheck|Validation|ValidationError/i.test(text)) return new RemoteError(err.message ?? text, "rejected");
  return new RemoteError(err.message ?? "sync call failed", "other");
}
