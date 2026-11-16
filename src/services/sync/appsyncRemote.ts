import { client } from "@/lib/client";
import type { ModelName, RowByModel } from "@/lib/db/types";
import { RemoteError, classifyError, toArgs, type ListPage, type Remote, type UpsertResult } from "./remote";

/**
 * The real transport: the `upsert*` mutations (one conditional write each, last edit wins on
 * the server) and the generated `list` with an `updatedAt` filter. Every call checks
 * `errors` (CLAUDE.md, Conventions).
 */

const PAGE_SIZE = 500;

type GraphQLResult = { data?: unknown; errors?: readonly { message?: string; errorType?: string }[]; nextToken?: string | null };

// The generated signatures differ per model; this module is the one place that bridges them.
/* eslint-disable @typescript-eslint/no-explicit-any */
const upserts: Record<ModelName, (args: any) => Promise<GraphQLResult>> = {
  Activity: (args) => client.mutations.upsertActivity(args),
  Flag: (args) => client.mutations.upsertFlag(args),
  ActivityFlag: (args) => client.mutations.upsertActivityFlag(args),
  Feedback: (args) => client.mutations.upsertFeedback(args),
};

const lists: Record<ModelName, (opts: any) => Promise<GraphQLResult>> = {
  Activity: (opts) => client.models.Activity.list(opts),
  Flag: (opts) => client.models.Flag.list(opts),
  ActivityFlag: (opts) => client.models.ActivityFlag.list(opts),
  Feedback: (opts) => client.models.Feedback.list(opts),
};
/* eslint-enable @typescript-eslint/no-explicit-any */

function check(result: GraphQLResult, what: string): void {
  const first = result.errors?.[0];
  if (first) throw classifyError({ message: first.message ?? `${what} failed`, errorType: first.errorType });
}

export const appsyncRemote: Remote = {
  async upsert<M extends ModelName>(model: M, row: RowByModel[M]): Promise<UpsertResult<M>> {
    let result: GraphQLResult;
    try {
      result = await upserts[model](toArgs(row));
    } catch (e) {
      throw classifyError(e);
    }
    check(result, `upsert${model}`);
    const data = result.data as { applied?: boolean; item?: RowByModel[M] | null } | null | undefined;
    if (!data || typeof data.applied !== "boolean") throw new RemoteError(`upsert${model} returned no data`, "other");
    return { applied: data.applied, item: data.item ?? null };
  },

  async list<M extends ModelName>(model: M, since: string | null, nextToken: string | null): Promise<ListPage<M>> {
    let result: GraphQLResult;
    try {
      result = await lists[model]({
        filter: since ? { updatedAt: { ge: since } } : undefined,
        limit: PAGE_SIZE,
        nextToken: nextToken ?? undefined,
      });
    } catch (e) {
      throw classifyError(e);
    }
    check(result, `list${model}`);
    if (!Array.isArray(result.data)) throw new RemoteError(`list${model} returned no data`, "other");
    return { items: result.data as RowByModel[M][], nextToken: result.nextToken ?? null };
  },
};
