import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Unit tests of the APPSYNC_JS upsert pipeline with a fake `@aws-appsync/utils`.
 * They check the request it builds and how it turns DynamoDB results into
 * `{ applied, item }`. The real DynamoDB semantics (condition, if_not_exists) are covered by
 * the gated round trip in tests/integration/upsert.integration.test.ts.
 */
class Thrown extends Error {
  constructor(
    public kind: "error" | "unauthorized" | "earlyReturn",
    public value?: unknown,
  ) {
    super(kind);
  }
}

vi.mock("@aws-appsync/utils", () => ({
  util: {
    time: { nowISO8601: () => "2026-11-14T12:00:00.000Z" },
    dynamodb: { toMapValues: (o: unknown) => o }, // identity: easier to assert on
    error: (message: string, type: string) => {
      throw new Thrown("error", { message, type });
    },
    unauthorized: () => {
      throw new Thrown("unauthorized");
    },
  },
  runtime: {
    earlyReturn: (value: unknown) => {
      throw new Thrown("earlyReturn", value);
    },
  },
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ctx = Record<string, any>;

const upsert = (await import("../../amplify/data/upsert.js")) as unknown as {
  request: (ctx: Ctx) => Ctx;
  response: (ctx: Ctx) => unknown;
};
const result = (await import("../../amplify/data/upsertResult.js")) as unknown as {
  request: (ctx: Ctx) => Ctx;
  response: (ctx: Ctx) => unknown;
};

function ctxFor(args: Ctx, sub = "sub-A"): Ctx {
  return { args, identity: { sub, username: sub }, info: { fieldName: "upsertActivity" }, stash: {} };
}

describe("upsert.js request", () => {
  let ctx: Ctx;
  let req: Ctx;

  beforeEach(() => {
    ctx = ctxFor({
      id: "a1",
      title: "comprar pan",
      status: null,
      position: "a0",
      editedAt: "2026-11-14T11:59:00.000Z",
      owner: "sub-EVIL",
      createdAt: "1999-01-01T00:00:00.000Z",
      updatedAt: "1999-01-01T00:00:00.000Z",
    });
    req = upsert.request(ctx);
  });

  it("is a conditional UpdateItem keyed by id", () => {
    expect(req.operation).toBe("UpdateItem");
    expect(req.key).toEqual({ id: "a1" });
  });

  it("only writes when the row is new, or ours and strictly older", () => {
    expect(req.condition.expression).toBe(
      "attribute_not_exists(#id) OR (#owner = :owner AND #editedAt < :editedAt)",
    );
    expect(req.condition.expressionValues).toEqual({
      ":owner": "sub-A",
      ":editedAt": "2026-11-14T11:59:00.000Z",
    });
  });

  it("takes owner from the identity (plain sub) and ignores server fields in the arguments", () => {
    const written = valuesWritten(req);
    expect(written.owner).toBe("sub-A");
    expect(written.updatedAt).toBe("2026-11-14T12:00:00.000Z");
    expect(written.__typename).toBe("Activity");
    expect(Object.values(req.update.expressionValues)).not.toContain("sub-EVIL");
    expect(Object.values(req.update.expressionValues)).not.toContain("1999-01-01T00:00:00.000Z");
    expect(ctx.stash.owner).toBe("sub-A");
  });

  it("keeps createdAt on overwrite", () => {
    expect(req.update.expression).toContain("#createdAt = if_not_exists(#createdAt, :now)");
    expect(req.update.expressionNames["#createdAt"]).toBe("createdAt");
  });

  it("sets present values and REMOVEs nulls (GSI keys cannot be NULL)", () => {
    const written = valuesWritten(req);
    expect(written.title).toBe("comprar pan");
    expect(written.position).toBe("a0");
    expect(removedFields(req)).toEqual(["status"]);
  });

  it("does not touch fields that were not sent", () => {
    const names = Object.values(req.update.expressionNames);
    expect(names).not.toContain("description");
  });
});

describe("upsert.js response", () => {
  it("applied write → stash.applied = true and passes the row on", () => {
    const ctx: Ctx = { ...ctxFor({ id: "a1" }), result: { id: "a1" } };
    expect(upsert.response(ctx)).toEqual({ id: "a1" });
    expect(ctx.stash.applied).toBe(true);
  });

  it("failed condition is not an error → stash.applied = false", () => {
    const ctx: Ctx = {
      ...ctxFor({ id: "a1" }),
      error: { type: "DynamoDB:ConditionalCheckFailedException", message: "x" },
    };
    expect(upsert.response(ctx)).toBeNull();
    expect(ctx.stash.applied).toBe(false);
  });

  it("any other DynamoDB error is raised", () => {
    const ctx: Ctx = { ...ctxFor({ id: "a1" }), error: { type: "DynamoDB:Throttling", message: "slow" } };
    expect(() => upsert.response(ctx)).toThrow(Thrown);
  });
});

describe("upsertResult.js", () => {
  it("applied → returns { applied: true, item } without reading DynamoDB", () => {
    const ctx: Ctx = { ...ctxFor({ id: "a1" }), prev: { result: { id: "a1", title: "x" } } };
    ctx.stash.applied = true;
    try {
      result.request(ctx);
      expect.unreachable();
    } catch (e) {
      expect((e as Thrown).kind).toBe("earlyReturn");
      expect((e as Thrown).value).toEqual({ applied: true, item: { id: "a1", title: "x" } });
    }
  });

  it("not applied → strongly consistent GetItem of the same id", () => {
    const ctx = ctxFor({ id: "a1" });
    ctx.stash.applied = false;
    expect(result.request(ctx)).toEqual({
      operation: "GetItem",
      key: { id: "a1" },
      consistentRead: true,
    });
  });

  it("not applied, our row → { applied: false, item: server row }", () => {
    const ctx: Ctx = { ...ctxFor({ id: "a1" }), result: { id: "a1", owner: "sub-A", title: "newer" } };
    ctx.stash = { applied: false, owner: "sub-A" };
    expect(result.response(ctx)).toEqual({ applied: false, item: ctx.result });
  });

  it("another owner's row is never returned: unauthorized", () => {
    const ctx: Ctx = { ...ctxFor({ id: "a1" }), result: { id: "a1", owner: "sub-B", title: "secret" } };
    ctx.stash = { applied: false, owner: "sub-A" };
    expect(() => result.response(ctx)).toThrow(expect.objectContaining({ kind: "unauthorized" }));
  });
});

// ── helpers ──────────────────────────────────────────────────────────────────

function valuesWritten(req: Ctx): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const setPart = (req.update.expression as string).split(" REMOVE ")[0]!.replace(/^SET /, "");
  for (const assignment of setPart.split(", ")) {
    const [name, value] = assignment.split(" = ");
    if (!name!.startsWith("#f")) continue;
    out[req.update.expressionNames[name!]] = req.update.expressionValues[value!];
  }
  return out;
}

function removedFields(req: Ctx): string[] {
  const removePart = (req.update.expression as string).split(" REMOVE ")[1];
  if (!removePart) return [];
  return removePart.split(", ").map((n) => req.update.expressionNames[n]);
}
