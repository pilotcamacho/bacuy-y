import { describe, expectTypeOf, it } from "vitest";
import type { Schema } from "../../amplify/data/resource";

type Activity = Schema["Activity"]["type"];
type Flag = Schema["Flag"]["type"];
type ActivityFlag = Schema["ActivityFlag"]["type"];
type Feedback = Schema["Feedback"]["type"];

// Type-level checks (run by `tsc --noEmit` and by Vitest's typecheck of this file).
describe("schema", () => {
  it("adds the sync fields to every synced model", () => {
    expectTypeOf<Activity["editedAt"]>().toEqualTypeOf<string>();
    expectTypeOf<Flag["editedAt"]>().toEqualTypeOf<string>();
    expectTypeOf<ActivityFlag["editedAt"]>().toEqualTypeOf<string>();
    expectTypeOf<Feedback["editedAt"]>().toEqualTypeOf<string>();
    expectTypeOf<Activity["deletedAt"]>().toEqualTypeOf<string | null | undefined>();
    expectTypeOf<Activity["position"]>().toEqualTypeOf<string>();
  });

  it("keeps the bacuy-x enums", () => {
    expectTypeOf<Schema["ActivityType"]["type"]>().toEqualTypeOf<
      "ACTION" | "REPETITIVE_ACTION" | "HABIT" | "ATTITUDE" | "SKILL" | "MOMENTO" | "GRATITUDE" | "EXPIRATION"
    >();
    expectTypeOf<Schema["ActivityStatus"]["type"]>().toEqualTypeOf<
      "DRAFT" | "ACTIVE" | "INACTIVE" | "COMPLETED" | "ARCHIVED"
    >();
  });

  it("keeps the bacuy-x type-specific Activity fields", () => {
    expectTypeOf<Activity>().toHaveProperty("expirationDate");
    expectTypeOf<Activity>().toHaveProperty("renewalLeadDays");
    expectTypeOf<Activity>().toHaveProperty("streak");
    expectTypeOf<Activity>().toHaveProperty("affirmation");
    expectTypeOf<Activity>().toHaveProperty("learningResources");
    expectTypeOf<Activity>().toHaveProperty("mediaUrls");
  });
});
