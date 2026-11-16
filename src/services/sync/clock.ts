import type { LocalDb } from "@/lib/db/types";

/**
 * Device clock corrected by the estimated offset to the server (CLAUDE.md, Clock caveat).
 * "Last edit wins" compares `editedAt` values written by different devices, so they all use
 * `now()` from here, never `Date.now()` directly.
 *
 * Each upsert response gives a sample: offset ≈ serverUpdatedAt − midpoint(request, response).
 * The median of the last MAX_SAMPLES is used and persisted in `sync_meta.clockOffsetMs`.
 */

const MAX_SAMPLES = 10;
/** Ignore samples from very slow round trips: the midpoint is too uncertain. */
const MAX_ROUND_TRIP_MS = 10_000;

let offsetMs = 0;
let samples: number[] = [];

export function now(): number {
  return Date.now() + offsetMs;
}

/** `editedAt` value for a change made right now. Always `toISOString()`: string order = time order. */
export function nowIso(): string {
  return new Date(now()).toISOString();
}

export function getClockOffset(): number {
  return offsetMs;
}

/**
 * Stored as `{ v: 2, ms }`. A bare number is the format written before 2026-11-15, when
 * refused upserts were sampled too and could leave a wrong offset: it is ignored.
 */
interface StoredOffset {
  v: 2;
  ms: number;
}

export async function loadClockOffset(db: LocalDb): Promise<void> {
  const stored = await db.getMeta<StoredOffset | number>("clockOffsetMs");
  offsetMs = typeof stored === "object" && stored?.v === 2 && Number.isFinite(stored.ms) ? stored.ms : 0;
  samples = [];
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Records one sample from an upsert round trip.
 * `requestStartMs` / `responseEndMs` are raw `Date.now()` values (not corrected).
 * Returns the new offset.
 */
export async function observeServerTime(
  serverIso: string | null | undefined,
  requestStartMs: number,
  responseEndMs: number,
  db?: LocalDb,
): Promise<number> {
  const server = serverIso ? Date.parse(serverIso) : NaN;
  const roundTrip = responseEndMs - requestStartMs;
  if (!Number.isFinite(server) || roundTrip < 0 || roundTrip > MAX_ROUND_TRIP_MS) return offsetMs;

  samples.push(server - (requestStartMs + responseEndMs) / 2);
  if (samples.length > MAX_SAMPLES) samples.shift();
  offsetMs = Math.round(median(samples));
  await db?.setMeta("clockOffsetMs", { v: 2, ms: offsetMs } satisfies StoredOffset);
  return offsetMs;
}

/** Test helper. */
export function resetClockForTests(offset = 0) {
  offsetMs = offset;
  samples = [];
}
