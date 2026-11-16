# 03 — Data Schema

Source of truth: `amplify/data/resource.ts`. The models are **copied from bacuy-x**
(`bacuy-x/amplify/data/resource.ts`) and extended with the fields that page order and offline
sync need. The local IndexedDB stores (`src/lib/db/`) mirror them field for field. Any change
updates, in the same change: the schema, the IndexedDB version upgrade, this file and (if it came
from bacuy-x) a note in `docs/notes.md`.

---

## 1. What is copied, what is added

| Model / enum | In v1 schema | In v1 UI | Notes |
|---|---|---|---|
| `ActivityType`, `ActivityStatus`, `Frequency`, `ProficiencyLevel` | yes | yes | identical to bacuy-x |
| `UserState`, `PlaceType` | yes | no | kept so the enums match; unused |
| `Activity` | yes, **+ `position`, `editedAt`, `deletedAt`** | yes | every bacuy-x field kept |
| `Flag` | yes, **+ `editedAt`, `deletedAt`** | yes | |
| `ActivityFlag` | yes, **+ `editedAt`, `deletedAt`** | yes (through `#flag` marks) | deterministic id |
| `Feedback` | yes, **+ `editedAt`, `deletedAt`** | yes | |
| `ActiveTime`, `FlagDailyStat` | no | no | add with the timer feature |
| `EnvironmentState`, `KnownPlace` | no | no | add with location |
| `suggestActivity` (AI query) | no | no | |
| `createFlagValidated`, `updateFlagValidated` (Lambda) | **no** | — | replaced by client validation + `upsertFlag` |
| `upsertActivity`, `upsertFlag`, `upsertActivityFlag`, `upsertFeedback` | **new** | — | last-edit-wins writes (see `02-backend-architecture.md`) |

Because `ActiveTime` is not in the v1 schema, `Activity.activeTimes` (hasMany) is left out until
the timer is ported. That is the only relation removed.

---

## 2. Sync fields (every synced model)

| Field | Type | Set by | Meaning |
|---|---|---|---|
| `id` | `ID` | device | `crypto.randomUUID()`, or UUID v5 for deterministic rows (§5) |
| `editedAt` | `AWSDateTime`, required | device | time of the last local change to the row (`Date.now() + clockOffset`, always `toISOString()`, so string order = time order) |
| `deletedAt` | `AWSDateTime` | device | soft delete; non-null = tombstone |
| `owner` | string | **server** (resolver, from `ctx.identity`) | Amplify owner value: the plain Cognito `sub` (verified, `docs/notes.md`) |
| `createdAt` | `AWSDateTime` | server | kept on overwrite (`if_not_exists`) |
| `updatedAt` | `AWSDateTime` | server | server time of the last write; drives the pull delta |

Local-only (IndexedDB, never sent): `dirty: 0 | 1` (a number, because IndexedDB cannot index
booleans).

---

## 3. Models

### Enums (unchanged from bacuy-x)

```ts
ActivityType:     ACTION | REPETITIVE_ACTION | HABIT | ATTITUDE | SKILL | MOMENTO | GRATITUDE | EXPIRATION
ActivityStatus:   DRAFT | ACTIVE | INACTIVE | COMPLETED | ARCHIVED
Frequency:        DAILY | WEEKLY | MONTHLY | CUSTOM
ProficiencyLevel: BEGINNER | INTERMEDIATE | ADVANCED | EXPERT
UserState:        SLEEPING | AWAKE | ACTIVE | RESTING | COMMUTING | WORKING     (unused in v1)
PlaceType:        HOME | WORK | GYM | OTHER                                     (unused in v1)
```

### Activity

