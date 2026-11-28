/**
 * Guided steering (LAI-2104S step B1): turns a walk path into the `MoveInput` the shared
 * `FirstPersonController` already consumes. It is not a second character controller: it only
 * decides forward and strafe each frame, in the controller's own yaw convention, and never
 * asks for a jump (the Jump button still hops in place through the usual `pressJump`).
 *
 * Joystick, keyboard and gamepad input override it: any manual push cancels the path at once
 * and passes through unchanged.
 */

import type { MoveInput } from '../movement/firstPersonController';
import type { GroundXZ } from './walkGrid';

export interface GuidedSteeringOptions {
  /** A waypoint counts as reached within this many metres. Default 0.12 (tight: a corner is cut only as far as the wall margin allows). */
  waypointRadius?: number;
  /** The path's end counts as reached within this many metres. Default 0.15. */
  arriveRadius?: number;
  /** Slow down over the last this many metres. Default 0.6. */
  easeDistance?: number;
  /** Slowest eased push (0 to 1). Default 0.4. */
  minPush?: number;
  /** Give up when no progress for this long, seconds. Default 1.5. */
  stuckSeconds?: number;
  /** Progress that resets the stuck clock, metres. Default 0.15. */
  stuckProgress?: number;
  /** A manual push beyond this magnitude overrides the path. Default 0.05. */
  manualThreshold?: number;
}

export type GuidedEvent =
  | { type: 'STARTED'; goal: GroundXZ }
  | { type: 'ARRIVED'; goal: GroundXZ }
  | { type: 'CANCELLED'; reason: 'MANUAL' | 'STUCK' | 'REPLACED' | 'CLEARED' };

export interface SteerResult {
  /** The input to hand the controller this frame. */
  input: MoveInput;
  source: 'manual' | 'guided' | 'idle';
  /** The direction of travel on the ground, radians in the controller's yaw convention, or null. */
  heading: number | null;
}

const NO_INPUT: MoveInput = { forward: 0, strafe: 0 };

/** The yaw (controller convention: 0 faces +Z) that looks from `from` toward `to`. */
export function headingTo(from: GroundXZ, to: GroundXZ): number {
  return Math.atan2(to.x - from.x, to.z - from.z);
}

export class GuidedSteering {
  private readonly o: Required<GuidedSteeringOptions>;
  private waypoints: GroundXZ[] = [];
  private index = 0;
  private events: GuidedEvent[] = [];
  private stuckFor = 0;
  private bestDistance = Infinity;

  constructor(options: GuidedSteeringOptions = {}) {
    this.o = {
      waypointRadius: options.waypointRadius ?? 0.12,
      arriveRadius: options.arriveRadius ?? 0.15,
      easeDistance: options.easeDistance ?? 0.6,
      minPush: options.minPush ?? 0.4,
      stuckSeconds: options.stuckSeconds ?? 1.5,
      stuckProgress: options.stuckProgress ?? 0.15,
      manualThreshold: options.manualThreshold ?? 0.05,
    };
  }

  get active(): boolean {
    return this.waypoints.length > 0;
  }

  /** The waypoints still ahead (for a route marker), or empty. */
  get remaining(): readonly GroundXZ[] {
    return this.waypoints.slice(this.index);
  }

  /** Follows `points` (the first is where the child stands). Replaces any path in progress. */
  start(points: readonly GroundXZ[]): void {
    if (this.active) this.events.push({ type: 'CANCELLED', reason: 'REPLACED' });
    this.waypoints = points.slice(1).map((p) => ({ x: p.x, z: p.z }));
    this.index = 0;
    this.stuckFor = 0;
    this.bestDistance = Infinity;
    if (this.waypoints.length === 0) return;
    this.events.push({ type: 'STARTED', goal: this.waypoints[this.waypoints.length - 1] });
  }

  cancel(reason: 'MANUAL' | 'STUCK' | 'CLEARED' = 'CLEARED'): void {
    if (!this.active) return;
    this.waypoints = [];
    this.index = 0;
    this.events.push({ type: 'CANCELLED', reason });
  }

  /** Drains what happened since the last call. */
  consumeEvents(): GuidedEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  /**
   * One frame. `manual` is what the joystick, keys or pad say; a push overrides and cancels the
   * path. Otherwise the result steers toward the next waypoint, in the controller's frame:
   * forward along `yaw`, strafe to its right.
   */
  steer(
    position: GroundXZ,
    yaw: number,
    deltaSeconds: number,
    manual: MoveInput | null = null,
  ): SteerResult {
    const m = manual ?? NO_INPUT;
    if (Math.hypot(m.forward, m.strafe) > this.o.manualThreshold) {
      this.cancel('MANUAL');
      return { input: m, source: 'manual', heading: null };
    }
    if (!this.active) return { input: m, source: 'idle', heading: null };

    // Advance past waypoints already reached (the last one uses the tighter arrive radius).
    for (;;) {
      const last = this.index === this.waypoints.length - 1;
      const target = this.waypoints[this.index];
      const reach = last ? this.o.arriveRadius : this.o.waypointRadius;
      if (Math.hypot(target.x - position.x, target.z - position.z) > reach) break;
      if (last) {
        const goal = target;
        this.waypoints = [];
        this.index = 0;
        this.events.push({ type: 'ARRIVED', goal });
        return { input: NO_INPUT, source: 'idle', heading: null };
      }
      this.index += 1;
      this.bestDistance = Infinity;
      this.stuckFor = 0;
    }

    const target = this.waypoints[this.index];
    const dx = target.x - position.x;
    const dz = target.z - position.z;
    const distance = Math.hypot(dx, dz);

    // Stuck: no real progress toward this waypoint for a while (a moving obstacle, a late collider).
    if (distance < this.bestDistance - this.o.stuckProgress) {
      this.bestDistance = distance;
      this.stuckFor = 0;
    } else {
      this.stuckFor += Math.max(0, deltaSeconds);
      if (this.stuckFor >= this.o.stuckSeconds) {
        this.cancel('STUCK');
        return { input: NO_INPUT, source: 'idle', heading: null };
      }
    }

    // Distance left along the whole path eases the last stretch.
    let left = distance;
    for (let i = this.index; i < this.waypoints.length - 1; i += 1) {
      left += Math.hypot(
        this.waypoints[i + 1].x - this.waypoints[i].x,
        this.waypoints[i + 1].z - this.waypoints[i].z,
      );
    }
    const push =
      left >= this.o.easeDistance ? 1 : Math.max(this.o.minPush, left / this.o.easeDistance);

    const ux = dx / distance;
    const uz = dz / distance;
    // The controller's frame: forward (sin yaw, cos yaw); right (-cos yaw, sin yaw).
    const forward = ux * Math.sin(yaw) + uz * Math.cos(yaw);
    const strafe = ux * -Math.cos(yaw) + uz * Math.sin(yaw);
    return {
      input: { forward: forward * push, strafe: strafe * push },
      source: 'guided',
      heading: Math.atan2(ux, uz),
    };
  }
}
