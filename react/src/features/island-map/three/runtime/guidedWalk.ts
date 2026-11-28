/**
 * LAI-2104S step B1: the live glue for a guided (Sprouts) tap-to-move walk. It owns no
 * movement: it plans a path on the engine's walk grid (`@lai/game-engine/navigation`), feeds
 * the shared controller through `GuidedSteering`, and tells the camera which way to turn.
 * No React, no Three.js objects: `createLocationEngine` supplies the live geometry and does
 * the picking.
 */

import type { MoveInput } from '@lai/game-engine/movement';
import {
  assistedYaw,
  buildWalkGrid,
  findWalkPath,
  GuidedSteering,
  headingTo,
  shortestAngle,
  type GuidedEvent,
  type GroundXZ,
  type WalkabilityInput,
  type WalkPath,
} from '@lai/game-engine/navigation';

export interface GuidedWalkDeps {
  /** The live geometry, read on every tap and replan (gates open, extensions add colliders). */
  walkability(): WalkabilityInput;
  position(): GroundXZ;
  reducedMotion: boolean;
}

export interface WalkToOptions {
  /** An object tap: stop within this many metres of the target. */
  stopWithin?: number;
  /** An object tap: turn to face the object once there. */
  faceTarget?: boolean;
}

export interface GuidedWalk {
  /** Plans and starts a walk to `target`. `null` (nothing started) when the start is walled in. */
  walkTo(target: GroundXZ, options?: WalkToOptions): WalkPath | null;
  /** Per frame: the manual input in, the input for the controller out. Manual input cancels the walk. */
  shapeInput(manual: MoveInput, deltaSeconds: number, yaw: number): MoveInput;
  /** Per frame, after the controller moved: the camera yaw to use (assisted; no free look). */
  assistYaw(yaw: number, deltaSeconds: number): number;
  cancel(): void;
  readonly active: boolean;
  /** Drains STARTED / ARRIVED / CANCELLED. */
  consumeEvents(): GuidedEvent[];
}

export function createGuidedWalk(deps: GuidedWalkDeps): GuidedWalk {
  const steering = new GuidedSteering();
  let heading: number | null = null;
  /** After an object tap arrives: the way to look until the view has turned to it. */
  let faceHeading: number | null = null;
  let goal: { target: GroundXZ; options: WalkToOptions } | null = null;
  let retries = 0;
  const pending: GuidedEvent[] = [];

  function plan(target: GroundXZ, options: WalkToOptions): WalkPath | null {
    const from = deps.position();
    const grid = buildWalkGrid(deps.walkability());
    const path = findWalkPath(grid, from, target, { stopWithin: options.stopWithin ?? 0 });
    if (path.status === 'NONE') return null;
    steering.start(path.points);
    return path;
  }

  return {
    walkTo(target, options = {}) {
      faceHeading = null;
      retries = 0;
      goal = { target, options };
      const path = plan(target, options);
      if (!path) {
        goal = null;
        return null;
      }
      return path;
    },
    shapeInput(manual, deltaSeconds, yaw) {
      const result = steering.steer(deps.position(), yaw, deltaSeconds, manual);
      heading = result.heading;
      for (const event of steering.consumeEvents()) {
        if (event.type === 'CANCELLED' && event.reason === 'STUCK' && goal && retries < 1) {
          // A late collider or a moving thing: one fresh plan from where the child is now.
          retries += 1;
          if (plan(goal.target, goal.options)) continue;
        }
        // A new walk replacing the old one is internal bookkeeping, not news for the host.
        if (event.type === 'CANCELLED' && event.reason === 'REPLACED') continue;
        pending.push(event);
        if (event.type === 'ARRIVED' && goal?.options.faceTarget) {
          faceHeading = headingTo(deps.position(), goal.target);
        }
        if (event.type === 'CANCELLED' && event.reason === 'MANUAL') faceHeading = null;
        if (event.type !== 'STARTED') goal = null;
      }
      return result.input;
    },
    assistYaw(yaw, deltaSeconds) {
      const turnTo = heading ?? faceHeading;
      if (
        heading === null &&
        faceHeading !== null &&
        Math.abs(shortestAngle(yaw, faceHeading)) < 0.03
      ) {
        faceHeading = null;
        return yaw;
      }
      return assistedYaw(yaw, turnTo, deltaSeconds, { reducedMotion: deps.reducedMotion });
    },
    cancel() {
      steering.cancel('CLEARED');
      steering.consumeEvents();
      heading = null;
      faceHeading = null;
      goal = null;
    },
    get active() {
      return steering.active;
    },
    consumeEvents() {
      const out = pending.splice(0);
      return out;
    },
  };
}