```ts
Activity: a.model({
  // bacuy-x base fields
  title:        a.string().required(),   // rawInput without marks; may be ""
  description:  a.string(),
  rawInput:     a.string(),              // the line exactly as typed (marks included)
  activityType: a.ref("ActivityType").required(),
  isHidden:     a.boolean().default(false),   // no UI in v1
  hiddenUntil:  a.datetime(),                 // no UI in v1
  cron:         a.string(),
  status:       a.ref("ActivityStatus"),

  // ACTION / REPETITIVE_ACTION
  deadline: a.datetime(), frequency: a.ref("Frequency"),
  targetCount: a.integer(), completionCount: a.integer().default(0),
  // HABIT
  streak: a.integer().default(0), targetStreak: a.integer(),
  // ATTITUDE
  affirmation: a.string(),
  // SKILL
  proficiencyLevel: a.ref("ProficiencyLevel"), learningResources: a.string().array(),
  // MOMENTO
  eventDate: a.datetime(), mediaUrls: a.string().array(),   // mediaUrls: no UI in v1
  // GRATITUDE
  recipient: a.string(),                                     // legacy, unused (as in bacuy-x)
  // EXPIRATION
  expirationDate: a.datetime(), renewalLeadDays: a.integer().default(30),
  documentRef: a.string(), renewalUrl: a.string(), isRenewed: a.boolean().default(false),

  // bacuy-y
  position:  a.string().required(),      // fractional index (page order)
  editedAt:  a.datetime().required(),
  deletedAt: a.datetime(),

  feedbacks:     a.hasMany("Feedback", "activityId"),
  activityFlags: a.hasMany("ActivityFlag", "activityId"),
})
.authorization((allow) => [allow.owner()])
.secondaryIndexes((index) => [index("activityType"), index("status")])
```

### Flag

```ts
Flag: a.model({
  name:            a.string().required(),
  parentId:        a.id(),
  parent:          a.belongsTo("Flag", "parentId"),
  children:        a.hasMany("Flag", "parentId"),
  weight:          a.float().required(),
  color:           a.string(),
  icon:            a.string(),
  isSystemDefault: a.boolean().default(false),
  editedAt:        a.datetime().required(),
  deletedAt:       a.datetime(),
  activityFlags:   a.hasMany("ActivityFlag", "flagId"),
})
.authorization((allow) => [allow.owner()])
.secondaryIndexes((index) => [index("parentId")])
```

### ActivityFlag

```ts
ActivityFlag: a.model({
  activityId: a.id().required(), activity: a.belongsTo("Activity", "activityId"),
  flagId:     a.id().required(), flag:     a.belongsTo("Flag", "flagId"),
  editedAt:   a.datetime().required(),
  deletedAt:  a.datetime(),
})
.authorization((allow) => [allow.owner()])
.secondaryIndexes((index) => [index("activityId"), index("flagId")])
```

### Feedback

```ts
Feedback: a.model({
  activityId:     a.id().required(), activity: a.belongsTo("Activity", "activityId"),
  content:        a.string(),
  rating:         a.integer(),       // 1–5
  emotionValence: a.float(),         // −1..1
  emotionArousal: a.float(),         // 0..1
  editedAt:       a.datetime().required(),
  deletedAt:      a.datetime(),
})
.authorization((allow) => [allow.owner()])
.secondaryIndexes((index) => [index("activityId")])
```

### Upsert mutations

One per model. Arguments = every writable field of the model (including `id`, `editedAt`,
`deletedAt`; never `owner`, `createdAt`, `updatedAt`). A custom type cannot `.ref()` a model,
so each mutation returns a row custom type built from the same field list plus the server
fields (`resource.ts`: `activityFields()`, `serverFields()`…):

```ts
ActivityRow:          a.customType({ ...activityFields(), ...serverFields() })
UpsertActivityResult: a.customType({ applied: a.boolean().required(), item: a.ref("ActivityRow") })

upsertActivity: a.mutation()
  .arguments(activityFields())
  .returns(a.ref("UpsertActivityResult"))
  .authorization((allow) => [allow.authenticated()])
  .handler([
    a.handler.custom({ dataSource: a.ref("Activity"), entry: "./upsert.js" }),
    a.handler.custom({ dataSource: a.ref("Activity"), entry: "./upsertResult.js" }),
  ])
```

When a model field changes, update its `*Fields()` list in the same change.

Details of the resolver in `02-backend-architecture.md`.

---

## 4. Business rules

