import { a, defineData, type ClientSchema } from "@aws-amplify/backend";

/**
 * bacuy-y schema.
 *
 * Models and enums are copied from bacuy-x (`bacuy-x/amplify/data/resource.ts`, baseline
 * 2026-11-13) and extended with the fields that page order and offline sync need:
 *   - every synced model: `editedAt` (last local edit, decides "last edit wins") and
 *     `deletedAt` (soft delete / tombstone);
 *   - Activity: `position` (fractional index, page order).
 * Left out until their features are ported: ActiveTime, FlagDailyStat, EnvironmentState,
 * KnownPlace, suggestActivity, createFlagValidated / updateFlagValidated.
 * See docs/03-data-schema.md. Keep src/lib/db in step with this file.
 */
const schema = a.schema({
  // ─── Enumerations (identical to bacuy-x) ─────────────────────────────────────

  ActivityType: a.enum([
    "ACTION", "REPETITIVE_ACTION", "HABIT",
    "ATTITUDE", "SKILL", "MOMENTO", "GRATITUDE", "EXPIRATION",
  ]),

  ActivityStatus: a.enum(["DRAFT", "ACTIVE", "INACTIVE", "COMPLETED", "ARCHIVED"]),

  // Unused in v1, kept so the enums match bacuy-x.
  UserState: a.enum(["SLEEPING", "AWAKE", "ACTIVE", "RESTING", "COMMUTING", "WORKING"]),
  PlaceType: a.enum(["HOME", "WORK", "GYM", "OTHER"]),

  ProficiencyLevel: a.enum(["BEGINNER", "INTERMEDIATE", "ADVANCED", "EXPERT"]),

  Frequency: a.enum(["DAILY", "WEEKLY", "MONTHLY", "CUSTOM"]),

  // ─── Flag ──────────────────────────────────────────────────────────────────────

  Flag: a.model({
    name:            a.string().required(),
    parentId:        a.id(),
    parent:          a.belongsTo("Flag", "parentId"),
    children:        a.hasMany("Flag", "parentId"),
    weight:          a.float().required(),
    color:           a.string(),
    icon:            a.string(),
    isSystemDefault: a.boolean().default(false),
    activityFlags:   a.hasMany("ActivityFlag", "flagId"),

    // bacuy-y sync
    editedAt:  a.datetime().required(),
    deletedAt: a.datetime(),
  })
  .authorization((allow) => [allow.owner()])
  .secondaryIndexes((index) => [
    index("parentId"),
  ]),

  // ─── Activity ──────────────────────────────────────────────────────────────────

  Activity: a.model({
    // Base fields
    title:        a.string().required(),   // rawInput without marks; may be ""
    description:  a.string(),
    rawInput:     a.string(),              // the line exactly as typed, marks included
    activityType: a.ref("ActivityType").required(),
    isHidden:     a.boolean().default(false),
    hiddenUntil:  a.datetime(),
    cron:         a.string(),
    status:       a.ref("ActivityStatus"),

    // ACTION / REPETITIVE_ACTION
    deadline:        a.datetime(),
    frequency:       a.ref("Frequency"),
    targetCount:     a.integer(),
    completionCount: a.integer().default(0),

    // HABIT
    streak:       a.integer().default(0),
    targetStreak: a.integer(),

    // ATTITUDE
    affirmation: a.string(),

    // SKILL
    proficiencyLevel:  a.ref("ProficiencyLevel"),
    learningResources: a.string().array(),

    // MOMENTO
    eventDate: a.datetime(),
    mediaUrls: a.string().array(),

    // GRATITUDE
    recipient: a.string(),

    // EXPIRATION
    expirationDate:  a.datetime(),
    renewalLeadDays: a.integer().default(30),
    documentRef:     a.string(),
    renewalUrl:      a.string(),
    isRenewed:       a.boolean().default(false),

    // bacuy-y: when it was completed (the Completed page's order); null when not completed
    completedAt: a.datetime(),
    // bacuy-y: ATTITUDE / SKILL spaced review, the step on the ladder (services/lifecycle/review.ts)
    reviewStep: a.integer(),

    // bacuy-y page order + sync
    position:  a.string().required(),
    editedAt:  a.datetime().required(),
    deletedAt: a.datetime(),

    // Relations (activeTimes left out until ActiveTime is ported)
    feedbacks:     a.hasMany("Feedback", "activityId"),
    activityFlags: a.hasMany("ActivityFlag", "activityId"),
  })
  .authorization((allow) => [allow.owner()])
  .secondaryIndexes((index) => [
    index("activityType"),
    index("status"),
  ]),

  // ─── Feedback ──────────────────────────────────────────────────────────────────

  Feedback: a.model({
    activityId:     a.id().required(),
    activity:       a.belongsTo("Activity", "activityId"),
    content:        a.string(),
    rating:         a.integer(),   // 1–5
    emotionValence: a.float(),     // −1..1
    emotionArousal: a.float(),     // 0..1

    // bacuy-y sync
    editedAt:  a.datetime().required(),
    deletedAt: a.datetime(),
  })
  .authorization((allow) => [allow.owner()])
  .secondaryIndexes((index) => [
    index("activityId"),
  ]),

  // ─── ActivityFlag (M2M join) ───────────────────────────────────────────────────

  ActivityFlag: a.model({
    activityId: a.id().required(),
    activity:   a.belongsTo("Activity", "activityId"),
    flagId:     a.id().required(),
    flag:       a.belongsTo("Flag", "flagId"),

    // bacuy-y sync
    editedAt:  a.datetime().required(),
    deletedAt: a.datetime(),
  })
  .authorization((allow) => [allow.owner()])
  .secondaryIndexes((index) => [
    index("activityId"),
    index("flagId"),
  ]),

  // ─── Upsert mutations: last edit wins (docs/02-backend-architecture.md §2) ─────
  // The app writes only through these, never through the generated create/update/delete.
  // Arguments = every writable field; owner / createdAt / updatedAt are set by the server.
  // A custom type cannot `.ref()` a model, so the returned row is a custom type built from
  // the same field list as the arguments (plus the server fields).

  ActivityRow:     a.customType({ ...activityFields(), ...serverFields() }),
  FlagRow:         a.customType({ ...flagFields(), ...serverFields() }),
  ActivityFlagRow: a.customType({ ...activityFlagFields(), ...serverFields() }),
  FeedbackRow:     a.customType({ ...feedbackFields(), ...serverFields() }),

  UpsertActivityResult:     a.customType({ applied: a.boolean().required(), item: a.ref("ActivityRow") }),
  UpsertFlagResult:         a.customType({ applied: a.boolean().required(), item: a.ref("FlagRow") }),
  UpsertActivityFlagResult: a.customType({ applied: a.boolean().required(), item: a.ref("ActivityFlagRow") }),
  UpsertFeedbackResult:     a.customType({ applied: a.boolean().required(), item: a.ref("FeedbackRow") }),

  upsertActivity: a.mutation()
    .arguments(activityFields())
    .returns(a.ref("UpsertActivityResult"))
    .authorization((allow) => [allow.authenticated()])
    .handler(upsertHandlers("Activity")),

  upsertFlag: a.mutation()
    .arguments(flagFields())
    .returns(a.ref("UpsertFlagResult"))
    .authorization((allow) => [allow.authenticated()])
    .handler(upsertHandlers("Flag")),

  upsertActivityFlag: a.mutation()
    .arguments(activityFlagFields())
    .returns(a.ref("UpsertActivityFlagResult"))
    .authorization((allow) => [allow.authenticated()])
    .handler(upsertHandlers("ActivityFlag")),

  upsertFeedback: a.mutation()
    .arguments(feedbackFields())
    .returns(a.ref("UpsertFeedbackResult"))
    .authorization((allow) => [allow.authenticated()])
    .handler(upsertHandlers("Feedback")),
});

