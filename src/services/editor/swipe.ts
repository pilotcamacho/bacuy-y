/**
 * Swipe a line to the right to hide it (docs/05-line-mapping.md §3). Pure.
 * - Past the first stop: hide until tomorrow 8:00 ("quick").
 * - Past the second stop: choose until when ("pick").
 * - Released before the first stop: nothing (the line slides back).
 */

export type SwipeStage = "none" | "quick" | "pick";

/** Sideways movement (px) before the gesture counts as a swipe (and not a tap or a scroll). */
export const SWIPE_START_PX = 10;

/** The two stops, as a share of the line's width (with a minimum in px for narrow lines). */
export function swipeStops(width: number): { quick: number; pick: number } {
  return { quick: Math.max(64, width * 0.3), pick: Math.max(160, width * 0.62) };
}

export function swipeStage(dx: number, width: number): SwipeStage {
  const stops = swipeStops(width);
  if (dx >= stops.pick) return "pick";
  if (dx >= stops.quick) return "quick";
  return "none";
}

/**
 * Whether a movement from the start of the touch is a swipe to the right: clearly sideways
 * (not a vertical scroll), to the right (left is unused) and past SWIPE_START_PX.
 * "scroll" = mostly vertical: the gesture is left to the browser.
 */
export function swipeIntent(dx: number, dy: number): "swipe" | "scroll" | "undecided" {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ay > SWIPE_START_PX && ay >= ax) return "scroll";
  if (dx > SWIPE_START_PX && ax > ay * 1.5) return "swipe";
  if (ax > SWIPE_START_PX) return "scroll"; // to the left (unused) or too diagonal
  return "undecided";
}
