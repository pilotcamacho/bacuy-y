import { create } from "zustand";
import { generateKeyBetween } from "fractional-indexing";
import { getDb } from "@/lib/db/instance";
import { emit } from "@/lib/events";
import type { ActivityRow, FlagRow, LocalDb, Stored, WriteOp } from "@/lib/db/types";
import i18n from "@/lib/i18n";
import { newId } from "@/lib/ids";
import { kvGetJson, kvSetJson } from "@/lib/kv";
import {
  deleteEmpty,
  mergeDown,
  mergeUp,
  moveLine,
  pasteText,
  splitLine,
  type EditResult,
  type EditorLine,
} from "@/services/editor";
import { activeFilter, filterLines, withFilterFlag } from "@/services/editor/flagFilter";
import { GHOST_LINE_ID, pageLines } from "@/services/editor/pageLines";
import { missingDefaultFlags } from "@/services/flags/defaults";
import { diffActivityFlags } from "@/services/lifecycle/activityFlags";
import { keepInMemory } from "@/services/lifecycle/completed";
import { deriveTextFields, newActivityDefaults } from "@/services/lifecycle/derive";
import { applyStatusAction, reactivatedStatus, type StatusAction } from "@/services/lifecycle/status";
import { tick as tickRule, type PanelSection } from "@/services/lifecycle/tick";
import { isSpaced, reviewDueAt, reviewOutcome } from "@/services/lifecycle/review";
import { useFeedbackStore } from "./feedbackStore";
import { commitLine, parseLine, type FlagLite, type ParseContext } from "@/services/marks";
import { nowIso } from "@/services/sync/clock";
import { journalClear, journalPut, rowsToReplay } from "./pendingJournal";
import { resetRowHistory } from "./rowHistory";

/**
 * The page: activities (and their ActivityFlag rows) read from and written to LocalDb, never
 * the network.
 * - Typing updates memory at once and is written after TEXT_DEBOUNCE_MS, on blur and when
 *   the page is hidden (CLAUDE.md, rule 8).
 * - Structural changes (split, merge, delete, paste, move, tick, panel edits) flush pending
 *   text and are written immediately, in one transaction.
 * - Every write of an activity also writes the ActivityFlag rows its `#flag` marks call for
 *   (and soft-deletes the links and feedback of a deleted activity) in the same transaction.
 * - Writes are serialized, so the database sees them in the order they happened.
 * Components derive the ordered lines with `pageLines(activities)` inside useMemo.
 */

export const TEXT_DEBOUNCE_MS = 300;
export const UNDO_MS = 5000;

type Activity = Stored<"Activity">;
type Link = Stored<"ActivityFlag">;

export interface FocusRequest {
  id: string;
  offset: number;
  nonce: number;
}

export interface UndoEntry {
  kind: "merged" | "deleted";
  rows: Activity[];
  /** The `deletedAt` stamped on the removed rows (their feedback is revived by it). */
  deletedAt: string;
  nonce: number;
}

export interface PanelState {
  id: string;
  section: PanelSection | null;
  nonce: number;
}

/**
 * A short, non-blocking toast after a tick (docs/05-line-mapping.md §4): the habit reached its
 * target streak, or the line left the page (hidden until its next time, or completed), with
 * undo and "rate it".
 */
export interface Notice {
  /**
   * "review": the "how did it go?" question of an attitude or skill. "spacingOverride": a
   * `~frequency` was typed on one (spacing replaces it).
   */
  kind: "habitFormed" | "hidden" | "completed" | "review" | "spacingOverride";
  id: string;
  nonce: number;
  /** "hidden": when the line comes back (none: until shown again). */
  until?: string;
  /** "hidden": hidden by hand from the panel (not a tick: nothing to rate). */
  manual?: boolean;
  /** "hidden" / "completed": the row before the tick (for undo). */
  before?: Activity;
  /** "hidden" / "completed" after a review: its answer, and the feedback row it saved (undo removes it). */
  review?: { good: boolean; feedbackId: string };
}

interface PageState {
  status: "idle" | "loading" | "ready" | "error";
  activities: Record<string, Activity>;
  activityFlags: Record<string, Link>;
  /** Live flags (full rows: the priority view needs the weights). */
  flags: FlagRow[];
  focus: FocusRequest | null;
  undo: UndoEntry | null;
  panel: PanelState | null;
  notice: Notice | null;

