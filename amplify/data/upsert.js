/**
 * Step 1 of the upsert pipeline shared by upsertActivity / upsertFlag / upsertActivityFlag /
 * upsertFeedback (APPSYNC_JS runtime). One conditional UpdateItem: "last edit wins".
 *
 * The write lands only if the row does not exist yet, or it belongs to the caller AND the
 * incoming `editedAt` is strictly newer than the stored one. Otherwise the condition fails;
 * that is not an error: step 2 (upsertResult.js) returns the stored row with applied = false.
 *
 * - `owner` always comes from the identity, never from the arguments. The stored format is
 *   the plain Cognito `sub` (verified 2026-11-14, docs/notes.md).
 * - `createdAt` is kept on overwrite (if_not_exists); `updatedAt` = server time (pull delta).
 * - A null argument REMOVEs the attribute (DynamoDB rejects NULL for GSI key attributes such
 *   as status or parentId). An argument that is not sent is left untouched.
 * See docs/02-backend-architecture.md §2.
 */
import { util } from "@aws-appsync/utils";

const SERVER_FIELDS = ["owner", "createdAt", "updatedAt", "__typename"];

export function request(ctx) {
  const { id, ...args } = ctx.args;
  const owner = ctx.identity.sub;
  const now = util.time.nowISO8601();
  ctx.stash.owner = owner;

  const values = {};
  for (const key of Object.keys(args)) {
    if (!SERVER_FIELDS.includes(key)) values[key] = args[key];
  }
  values.owner = owner;
  values.updatedAt = now;
  values.__typename = ctx.info.fieldName.slice("upsert".length); // "upsertActivity" → "Activity"

  const names = { "#createdAt": "createdAt" };
  const vals = { ":now": now };
  const sets = ["#createdAt = if_not_exists(#createdAt, :now)"];
  const removes = [];
  Object.keys(values).forEach((key, i) => {
    names[`#f${i}`] = key;
    if (values[key] === null || values[key] === undefined) {
      removes.push(`#f${i}`);
    } else {
      vals[`:v${i}`] = values[key];
      sets.push(`#f${i} = :v${i}`);
    }
  });

  let expression = `SET ${sets.join(", ")}`;
  if (removes.length > 0) expression += ` REMOVE ${removes.join(", ")}`;

  return {
    operation: "UpdateItem",
    key: util.dynamodb.toMapValues({ id }),
    update: {
      expression,
      expressionNames: names,
      expressionValues: util.dynamodb.toMapValues(vals),
    },
    condition: {
      expression: "attribute_not_exists(#id) OR (#owner = :owner AND #editedAt < :editedAt)",
      expressionNames: { "#id": "id", "#owner": "owner", "#editedAt": "editedAt" },
      expressionValues: util.dynamodb.toMapValues({ ":owner": owner, ":editedAt": args.editedAt }),
    },
  };
}

export function response(ctx) {
  if (ctx.error) {
    if (ctx.error.type === "DynamoDB:ConditionalCheckFailedException") {
      ctx.stash.applied = false; // the stored row is newer (or equal), or belongs to someone else
      return null;
    }
    util.error(ctx.error.message, ctx.error.type);
  }
  ctx.stash.applied = true;
  return ctx.result;
}
