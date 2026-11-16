/**
 * Step 2 of the upsert pipeline: builds `{ applied, item }`.
 *
 * - applied: returns the row written by step 1 without touching DynamoDB.
 * - not applied: reads the stored row (strongly consistent) so the client can replace its
 *   local copy. A row owned by someone else is never returned: the call fails as unauthorized.
 */
import { runtime, util } from "@aws-appsync/utils";

export function request(ctx) {
  if (ctx.stash.applied) {
    runtime.earlyReturn({ applied: true, item: ctx.prev.result });
  }
  return {
    operation: "GetItem",
    key: util.dynamodb.toMapValues({ id: ctx.args.id }),
    consistentRead: true,
  };
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  const item = ctx.result;
  if (!item || item.owner !== ctx.stash.owner) util.unauthorized();
  return { applied: false, item };
}
