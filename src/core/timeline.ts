/** Pure maths for the caption timeline. No DOM here, so it is unit tested. */

/** Markers snap to whole percent. */
export const SNAP = 0.01;
export const BIG_STEP = 0.05;
export const MAX_LANES = 3;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const snap = (n: number) => Math.round(n / SNAP) * SNAP;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Where on the strip (0 to 1) a pointer at `clientX` is, snapped to whole percent. */
export function fractionAt(clientX: number, left: number, width: number): number {
  if (!(width > 0)) return 0;
  return round2(clamp01(snap((clientX - left) / width)));
}

/** Keyboard nudge: 1% per arrow press, 5% with Shift. */
export function nudge(at: number, direction: -1 | 1, big = false): number {
  return round2(clamp01(at + direction * (big ? BIG_STEP : SNAP)));
}

/** Short label for a marker. */
export function shortLabel(text: string, max = 18): string {
  const t = text.trim();
  if (!t) return 'Empty text';
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/**
 * Stacks markers into rows so labels that sit close together don't overlap. Each marker goes in
 * the first row whose previous marker is at least `minGap` away. With every row busy, it goes in
 * the row that frees up soonest. Returns the row for each marker, in the original order.
 */
export function assignLanes(positions: number[], minGap: number, maxLanes = MAX_LANES): number[] {
  const order = positions.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p || a.i - b.i);
  const laneEnd: number[] = [];
  const lanes = new Array<number>(positions.length).fill(0);
  for (const { p, i } of order) {
    let lane = laneEnd.findIndex((end) => p - end >= minGap);
    if (lane === -1) {
      if (laneEnd.length < maxLanes) lane = laneEnd.length;
      else lane = laneEnd.indexOf(Math.min(...laneEnd));
    }
    laneEnd[lane] = p;
    lanes[i] = lane;
  }
  return lanes;
}