  /** `ownerSub` seeds the user's default flags (missing ones only). */
  load(ownerSub?: string | null): Promise<void>;
  type(id: string, rawInput: string): void;
  commit(id: string): Promise<void>;
  enter(id: string, selStart: number, selEnd: number): Promise<void>;
  /** The answer to an attitude's / skill's "how did it go?" (spaced review). */
  review(id: string, good: boolean): Promise<void>;
  /** The "add line" button under the page: a new empty line at the end, focused. */
  addLineAtEnd(): Promise<void>;
  backspaceAtStart(id: string): Promise<boolean>;
  deleteAtEnd(id: string): Promise<boolean>;
  paste(id: string, selStart: number, selEnd: number, text: string): Promise<void>;
  move(id: string, delta: number): Promise<void>;
  moveTo(id: string, toIndex: number): Promise<void>;
  setFocus(id: string, offset: number): void;
  undoLast(): Promise<void>;
  dismissUndo(): void;
  flushAll(): Promise<void>;

  /** The tick / Ctrl+Enter (docs/05-line-mapping.md §4). */
  tick(id: string): Promise<void>;
  /** Panel: fields without a mark (description, targets…). Immediate write. */
  updateFields(id: string, patch: Partial<ActivityRow>): Promise<void>;
  /** Panel: a rewritten line (marks added / replaced / removed), plus optional fields. */
  setRawInput(id: string, rawInput: string, patch?: Partial<ActivityRow>): Promise<void>;
  statusAction(id: string, action: StatusAction): Promise<boolean>;
  deleteLine(id: string): Promise<void>;
  openPanel(id: string, section?: PanelSection | null): void;
  closePanel(): void;
  dismissNotice(): void;
  /** Undo of a tick that took the line off the page (done for this time, or completed). */
  undoHide(): Promise<void>;
  /** A hidden line back on the page now (its next tick hides it again). */
  showNow(id: string): Promise<void>;
  /**
   * Hide a line by hand until a time, or until shown again (`until` null). Off the page: the
   * focus moves to the line taking its place; a toast offers undo.
   */
  hide(id: string, until: string | null): Promise<void>;
  hasFlags(id: string): boolean;
  /** Flag ids (and NO_FLAG) the page is filtered by; empty = every line. Kept on this device. */
  filter: string[];
  setFilter(filter: string[]): void;
  /** Archived view: back to the page (at the end), ACTIVE or DRAFT by the flag rule. */
  restore(id: string): Promise<void>;
  /** Archived view: soft-delete an archived line (its links and feedback too). */
  deleteArchived(id: string): Promise<void>;
  /** Completed page: back on the page at its old place (uncompleted). */
  reopen(id: string): Promise<void>;
  /** Completed page: soft-delete a completed line (its links and feedback too). */
  deleteCompleted(id: string): Promise<void>;
  /** Completed page: rows read from the device, put in memory (to open their panel). */
  adopt(rows: Activity[]): void;
  /** Re-reads IndexedDB after a sync or another tab's write, keeping lines still being typed. */
  refresh(): Promise<void>;
}

// ─── module state (not rendered) ─────────────────────────────────────────────────

const timers = new Map<string, ReturnType<typeof setTimeout>>();
/**
 * Lines shown on the filtered page since the filter was set: they stay in view even if an
 * edit removes their mark (a split moving it to the new line, typing over it), so the line
 * being edited never vanishes. Cleared when the filter changes.
 */
const filterKeep = new Set<string>();
const FILTER_KEY = "pageFilter";

function markLocale(): "es" | "en" {
  return i18n.resolvedLanguage?.startsWith("en") ? "en" : "es";
}

/**
 * On a filtered page the editor only sees the visible lines, so the positions it gives new or
 * moved lines ignore the lines the filter hides (and could even equal one of theirs). Each
 * such line is placed in the whole page instead: right after its visible predecessor, before
 * whatever line follows that one (or, when it is first, right before its visible successor).
 * Visible order is kept; no position is shared with any other row.
 */
function placeInWholePage(result: EditResult, before: Record<string, Activity>): EditResult {
  const placed = new Set(
    result.changed.filter((l) => !before[l.id] || before[l.id]!.position !== l.position).map((l) => l.id),
  );
  if (placed.size === 0) return result;
  const deleted = new Set(result.deleted);
  const taken = Object.values(before)
    .filter((a) => !a.deletedAt && !placed.has(a.id) && !deleted.has(a.id))
    .map((a) => a.position);
  const lines = result.lines.slice();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!placed.has(line.id)) continue;
    const prev = i > 0 ? lines[i - 1]!.position : null;
    const next = lines.slice(i + 1).find((l) => !placed.has(l.id))?.position ?? null;
    let lo: string | null;
    let hi: string | null;
    if (prev !== null) {
      lo = prev;
      hi = taken.filter((p) => p > prev).sort()[0] ?? null;
    } else {
      hi = next;
      const below = taken.filter((p) => hi === null || p < hi).sort();
      lo = below.at(-1) ?? null;
    }
    const position = generateKeyBetween(lo, hi);
    lines[i] = { ...line, position };
    taken.push(position);
  }
  const byId = new Map(lines.map((l) => [l.id, l]));
  return { ...result, lines, changed: result.changed.map((l) => byId.get(l.id) ?? l) };
}

