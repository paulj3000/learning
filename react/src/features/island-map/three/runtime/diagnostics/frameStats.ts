/**
 * Frame-time statistics over a fixed-size ring buffer (SC-R11 diagnostics). Pure: every call
 * returns a new state and nothing is stored, sent or tied to a child. Non-finite and negative
 * deltas are ignored so a clock hiccup cannot poison the numbers.
 */
export const FRAME_RING_SIZE = 120;
export const SLOW_FRAME_MS = 33;

export interface FrameStatsState {
  /** Most recent deltas in milliseconds, at most `FRAME_RING_SIZE`, in ring order. */
  readonly ring: readonly number[];
  readonly next: number;
  /** Every accepted frame since the start, not just those still in the ring. */
  readonly count: number;
  /** Mean over the ring window. */
  readonly mean: number;
  /** 95th percentile over the ring window (nearest rank). */
  readonly p95: number;
  /** Worst over the ring window. */
  readonly worst: number;
  /** Every accepted frame since the start slower than `SLOW_FRAME_MS` (about 30 fps). */
  readonly over33msCount: number;
}

export const EMPTY_FRAME_STATS: FrameStatsState = {
  ring: [],
  next: 0,
  count: 0,
  mean: 0,
  p95: 0,
  worst: 0,
  over33msCount: 0,
};

export function reduceFrame(
  state: FrameStatsState,
  deltaMs: number,
  capacity: number = FRAME_RING_SIZE,
): FrameStatsState {
  if (!Number.isFinite(deltaMs) || deltaMs < 0) return state;
  const ring = state.ring.slice();
  if (ring.length < capacity) ring.push(deltaMs);
  else ring[state.next % capacity] = deltaMs;
  const next = (state.next + 1) % capacity;
  const sorted = ring.slice().sort((a, b) => a - b);
  const sum = ring.reduce((total, value) => total + value, 0);
  const rank = Math.max(0, Math.ceil(0.95 * sorted.length) - 1);
  return {
    ring,
    next,
    count: state.count + 1,
    mean: sum / ring.length,
    p95: sorted[rank] ?? 0,
    worst: sorted[sorted.length - 1] ?? 0,
    over33msCount: state.over33msCount + (deltaMs > SLOW_FRAME_MS ? 1 : 0),
  };
}