| # | Rule | Where enforced |
|---|---|---|
| 1 | One line = one Activity; the page = non-deleted, non-archived activities by `position` | `pageStore` + derived list |
| 2 | Text-owned fields are re-derived from `rawInput` (`05-line-mapping.md` §1) | `services/marks`, `services/sync/reconcile.ts` |
| 3 | `DRAFT` ↔ `ACTIVE` follows "has at least one live flag" | `services/lifecycle` |
| 4 | Per-type lifecycle (tick, complete, archive) as in bacuy-x | `services/lifecycle` |
| 5 | `GRATITUDE` completes only with non-empty `description` | panel + `services/lifecycle` |
| 6 | Sibling flag weights sum to 100 | flag editor (blocks save); priority score normalizes; warning on the Flags screen when a merge breaks it |
| 7 | System flags cannot be deleted or renamed (their `name` is a key); only weight, color and icon change | flag editor |
| 8 | Deleting a flag: soft-deletes it, its descendants and their `ActivityFlag` rows; lines keep the `#flag` text, now unrecognized | `flagStore` |
| 9 | Deleting an activity soft-deletes its `ActivityFlag` and `Feedback` rows | `pageStore` |
| 10 | `owner` is set only by the server | `upsert.js` |
| 11 | Last edit (by `editedAt`) wins per row, on server and device | `upsert.js`, `services/sync/pull.ts` |

---

## 5. Deterministic ids

UUID v5 with the app namespace (`lib/ids.ts`, constant `BACUYY_NS`). The owner is the Cognito
`sub`.

| Row | Name hashed |
|---|---|
| System flag | `` `${sub}:flag:${key}` `` (`key` = `personal`, `family`, `income`, `spiritual`, `health`, `errand`, `fun`, `income/salary`, `income/project`, `income/rent`) |
| ActivityFlag | `` `${activityId}:${flagId}` `` |
| Auto gratitude entry | `` `${sub}:gratitude:${cronWindowStart.toISOString()}` `` |

Two devices that create the same row offline produce the same id, so they converge to one row
(last edit wins) instead of duplicates. Re-adding a removed `#flag` revives the same
`ActivityFlag` row (clears `deletedAt`, new `editedAt`).

### System flag defaults (same as bacuy-x `seedDefaultFlags`)

| Key | Parent | Weight | Display (`flag.<key>`) es / en |
|---|---|---|---|
| `personal` | — | 15 | Personal / Personal |
| `family` | — | 15 | Familia / Family |
| `income` | — | 15 | Ingresos / Income |
| `spiritual` | — | 15 | Espiritual / Spiritual |
| `health` | — | 15 | Salud / Health |
| `errand` | — | 10 | Recados / Errands |
| `fun` | — | 15 | Diversión / Fun |
| `salary` | `income` | 50 | Salario / Salary |
| `project` | `income` | 30 | Proyecto / Project |
| `rent` | `income` | 20 | Renta / Rent |

`name` stores the key (as in bacuy-x); the UI shows `t("flag.<key>")` when `isSystemDefault`.
Seeded locally when the page loads, only for keys whose row is missing (a deleted one is not
revived). Seeds carry `editedAt = 1970-01-01T00:00:00.000Z`, so any server version wins the
pull merge and the server refuses the seed upsert: seeding before the first pull is safe.

---

## 6. Access patterns

| Need | Local (IndexedDB) | Cloud |
|---|---|---|
| Page lines | `activities` by index `position`, filter not deleted / not archived | — |
| Flags of a line | `activityFlags` index `activityId` | — |
| Lines of a flag | `activityFlags` index `flagId` | — |
| Flag tree | `flags` (all), group by `parentId` | — |
| Feedback of a line | `feedbacks` index `activityId` | — |
| Rows to push | index `dirty` = 1, per store | `upsertX` |
| Rows changed since last pull | — | `client.models.X.list({ filter: { updatedAt: { ge } } })` |

`list` with a filter is a DynamoDB scan filtered by owner. Fine for v1 sizes. If it gets slow,
add an explicit `owner` field with an index `owner` + `updatedAt` and query it instead.
(assumption)

---

## 7. IndexedDB layout (`bacuyy`, version 1)

| Store | keyPath | Indexes |
|---|---|---|
| `activities` | `id` | `dirty`, `position`, `status` |
| `flags` | `id` | `dirty`, `parentId` |
| `activityFlags` | `id` | `dirty`, `activityId`, `flagId` |
| `feedbacks` | `id` | `dirty`, `activityId` |
| `sync_meta` | (key) | — |

`sync_meta` keys: `lastPulledAt:<Model>`, `ownerSub`, `clockOffsetMs`, `lastSyncOkAt`.