/** The page as shown: every line, or with a filter, the matching ones (plus filterKeep). */
export function visiblePageLines(
  activities: Record<string, Activity>,
  flags: FlagRow[],
  filter: string[],
  now: Date = new Date(),
): EditorLine[] {
  const all = pageLines(activities, now);
  if (filter.length === 0 || activeFilter(filter, flags).length === 0) return all;
  const shown = new Set(filterLines(all, filter, parseContext(flags)).map((l) => l.id));
  for (const id of shown) filterKeep.add(id);
  return all.filter((l) => shown.has(l.id) || filterKeep.has(l.id));
}
let writeChain: Promise<void> = Promise.resolve();
let nonce = 0;

function enqueue(write: () => Promise<void>): Promise<void> {
  writeChain = writeChain.then(async () => {
    await write();
    emit({ type: "localWrite" }); // the sync engine pushes soon; other tabs reload
  }).catch((e) => {
    // A local write failing is a bug or a full disk; keep going so later edits still save.
    console.error("[bacuyy] local write failed", e);
  });
  return writeChain;
}

function parseContext(flags: FlagLite[]): ParseContext {
  return { flags, today: new Date() };
}

function liveFlags(rows: FlagRow[]): FlagRow[] {
  return rows.filter((f) => !f.deletedAt);
}

/** Feedback rows to soft-delete (activity deleted) or revive (deletion undone). */
async function feedbackOps(db: LocalDb, rows: Activity[], reviveAt: string | null, now: string): Promise<WriteOp[]> {
  const ops: WriteOp[] = [];
  for (const row of rows) {
    if (!row.deletedAt && !reviveAt) continue;
    const feedbacks = await db.listByIndex("Feedback", "activityId", row.id);
    for (const { dirty: _dirty, ...fb } of feedbacks) {
      if (row.deletedAt && !fb.deletedAt) ops.push({ model: "Feedback", row: { ...fb, deletedAt: row.deletedAt, editedAt: now } });
      else if (!row.deletedAt && reviveAt && fb.deletedAt === reviveAt) {
        ops.push({ model: "Feedback", row: { ...fb, deletedAt: null, editedAt: now } });
      }
    }
  }
  return ops;
}

