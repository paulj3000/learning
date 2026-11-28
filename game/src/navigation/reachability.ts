/**
 * Public reachability helper for realm tests (LAI-2104S step B1; LAI 03 asked for it for the
 * Wonderwild Forest Sprouts route, WF-10: all 10 forest interactions reachable).
 *
 * "Reachable" means on walking links only: the same grid, the same hazard and step rules and
 * the same no-jump search a Sprouts child's tap uses, so a test that passes here proves a tap
 * can reach the goal. Flat-ground limitation (B1): terrain height is not modelled.
 *
 * ```ts
 * const input = { colliders, platforms, hazards, targets };
 * isReachable(input, { x: 0, z: 0 }, { id: 'forest-sign' }).reachable; // by target id
 * isReachable(input, start, { x: 4, z: -2, approachRange: 2.5 });      // a point, within range
 * unreachableTargets(input, start);                                      // ids that fail
 * ```
 */

import { EngineError } from '../core/errors';
import { floodReachable } from './pathSearch';
import {
  buildWalkGrid,
  type GroundXZ,
  type WalkBounds,
  type WalkGrid,
  type WalkGridOptions,
  type WalkTarget,
  type WalkabilityInput,
} from './walkGrid';

/** What to reach: a named target from `input.targets`, a point (with a range), or a rectangle. */
export type ReachabilityGoal =
  { id: string } | { x: number; z: number; approachRange?: number } | { rect: WalkBounds };

export interface ReachabilityResult {
  reachable: boolean;
  /** Straight-line distance from the closest reachable spot to the goal; 0 when reached. */
  nearestDistance: number;
  /** The closest reachable spot the child can walk to (the tap fallback), or `null` if walled in. */
  nearest: GroundXZ | null;
}

/** An object tap walks to within this range of its target (matches the runtime's approach range). */
export const DEFAULT_APPROACH_RANGE = 2.5;

function resolveGoal(
  input: WalkabilityInput,
  goal: ReachabilityGoal,
): { x: number; z: number; range: number } | { rect: WalkBounds } {
  if ('id' in goal) {
    const target: WalkTarget | undefined = input.targets?.find((t) => t.id === goal.id);
    if (!target) {
      throw new EngineError('UNKNOWN_ID', `No walk target "${goal.id}"`, { id: goal.id });
    }
    if ('rect' in target) return { rect: target.rect };
    return { x: target.x, z: target.z, range: target.approachRange ?? DEFAULT_APPROACH_RANGE };
  }
  if ('rect' in goal) return goal;
  return { x: goal.x, z: goal.z, range: goal.approachRange ?? 0 };
}

/**
 * Answers one goal from a flooded reach map. `range` 0 means the point itself: the cell holding
 * it, or one whose centre is within three quarters of a cell of it.
 */
function answer(
  grid: WalkGrid,
  reached: Uint8Array,
  goal: { x: number; z: number; range: number } | { rect: WalkBounds },
): ReachabilityResult {
  let nearest: GroundXZ | null = null;
  let nearestDistance = Infinity;
  let inside = false;
  for (let row = 0; row < grid.rows; row += 1) {
    for (let col = 0; col < grid.cols; col += 1) {
      if (reached[row * grid.cols + col] !== 1) continue;
      const c = grid.centerOf(col, row);
      let distance: number;
      if ('rect' in goal) {
        const r = goal.rect;
        const dx = Math.max(r.minX - c.x, 0, c.x - r.maxX);
        const dz = Math.max(r.minZ - c.z, 0, c.z - r.maxZ);
        distance = Math.hypot(dx, dz);
        if (distance === 0) inside = true;
      } else {
        distance = Math.hypot(c.x - goal.x, c.z - goal.z);
        if (distance <= (goal.range > 0 ? goal.range : grid.cellSize * 0.75)) inside = true;
      }
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = c;
      }
    }
  }
  return {
    reachable: inside,
    nearestDistance: nearest === null ? Infinity : inside ? 0 : nearestDistance,
    nearest,
  };
}

/** Builds the grid for `input` (or reuses a ready one) and floods it from `start` once. */
function prepare(
  source: WalkabilityInput | WalkGrid,
  start: GroundXZ,
  options?: WalkGridOptions,
): { grid: WalkGrid; reached: Uint8Array } {
  const grid = 'blocked' in source ? source : buildWalkGrid(source, options);
  return { grid, reached: floodReachable(grid, start) };
}

/**
 * Whether `goal` can be reached from `start` on walking links. `source` is the location's
 * colliders, platforms, hazards and optional named targets (or a grid already built).
 * An unknown target id throws `UNKNOWN_ID`.
 */
export function isReachable(
  source: WalkabilityInput | WalkGrid,
  start: GroundXZ,
  goal: ReachabilityGoal,
  options?: WalkGridOptions,
): ReachabilityResult {
  const input: WalkabilityInput = 'blocked' in source ? { colliders: [] } : source;
  const resolved = resolveGoal(input, goal);
  const { grid, reached } = prepare(source, start, options);
  return answer(grid, reached, resolved);
}

/** The ids among `ids` (default: every named target) that a child cannot reach from `start`. */
export function unreachableTargets(
  input: WalkabilityInput,
  start: GroundXZ,
  ids?: readonly string[],
  options?: WalkGridOptions,
): string[] {
  const wanted = ids ?? (input.targets ?? []).map((target) => target.id);
  const { grid, reached } = prepare(input, start, options);
  return wanted.filter((id) => !answer(grid, reached, resolveGoal(input, { id })).reachable);
}
