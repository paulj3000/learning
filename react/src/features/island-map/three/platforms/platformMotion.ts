import type { Vec3 } from '../runtime/locationManifest';
import type { PlatformPathMode } from './platformSpec';

/**
 * Deterministic motion along authored waypoints (pure; no Three.js scene, no clock). Given the
 * same sequence of time steps it always lands in the same place, so a moving platform behaves
 * identically on every device and in tests.
 *
 * The path starts at offset (0, 0, 0) and visits each waypoint. `PING_PONG` turns round at
 * either end, `LOOP` returns to the start and goes round again, `ONCE` stops at the end. The
 * platform waits `pauseSeconds` at every stop so a child can step on and off.
 */

export interface PathMotionState {
  /** Index of the point travelled from. */
  from: number;
  /** +1 forward along the list, -1 back (ping-pong). */
  direction: 1 | -1;
  /** Metres travelled from `from` toward the next point. */
  along: number;
  /** Seconds left waiting at `from`. */
  pauseLeft: number;
  /** `ONCE` reached its end. */
  finished: boolean;
}

export interface PathMotion {
  readonly points: readonly Vec3[];
  readonly mode: PlatformPathMode;
  readonly pauseSeconds: number;
  /** Length of each leg `points[i] -> points[i + 1]` (and the closing leg for `LOOP`). */
  readonly legs: readonly number[];
}

export function createPathMotion(path: readonly Vec3[], mode: PlatformPathMode = 'PING_PONG', pauseSeconds = 0): PathMotion {
  const points = [{ x: 0, y: 0, z: 0 }, ...path];
  const legs: number[] = [];
  const count = mode === 'LOOP' ? points.length : points.length - 1;
  for (let i = 0; i < count; i += 1) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    legs.push(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z));
  }
  return { points, mode, pauseSeconds: Math.max(0, pauseSeconds), legs };
}

export function initialMotionState(): PathMotionState {
  return { from: 0, direction: 1, along: 0, pauseLeft: 0, finished: false };
}

export function copyMotionState(source: PathMotionState, into: PathMotionState): PathMotionState {
  into.from = source.from;
  into.direction = source.direction;
  into.along = source.along;
  into.pauseLeft = source.pauseLeft;
  into.finished = source.finished;
  return into;
}

function nextIndex(motion: PathMotion, state: PathMotionState): number {
  const last = motion.points.length - 1;
  if (motion.mode === 'LOOP') return (state.from + 1) % motion.points.length;
  return state.from + state.direction < 0 || state.from + state.direction > last
    ? state.from - state.direction
    : state.from + state.direction;
}

function legLength(motion: PathMotion, from: number, to: number): number {
  const a = motion.points[from]!;
  const b = motion.points[to]!;
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}

/**
 * Advances `state` by `seconds` at `speed` m/s. `toStart` heads back to the first point and
 * stops there (a platform returning when its trigger lets go). Returns true while moving.
 */
export function advanceMotion(
  motion: PathMotion,
  state: PathMotionState,
  seconds: number,
  speed: number,
  toStart = false,
): boolean {
  if (motion.points.length < 2 || !(speed > 0)) return false;
  let time = Math.max(0, seconds);
  let moved = false;
  // Bounded: a long frame never spins forever.
  for (let guard = 0; guard < 64 && time > 1e-9; guard += 1) {
    if (toStart) {
      if (state.from === 0 && state.along <= 1e-9) {
        state.direction = 1;
        state.finished = false;
        return moved;
      }
      // Turn round toward the start (along the way it came for ping-pong and once).
      if (state.along > 1e-9 && state.direction === 1 && motion.mode !== 'LOOP') {
        const to = nextIndex(motion, state);
        const length = legLength(motion, state.from, to);
        state.along = length - state.along;
        state.from = to;
        state.direction = -1;
      } else if (state.along <= 1e-9 && motion.mode !== 'LOOP') {
        state.direction = -1;
      }
      state.pauseLeft = 0;
    }
    if (state.finished && !toStart) return moved;
    if (state.pauseLeft > 0) {
      const wait = Math.min(state.pauseLeft, time);
      state.pauseLeft -= wait;
      time -= wait;
      continue;
    }
    const to = nextIndex(motion, state);
    const length = legLength(motion, state.from, to);
    const remaining = length - state.along;
    const step = speed * time;
    moved = true;
    if (step < remaining) {
      state.along += step;
      return moved;
    }
    time -= remaining / speed;
    state.from = to;
    state.along = 0;
    const last = motion.points.length - 1;
    if (toStart && to === 0) {
      state.direction = 1;
      return moved;
    }
    if (motion.mode === 'ONCE' && to === last) {
      state.finished = true;
      return moved;
    }
    if (motion.mode === 'PING_PONG' && (to === last || to === 0)) {
      state.direction = to === last ? -1 : 1;
    }
    state.pauseLeft = motion.pauseSeconds;
  }
  return moved;
}

/** The current offset from the rest position, written into `out`. */
export function motionOffset(motion: PathMotion, state: PathMotionState, out: { x: number; y: number; z: number }) {
  const from = motion.points[state.from]!;
  if (motion.points.length < 2 || state.along <= 0) {
    out.x = from.x;
    out.y = from.y;
    out.z = from.z;
    return out;
  }
  const to = motion.points[nextIndex(motion, state)]!;
  const length = legLength(motion, state.from, nextIndex(motion, state));
  const t = length > 0 ? Math.min(1, state.along / length) : 0;
  out.x = from.x + (to.x - from.x) * t;
  out.y = from.y + (to.y - from.y) * t;
  out.z = from.z + (to.z - from.z) * t;
  return out;
}

/** Where a path ends (its last waypoint), for the destination marker. */
export function pathEnd(motion: PathMotion): Vec3 {
  return motion.points[motion.points.length - 1]!;
}