// ─── Upsert field lists (fresh builders on every call) ───────────────────────────
// Keep in step with the models above: every writable field, no relations, no defaults.

function activityFields() {
  return {
    id:                a.id().required(),
    title:             a.string().required(),
    description:       a.string(),
    rawInput:          a.string(),
    activityType:      a.ref("ActivityType").required(),
    isHidden:          a.boolean(),
    hiddenUntil:       a.datetime(),
    cron:              a.string(),
    status:            a.ref("ActivityStatus"),
    deadline:          a.datetime(),
    frequency:         a.ref("Frequency"),
    targetCount:       a.integer(),
    completionCount:   a.integer(),
    streak:            a.integer(),
    targetStreak:      a.integer(),
    affirmation:       a.string(),
    proficiencyLevel:  a.ref("ProficiencyLevel"),
    learningResources: a.string().array(),
    eventDate:         a.datetime(),
    mediaUrls:         a.string().array(),
    recipient:         a.string(),
    expirationDate:    a.datetime(),
    renewalLeadDays:   a.integer(),
    documentRef:       a.string(),
    renewalUrl:        a.string(),
    isRenewed:         a.boolean(),
    completedAt:       a.datetime(),
    reviewStep:        a.integer(),
    position:          a.string().required(),
    editedAt:          a.datetime().required(),
    deletedAt:         a.datetime(),
  };
}

function flagFields() {
  return {
    id:              a.id().required(),
    name:            a.string().required(),
    parentId:        a.id(),
    weight:          a.float().required(),
    color:           a.string(),
    icon:            a.string(),
    isSystemDefault: a.boolean(),
    editedAt:        a.datetime().required(),
    deletedAt:       a.datetime(),
  };
}

function activityFlagFields() {
  return {
    id:         a.id().required(),
    activityId: a.id().required(),
    flagId:     a.id().required(),
    editedAt:   a.datetime().required(),
    deletedAt:  a.datetime(),
  };
}

function feedbackFields() {
  return {
    id:             a.id().required(),
    activityId:     a.id().required(),
    content:        a.string(),
    rating:         a.integer(),
    emotionValence: a.float(),
    emotionArousal: a.float(),
    editedAt:       a.datetime().required(),
    deletedAt:      a.datetime(),
  };
}

/** Set by the resolver, returned with every row. */
function serverFields() {
  return {
    owner:     a.string(),
    createdAt: a.datetime(),
    updatedAt: a.datetime(),
  };
}

/** The two-step JS pipeline shared by every upsert, bound to the model's own table. */
function upsertHandlers(model: "Activity" | "Flag" | "ActivityFlag" | "Feedback") {
  return [
    a.handler.custom({ dataSource: a.ref(model), entry: "./upsert.js" }),
    a.handler.custom({ dataSource: a.ref(model), entry: "./upsertResult.js" }),
  ];
}

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: "userPool",
  },
});
