import { create } from "zustand";
import { getDb } from "@/lib/db/instance";
import { emit } from "@/lib/events";
import type { FeedbackRow, Stored } from "@/lib/db/types";
import { newId } from "@/lib/ids";
import { nowIso } from "@/services/sync/clock";

/**
 * Feedback entries of the lines whose panel is open (docs/05-line-mapping.md §5, section 7).
 * Reads and writes LocalDb only. Deleting a line soft-deletes its feedback (page store), so
 * this store only adds entries and deletes single ones.
 */

type Feedback = Stored<"Feedback">;

export interface FeedbackInput {
  rating: number; // 1–5
  emotionValence?: number | null; // −1..1
  emotionArousal?: number | null; // 0..1
  content?: string | null;
}

interface FeedbackState {
  /** Live entries per activity, newest first. Only activities asked for are loaded. */
  byActivity: Record<string, Feedback[]>;
  load(activityId: string): Promise<void>;
  /** Reloads every activity already loaded (after a sync or another tab's write). */
  refresh(): Promise<void>;
  add(activityId: string, input: FeedbackInput): Promise<string>;
  remove(id: string): Promise<void>;
}

const clamp = (n: number | null | undefined, min: number, max: number) =>
  n === null || n === undefined || !Number.isFinite(n) ? null : Math.min(max, Math.max(min, n));

export function cleanFeedback(input: FeedbackInput): Omit<FeedbackRow, "id" | "activityId" | "editedAt"> {
  const rating = Math.round(clamp(input.rating, 1, 5) ?? 0);
  if (rating < 1) throw new Error("rating 1–5 required");
  const content = input.content?.trim() ? input.content.trim() : null;
  return {
    rating,
    emotionValence: clamp(input.emotionValence, -1, 1),
    emotionArousal: clamp(input.emotionArousal, 0, 1),
    content,
    deletedAt: null,
  };
}

const newestFirst = (a: Feedback, b: Feedback) => (a.editedAt < b.editedAt ? 1 : a.editedAt > b.editedAt ? -1 : 0);

async function read(activityId: string): Promise<Feedback[]> {
  const db = await getDb();
  return (await db.listByIndex("Feedback", "activityId", activityId)).filter((f) => !f.deletedAt).sort(newestFirst);
}

export const useFeedbackStore = create<FeedbackState>((set, get) => ({
  byActivity: {},

  async load(activityId) {
    const rows = await read(activityId);
    set({ byActivity: { ...get().byActivity, [activityId]: rows } });
  },

  async refresh() {
    const ids = Object.keys(get().byActivity);
    const next: Record<string, Feedback[]> = {};
    for (const id of ids) next[id] = await read(id);
    set({ byActivity: next });
  },

  async add(activityId, input) {
    const row: FeedbackRow = { id: newId(), activityId, editedAt: nowIso(), ...cleanFeedback(input) };
    const db = await getDb();
    await db.putLocal("Feedback", row);
    emit({ type: "localWrite" });
    await get().load(activityId);
    return row.id;
  },

  async remove(id) {
    const db = await getDb();
    const stored = await db.get("Feedback", id);
    if (!stored || stored.deletedAt) return;
    const { dirty: _dirty, ...row } = stored;
    const now = nowIso();
    await db.putLocal("Feedback", { ...row, deletedAt: now, editedAt: now });
    emit({ type: "localWrite" });
    await get().load(row.activityId);
  },
}));

export function resetFeedbackStore() {
  useFeedbackStore.setState({ byActivity: {} });
}