export const usePageStore = create<PageState>((set, get) => {
  // The lines the user sees (filtered); every editing operation works on these.
  const lines = () => visiblePageLines(get().activities, get().flags, get().filter);
  const ctx = () => parseContext(get().flags);

  /** Builds the stored row for a line after an edit (text-owned fields re-derived). */
  function rowFor(line: EditorLine, now: string, patch: Partial<ActivityRow> = {}): Activity {
    const existing = get().activities[line.id];
    const base: Activity = {
      ...(existing ?? { ...newActivityDefaults(), id: line.id, position: line.position, editedAt: now, dirty: 1 }),
      ...patch,
    };
    const textChanged = !existing || (existing.rawInput ?? "") !== line.rawInput || Object.keys(patch).length > 0;
    return {
      ...base,
      ...(textChanged ? deriveTextFields(base, line.rawInput, ctx()).fields : {}),
      position: line.position,
      editedAt: now,
      dirty: 1,
    };
  }

  /** ActivityFlag rows the given activities call for; memory is updated at once. */
  function linkOps(rows: Activity[], now: string): WriteOp[] {
    if (rows.length === 0) return [];
    const byActivity = new Map<string, Link[]>();
    for (const link of Object.values(get().activityFlags)) {
      const list = byActivity.get(link.activityId);
      if (list) list.push(link);
      else byActivity.set(link.activityId, [link]);
    }
    const c = ctx();
    const changed: Link[] = [];
    for (const row of rows) {
      const wanted = row.deletedAt ? [] : parseLine(row.rawInput ?? "", c).flagIds;
      for (const link of diffActivityFlags(row.id, wanted, byActivity.get(row.id) ?? [], now)) {
        changed.push({ ...link, dirty: 1 });
      }
    }
    if (changed.length === 0) return [];
    const next = { ...get().activityFlags };
    for (const link of changed) next[link.id] = link;
    set({ activityFlags: next });
    return changed.map(({ dirty: _dirty, ...row }) => ({ model: "ActivityFlag", row }));
  }

  async function writeRows(rows: Activity[], reviveFeedbackAt: string | null = null) {
    if (rows.length === 0) return;
    const now = nowIso();
    // putManyLocal sets `dirty` itself; the extra field on the row is ignored.
    const ops: WriteOp[] = [...rows.map((row): WriteOp => ({ model: "Activity", row })), ...linkOps(rows, now)];
    journalPut(rows); // survives a reload before the IndexedDB write commits (Safari)
    const db = await getDb();
    await enqueue(async () => {
      const feedback = await feedbackOps(db, rows, reviveFeedbackAt, now);
      await db.putManyLocal([...ops, ...feedback]);
      journalClear(rows);
    });
  }

  /** Stops the text timers and returns the rows still waiting for them (to write now). */
  function takePending(except: Set<string>): Activity[] {
    const ids = [...timers.keys()];
    for (const id of ids) clearTimeout(timers.get(id));
    timers.clear();
    const all = get().activities;
    return ids.filter((id) => !except.has(id)).map((id) => all[id]).filter((r): r is Activity => !!r);
  }

  /** Puts rows in memory now and writes them (with any pending text) in one transaction. */
  function commitRows(rows: Activity[], reviveFeedbackAt: string | null = null): Promise<void> {
    const pending = takePending(new Set(rows.map((r) => r.id)));
    const next = { ...get().activities };
    for (const row of rows) next[row.id] = row;
    set({ activities: next });
    return writeRows([...pending, ...rows], reviveFeedbackAt);
  }

  async function flushText(id: string) {
    const timer = timers.get(id);
    if (!timer) return;
    clearTimeout(timer);
    timers.delete(id);
    const row = get().activities[id];
    if (row) await writeRows([row]);
  }

  /**
   * Applies a pure editor result. Memory is updated synchronously, before any await, so keys
   * typed right after Enter / Backspace land in the right line; the write follows (one
   * transaction, including any text still waiting for its debounce).
   */
  function apply(result: EditResult, undoKind: UndoEntry["kind"] | null = null): Promise<void> {
    if (result.changed.length === 0 && result.deleted.length === 0) {
      if (result.focus) get().setFocus(result.focus.id, result.focus.offset);
      return Promise.resolve();
    }
    const now = nowIso();
    const before = get().activities;
    // New lines typed while the page is filtered get the filter's flag (and stay in view).
    const filtered = activeFilter(get().filter, get().flags).length > 0;
    if (filtered) result = placeInWholePage(result, before);
    const created = new Set(result.created);
    const rows: Activity[] = result.changed.map((line) => {
      if (!filtered || !created.has(line.id)) return rowFor(line, now);
      filterKeep.add(line.id);
      return rowFor({ ...line, rawInput: withFilterFlag(line.rawInput, get().filter, ctx(), markLocale()) }, now);
    });
    for (const row of rows) noteSpacingOverride(before[row.id], row);
    for (const id of result.deleted) {
      const row = before[id];
      if (row) rows.push({ ...row, deletedAt: now, editedAt: now, dirty: 1 });
    }

    const removedText = result.deleted.some((id) => (before[id]?.rawInput ?? "").length > 0);
    // Undo = write back the rows as they were before (only when text actually disappeared).
    const snapshot = [...result.changed.map((l) => before[l.id]), ...result.deleted.map((id) => before[id])].filter(
      (row): row is Activity => row !== undefined,
    );
    const undo: UndoEntry | null =
      undoKind && removedText ? { kind: undoKind, rows: snapshot, deletedAt: now, nonce: ++nonce } : get().undo;
    const panel = get().panel;
    set({
      undo,
      focus: result.focus ? { ...result.focus, nonce: ++nonce } : get().focus,
      panel: panel && result.deleted.includes(panel.id) ? null : panel,
    });
    return commitRows(rows);
  }

  /**
   * Spacing replaces the frequency of attitudes and skills: say so when a line becomes one with
   * a `~frequency` (typed, pasted or changed in the panel). The mark stays; it is just ignored.
   */
  function noteSpacingOverride(before: Activity | undefined, after: Activity) {
    // The parser marks a `~frequency` on these types "not applicable" (it never reaches `frequency`).
    const ignored = (row: Activity | undefined) =>
      !!row &&
      isSpaced(row) &&
      parseLine(row.rawInput ?? "", ctx()).marks.some((m) => m.kind === "frequency" && m.status === "notApplicable");
    if (!ignored(after) || ignored(before)) return; // only when it starts (already said otherwise)
    set({ notice: { kind: "spacingOverride", id: after.id, nonce: ++nonce } });
  }

  /** Typing into the ghost line creates the first real row. */
  function materializeGhost(rawInput: string): string {
    const id = newId();
    const now = nowIso();
    // After every row, hidden ones included, so it never shares a position with one.
    let last: string | null = null;
    for (const a of Object.values(get().activities)) if (!a.deletedAt && (last === null || a.position > last)) last = a.position;
    // On a filtered page the first line gets the filter's flag too (the caret stays in the text).
    filterKeep.add(id);
    const text = withFilterFlag(rawInput, get().filter, ctx(), markLocale());
    const row = rowFor({ id, rawInput: text, position: generateKeyBetween(last, null) }, now);
    set({ activities: { ...get().activities, [id]: row }, focus: { id, offset: rawInput.length, nonce: ++nonce } });
    void writeRows([row]);
    return id;
  }

  /**
   * After load: re-derive every line against the current flags (a line typed before its flag
   * existed, or a flag created on another device). Only real differences are written.
   */
  function reconcileAll(): Promise<void> {
    const c = ctx();
    const now = nowIso();
    const rows: Activity[] = [];
    for (const row of Object.values(get().activities)) {
      if (row.deletedAt) continue;
      const { fields } = deriveTextFields(row, row.rawInput ?? "", c);
      const differs = (Object.keys(fields) as (keyof ActivityRow)[]).some((k) => (fields[k] ?? null) !== (row[k] ?? null));
      if (differs) rows.push({ ...row, ...fields, editedAt: now, dirty: 1 });
    }
    const all = Object.values(get().activities).filter((r) => !r.deletedAt);
    const changedIds = new Set(rows.map((r) => r.id));
    const ops = linkOps(all.filter((r) => !changedIds.has(r.id)), now);
    if (rows.length > 0) return commitRows(rows);
    if (ops.length === 0) return Promise.resolve();
    return getDb().then((db) => enqueue(() => db.putManyLocal(ops)));
  }

  async function seedFlags(ownerSub: string) {
    const db = await getDb();
    const seed = missingDefaultFlags(ownerSub, await db.getAll("Flag"));
    if (seed.length === 0) return;
    await enqueue(() => db.putManyLocal(seed.map((row): WriteOp => ({ model: "Flag", row }))));
    set({ flags: liveFlags(await db.getAll("Flag")) });
    await reconcileAll();
  }

  const indexOf = (id: string) => lines().findIndex((l) => l.id === id);
  const hasFlags = (row: Pick<ActivityRow, "rawInput">) => parseLine(row.rawInput ?? "", ctx()).flagIds.length > 0;

  return {
    status: "idle",
    activities: {},
    activityFlags: {},
    flags: [],
    focus: null,
    undo: null,
    panel: null,
    notice: null,
    filter: kvGetJson<string[]>(FILTER_KEY, []),

    setFilter(filter) {
      filterKeep.clear();
      kvSetJson(FILTER_KEY, filter);
      set({ filter });
    },

    async load(ownerSub) {
      const status = get().status;
      if (status === "loading") return;
      if (status === "ready") {
        // Already on screen: never blank the page; only add flags the user is missing.
        if (ownerSub) await seedFlags(ownerSub);
        return;
      }
      set({ status: "loading" });
      try {
        const db = await getDb();
        let flagRows = await db.getAll("Flag");
        if (ownerSub) {
          const seed = missingDefaultFlags(ownerSub, flagRows);
          if (seed.length > 0) {
            await enqueue(() => db.putManyLocal(seed.map((row): WriteOp => ({ model: "Flag", row }))));
            flagRows = await db.getAll("Flag");
          }
        }
        const [rows, links] = await Promise.all([db.getAll("Activity"), db.getAll("ActivityFlag")]);
        const activities: Record<string, Activity> = {};
        // Completed tasks stay on the device; the Completed page reads them when it is open.
        for (const row of rows) if (keepInMemory(row)) activities[row.id] = row;
        // Rows adopted while loading (a completed task's panel opened meanwhile) stay.
        for (const [id, row] of Object.entries(get().activities)) if (!activities[id]) activities[id] = row;
        // Edits the last session could not commit (closed or reloaded mid-write).
        const replay = rowsToReplay(activities);
        for (const row of replay) activities[row.id] = { ...row, dirty: 1 };
        const activityFlags: Record<string, Link> = {};
        for (const link of links) activityFlags[link.id] = link;
        set({ activities, activityFlags, flags: liveFlags(flagRows), status: "ready" });
        if (replay.length > 0) await writeRows(replay.map((row) => activities[row.id]!));
        await reconcileAll();
      } catch (e) {
        console.error("[bacuyy] could not load the page", e);
        set({ status: "error" });
      }
    },

    type(id, rawInput) {
      if (id === GHOST_LINE_ID) {
        if (rawInput.length > 0) materializeGhost(rawInput.replace(/\r\n|\r|\n/g, " "));
        return;
      }
      const existing = get().activities[id];
      if (!existing) return;
      const clean = rawInput.replace(/\r\n|\r|\n/g, " ");
      const row = rowFor({ id, rawInput: clean, position: existing.position }, nowIso());
      set({ activities: { ...get().activities, [id]: row } });
      noteSpacingOverride(existing, row);
      journalPut([row]); // the debounce may never fire if the page is closed now
      const prev = timers.get(id);
      if (prev) clearTimeout(prev);
      timers.set(
        id,
        setTimeout(() => {
          timers.delete(id);
          const latest = get().activities[id];
          if (latest) void writeRows([latest]);
        }, TEXT_DEBOUNCE_MS),
      );
    },

    async commit(id) {
      const row = get().activities[id];
      if (!row) return;
      const raw = row.rawInput ?? "";
      const committed = commitLine(raw, ctx());
      if (committed !== raw) get().type(id, committed);
      await flushText(id);
    },

    async enter(id, selStart, selEnd) {
      if (id === GHOST_LINE_ID) return;
      const all = lines();
      const index = all.findIndex((l) => l.id === id);
      if (index < 0) return;
      let working = all;
      if (selEnd > selStart) {
        const line = all[index]!;
        working = all.slice();
        working[index] = { ...line, rawInput: line.rawInput.slice(0, selStart) + line.rawInput.slice(selEnd) };
      }
      const result = splitLine(working, index, selStart);
      if (selEnd > selStart && !result.changed.some((l) => l.id === id)) {
        result.changed.unshift(result.lines[index]!);
      }
      await apply(result);
    },

    async addLineAtEnd() {
      const all = lines();
      const last = all.at(-1);
      // An empty last line is already there to type in: focus it instead of piling up blanks.
      if (last && last.rawInput.trim() === "") {
        get().setFocus(last.id, last.rawInput.length);
        return;
      }
      if (!last) return; // the empty page shows its placeholder line already
      // After every row, hidden ones included, so it never shares a position with one.
      let max = last.position;
      for (const a of Object.values(get().activities)) if (!a.deletedAt && a.position > max) max = a.position;
      const created = { id: newId(), rawInput: "", position: generateKeyBetween(max, null) };
      await apply({ lines: [...all, created], changed: [created], created: [created.id], deleted: [], focus: { id: created.id, offset: 0 } });
    },

    async review(id, good) {
      const row = get().activities[id];
      if (!row || row.deletedAt || !isSpaced(row) || row.status === "COMPLETED") return;
      const now = new Date();
      const outcome = reviewOutcome(row.reviewStep, good);
      // The answer is kept as feedback too (the line's history): Bien 5, Mal 1.
      const feedbackId = await useFeedbackStore.getState().add(id, { rating: good ? 5 : 1 });
      // The line leaves the page: the focus goes to the line taking its place (or the one above).
      const all = lines();
      const index = all.findIndex((l) => l.id === id);
      const neighbour = index >= 0 ? all[index + 1] ?? all[index - 1] : undefined;
      if (neighbour) get().setFocus(neighbour.id, index + 1 < all.length ? 0 : neighbour.rawInput.length);
      const review = { good, feedbackId };
      if (outcome.done) {
        await get().updateFields(id, { reviewStep: outcome.step, status: "COMPLETED", completedAt: now.toISOString() });
        set({ notice: { kind: "completed", id, before: row, review, nonce: ++nonce } });
        return;
      }
      const until = reviewDueAt(outcome.step, now).toISOString();
      await get().updateFields(id, { reviewStep: outcome.step, hiddenUntil: until });
      set({ notice: { kind: "hidden", id, until, before: row, review, nonce: ++nonce } });
    },

    async backspaceAtStart(id) {
      const all = lines();
      const index = all.findIndex((l) => l.id === id);
      if (index < 0) return false;
      if (all[index]!.rawInput.length === 0) {
        if (all.length <= 1) return false;
        await apply(deleteEmpty(all, index));
        return true;
      }
      if (index === 0) return false;
      await apply(mergeUp(all, index), "merged");
      return true;
    },

    async deleteAtEnd(id) {
      const all = lines();
      const index = all.findIndex((l) => l.id === id);
      if (index < 0 || index >= all.length - 1) return false;
      await apply(mergeDown(all, index), "merged");
      return true;
    },

    async paste(id, selStart, selEnd, text) {
      if (id === GHOST_LINE_ID) {
        const realId = materializeGhost("");
        await get().paste(realId, 0, 0, text);
        return;
      }
      const index = indexOf(id);
      if (index < 0) return;
      await apply(pasteText(lines(), index, selStart, selEnd, text));
    },

    async move(id, delta) {
      const index = indexOf(id);
      if (index < 0) return;
      await get().moveTo(id, index + delta);
    },

    async moveTo(id, toIndex) {
      const all = lines();
      const index = all.findIndex((l) => l.id === id);
      if (index < 0) return;
      await apply(moveLine(all, index, toIndex));
    },

    setFocus(id, offset) {
      set({ focus: { id, offset, nonce: ++nonce } });
    },

    async undoLast() {
      const entry = get().undo;
      if (!entry) return;
      const now = nowIso();
      const rows = entry.rows.map((row) => ({ ...row, deletedAt: null, editedAt: now, dirty: 1 as const }));
      set({ undo: null });
      await commitRows(rows, entry.deletedAt);
    },

    dismissUndo() {
      set({ undo: null });
    },

    async flushAll() {
      await Promise.all([...timers.keys()].map(flushText));
      await writeChain;
    },

    // ─── lifecycle and panel ──────────────────────────────────────────────────────

    async tick(id) {
      const row = get().activities[id];
      if (!row || row.deletedAt) return;
      const result = tickRule(row, hasFlags(row));
      if (result.kind === "panel") {
        get().openPanel(id, result.section);
        return;
      }
      if (result.kind === "none") return;
      if (result.kind === "review") {
        set({ notice: { kind: "review", id, nonce: ++nonce } });
        return;
      }
      if (result.hidden || result.completed) {
        // The line leaves the page: the focus goes to the line taking its place (or the one above).
        const all = lines();
        const index = all.findIndex((l) => l.id === id);
        const neighbour = index >= 0 ? all[index + 1] ?? all[index - 1] : undefined;
        if (neighbour) get().setFocus(neighbour.id, index + 1 < all.length ? 0 : neighbour.rawInput.length);
      }
      await get().updateFields(id, result.patch);
      if (result.formedHint) set({ notice: { kind: "habitFormed", id, nonce: ++nonce } });
      else if (result.hidden) {
        set({ notice: { kind: "hidden", id, until: result.patch.hiddenUntil ?? undefined, before: row, nonce: ++nonce } });
      } else if (result.completed) set({ notice: { kind: "completed", id, before: row, nonce: ++nonce } });
    },

    async updateFields(id, patch) {
      const row = get().activities[id];
      if (!row) return;
      // Text-owned fields are never patched directly: they would disagree with the marks.
      const { rawInput: _r, title: _t, activityType: _a, ...rest } = patch;
      await commitRows([{ ...row, ...rest, editedAt: nowIso(), dirty: 1 }]);
    },

    async setRawInput(id, rawInput, patch = {}) {
      const row = get().activities[id];
      if (!row) return;
      const clean = rawInput.replace(/\r\n|\r|\n/g, " ");
      const next = rowFor({ id, rawInput: clean, position: row.position }, nowIso(), patch);
      noteSpacingOverride(row, next);
      await commitRows([next]);
    },

    async statusAction(id, action) {
      const row = get().activities[id];
      if (!row) return false;
      const patch = applyStatusAction(row, action, hasFlags(row));
      if (!patch) return false;
      await get().updateFields(id, patch);
      if (patch.status === "ARCHIVED" && get().panel?.id === id) set({ panel: null });
      return true;
    },

    async deleteLine(id) {
      const all = lines();
      const index = all.findIndex((l) => l.id === id);
      if (index < 0) {
        // Not on the page (its panel was opened from the Completed page): delete it alone.
        const row = get().activities[id];
        if (!row || row.deletedAt) return;
        const now = nowIso();
        if (get().panel?.id === id) set({ panel: null });
        await commitRows([{ ...row, deletedAt: now, editedAt: now, dirty: 1 }]);
        return;
      }
      const neighbour = all[index - 1] ?? all[index + 1];
      await apply(
        {
          lines: all.filter((l) => l.id !== id),
          changed: [],
          created: [],
          deleted: [id],
          focus: neighbour ? { id: neighbour.id, offset: neighbour.rawInput.length } : null,
        },
        "deleted",
      );
    },

    openPanel(id, section = null) {
      if (!get().activities[id]) return;
      set({ panel: { id, section, nonce: ++nonce } });
    },

    closePanel() {
      const panel = get().panel;
      if (!panel) return;
      set({ panel: null });
      const row = get().activities[panel.id];
      const onPage = row && !row.deletedAt && row.status !== "ARCHIVED" && row.status !== "COMPLETED";
      if (onPage) get().setFocus(panel.id, (row.rawInput ?? "").length);
    },

    dismissNotice() {
      set({ notice: null });
    },

    async undoHide() {
      const notice = get().notice;
      if ((notice?.kind !== "hidden" && notice?.kind !== "completed") || !notice.before) return;
      const current = get().activities[notice.id];
      set({ notice: null });
      if (!current || current.deletedAt) return;
      const { completionCount, streak, hiddenUntil, isHidden, status, completedAt, reviewStep } = notice.before;
      if (notice.review) void useFeedbackStore.getState().remove(notice.review.feedbackId);
      await get().updateFields(notice.id, {
        completionCount,
        streak,
        reviewStep: reviewStep ?? null,
        hiddenUntil: hiddenUntil ?? null,
        isHidden: isHidden ?? false,
        status,
        completedAt: completedAt ?? null,
      });
      get().setFocus(notice.id, (current.rawInput ?? "").length);
    },

    async showNow(id) {
      const row = get().activities[id];
      if (!row || (!row.hiddenUntil && !row.isHidden)) return;
      await get().updateFields(id, { hiddenUntil: null, isHidden: false });
    },

    async hide(id, until) {
      const row = get().activities[id];
      if (!row || row.deletedAt) return;
      const all = lines();
      const index = all.findIndex((l) => l.id === id);
      const neighbour = index >= 0 ? all[index + 1] ?? all[index - 1] : undefined;
      if (neighbour) get().setFocus(neighbour.id, index + 1 < all.length ? 0 : neighbour.rawInput.length);
      if (get().panel?.id === id) set({ panel: null });
      await get().updateFields(id, until ? { hiddenUntil: until, isHidden: false } : { hiddenUntil: null, isHidden: true });
      set({ notice: { kind: "hidden", id, until: until ?? undefined, manual: true, before: row, nonce: ++nonce } });
    },

    hasFlags(id) {
      const row = get().activities[id];
      return row ? hasFlags(row) : false;
    },

    async restore(id) {
      const row = get().activities[id];
      if (!row || row.deletedAt || row.status !== "ARCHIVED") return;
      const last = pageLines(get().activities).at(-1); // the end of the whole page, filter or not
      const patch: Partial<ActivityRow> = {
        status: reactivatedStatus(hasFlags(row)),
        position: generateKeyBetween(last?.position ?? null, null),
      };
      // Archiving an expiration marked it renewed; back on the page it is pending again.
      if (row.activityType === "EXPIRATION") patch.isRenewed = false;
      await get().updateFields(id, patch);
    },

    async deleteArchived(id) {
      const row = get().activities[id];
      if (!row || row.deletedAt || row.status !== "ARCHIVED") return;
      const now = nowIso();
      await commitRows([{ ...row, deletedAt: now, editedAt: now, dirty: 1 }]);
    },

    async reopen(id) {
      const row = get().activities[id] ?? (await (await getDb()).get("Activity", id));
      if (!row || row.deletedAt || row.status !== "COMPLETED") return;
      get().adopt([row]);
      // Its position was kept: it goes back to where it was.
      await get().updateFields(id, { status: reactivatedStatus(hasFlags(row)), completedAt: null });
    },

    async deleteCompleted(id) {
      const row = get().activities[id] ?? (await (await getDb()).get("Activity", id));
      if (!row || row.deletedAt || row.status !== "COMPLETED") return;
      const now = nowIso();
      await commitRows([{ ...row, deletedAt: now, editedAt: now, dirty: 1 }]);
    },

    adopt(rows) {
      const missing = rows.filter((row) => !get().activities[row.id]);
      if (missing.length === 0) return;
      const next = { ...get().activities };
      for (const row of missing) next[row.id] = row;
      set({ activities: next });
    },

    async refresh() {
      if (get().status !== "ready") return;
      const db = await getDb();
      await writeChain; // our own writes first, so we read what we wrote
      const [rows, links, flagRows] = await Promise.all([db.getAll("Activity"), db.getAll("ActivityFlag"), db.getAll("Flag")]);
      const before = get().activities;
      const activities: Record<string, Activity> = {};
      for (const row of rows) {
        const mine = before[row.id];
        // Completed tasks are not loaded, unless already in memory (completed here, or opened
        // from the Completed page).
        if (!mine && !keepInMemory(row)) continue;
        // A line with text still waiting for its debounce keeps the memory version (newer).
        if (mine && timers.has(row.id)) activities[row.id] = mine;
        // Same edit: keep the same object, so unchanged lines do not re-render.
        else activities[row.id] = mine && mine.editedAt === row.editedAt ? mine : row;
      }
      for (const id of timers.keys()) if (!activities[id] && before[id]) activities[id] = before[id]!;
      const activityFlags: Record<string, Link> = {};
      for (const link of links) activityFlags[link.id] = link;
      const flags = liveFlags(flagRows);
      const old = get().flags;
      // Marks only care about names and the tree; the priority view also needs the weights.
      const sameFlags = flags.length === old.length && flags.every((f, i) => {
        const g = old[i];
        return g && g.id === f.id && g.name === f.name && g.parentId === f.parentId;
      });
      const sameRows = sameFlags && flags.every((f, i) => f.editedAt === old[i]!.editedAt && f.weight === old[i]!.weight);
      const panel = get().panel;
      const panelRow = panel ? activities[panel.id] : undefined;
      set({
        activities,
        activityFlags,
        flags: sameRows ? old : flags,
        panel: panel && panelRow && !panelRow.deletedAt && panelRow.status !== "ARCHIVED" ? panel : null,
      });
      // Marks resolve differently now: lines typed since the flag write re-derive too.
      if (!sameFlags) await reconcileAll();
    },
  };
});

/** Forget everything in memory (sign out, another user). The database is handled separately. */
export function resetPageStore() {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  filterKeep.clear();
  resetRowHistory();
  writeChain = Promise.resolve();
  usePageStore.setState({
    status: "idle",
    activities: {},
    activityFlags: {},
    flags: [],
    focus: null,
    undo: null,
    panel: null,
    notice: null,
    filter: kvGetJson<string[]>(FILTER_KEY, []),
  });
}

export const resetPageStoreForTests = resetPageStore;

export type { ActivityRow };
