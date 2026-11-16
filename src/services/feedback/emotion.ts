/** A word for an emotion value, so the list never shows raw numbers. */
export function valenceKey(v: number): string {
  return v <= -0.34 ? "negative" : v >= 0.34 ? "positive" : "neutral";
}
export function arousalKey(a: number): string {
  return a <= 0.33 ? "calm" : a >= 0.67 ? "high" : "medium";
}
