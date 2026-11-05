/**
 * Collision and boundaries for NPC movement (LAI-NPC-024). No physics library.
 *
 * Movement is probed in steps of at most `COLLISION_STEP` metres. Each probe is clamped to the
 * circle of `boundsRadius` around the placement home; a probe that lands on a blocked point first
 * tries to slide along one axis (x, then z) and otherwise stops, reporting `blocked` so the
 * behaviour can skip to its next waypoint or pick a new wander target.
 *
 * The scene's own colliders are injected as `isBlocked(x, z)`. `isBlockedByRects` adapts the
 * ground rectangles the location manifests already use (`RectZone`, `sceneLayout.BoxBounds`
 * from `solidColliders(manifest)`, `ColliderSpec.rect`) without importing the island-map code:
 *
 *     isBlockedByRects(solidColliders(manifest, worldState).map((c) => c.box))
 *
 * and a hand-written helper such as `storykeeperCastleRegion.isBlocked` already has the shape.
 */

import { ARRIVAL_EPSILON, COLLISION_STEP } from './constants';
import { clampToCircle, type MutablePoint } from './geometry';

/** Any axis-aligned ground rectangle (Y ignored). `RectZone` and `BoxBounds` both fit. */
export interface GroundRect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export type IsBlocked = (x: number, z: number) => boolean;

/**
 * An `isBlocked` over plain ground rectangles, each grown by `margin` metres (an NPC's body
 * radius, so it does not clip into walls). The rectangles are copied once; the probe allocates
 * nothing.
 */
export function isBlockedByRects(rects: readonly GroundRect[], margin = 0): IsBlocked {
  const n = rects.length;
  const bounds = new Float64Array(n * 4);
  rects.forEach((rect, i) => {
    bounds[i * 4] = rect.minX - margin;
    bounds[i * 4 + 1] = rect.maxX + margin;
    bounds[i * 4 + 2] = rect.minZ - margin;
    bounds[i * 4 + 3] = rect.maxZ + margin;
  });
  return (x, z) => {
    for (let i = 0; i < n; i += 1) {
      const o = i * 4;
      if (x >= bounds[o] && x <= bounds[o + 1] && z >= bounds[o + 2] && z <= bounds[o + 3]) {
        return true;
      }
    }
    return false;
  };
}

export interface MoveContext {
  homeX: number;
  homeZ: number;
  boundsRadius: number;
  isBlocked: IsBlocked | null;
}

/** Reused result of `advanceToward` (one object per controller, no per-frame allocation). */
export interface MoveResult {
  /** Seconds of the budget this move used. */
  consumed: number;
  /** Metres actually travelled. */
  moved: number;
  arrived: boolean;
  /** Could not make progress (blocked both ways, or pinned by the boundary). */
  blocked: boolean;
}

export function createMoveResult(): MoveResult {
  return { consumed: 0, moved: 0, arrived: false, blocked: false };
}

/**
 * Moves `pos` (in place) toward `(targetX, targetZ)` at `speed` for at most `seconds`, honouring
 * the bounds circle and `isBlocked`. Arrival ends the move early so the caller can spend the rest
 * of the frame on the next phase (frame-rate independence).
 */
export function advanceToward(
  pos: MutablePoint,
  targetX: number,
  targetZ: number,
  speed: number,
  seconds: number,
  ctx: MoveContext,
  out: MoveResult,
  probe: MutablePoint,
): MoveResult {
  out.consumed = 0;
  out.moved = 0;
  out.arrived = false;
  out.blocked = false;
  if (speed <= 0) {
    out.blocked = true;
    return out;
  }
  const blocked = ctx.isBlocked;
  while (out.consumed < seconds - 1e-12) {
    const dx = targetX - pos.x;
    const dz = targetZ - pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist <= ARRIVAL_EPSILON) {
      pos.x = targetX;
      pos.z = targetZ;
      out.arrived = true;
      return out;
    }
    const step = Math.min(dist, speed * (seconds - out.consumed), COLLISION_STEP);
    const exact = step === dist;
    probe.x = exact ? targetX : pos.x + (dx / dist) * step;
    probe.z = exact ? targetZ : pos.z + (dz / dist) * step;
    clampToCircle(probe, ctx.homeX, ctx.homeZ, ctx.boundsRadius);
    // Only refuse entering a blocked point: an NPC spawned inside a collider may walk out.
    if (blocked && blocked(probe.x, probe.z) && !blocked(pos.x, pos.z)) {
      const nx = probe.x;
      const nz = probe.z;
      if (!blocked(nx, pos.z)) {
        probe.z = pos.z;
      } else if (!blocked(pos.x, nz)) {
        probe.x = pos.x;
      } else {
        out.blocked = true;
        return out;
      }
      clampToCircle(probe, ctx.homeX, ctx.homeZ, ctx.boundsRadius);
    }
    const progress = Math.hypot(probe.x - pos.x, probe.z - pos.z);
    out.consumed += step / speed;
    if (progress <= 1e-9) {
      out.blocked = true;
      return out;
    }
    pos.x = probe.x;
    pos.z = probe.z;
    out.moved += progress;
  }
  if (Math.hypot(targetX - pos.x, targetZ - pos.z) <= ARRIVAL_EPSILON) out.arrived = true;
  return out;
}
