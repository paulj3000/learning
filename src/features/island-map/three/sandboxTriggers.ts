import type { Box3, Vector3 } from 'three';

/**
 * Pure "is the player near something" checks the sandbox scene calls once
 * per frame, kept separate from `firstPersonController.ts` so movement math
 * and proximity math are independently testable.
 */

export function isInsideZone(position: Vector3, zone: Box3): boolean {
  return zone.containsPoint(position);
}

/**
 * Edge-triggered proximity check: returns `true` only on the frame the
 * player crosses into range, given whether they were already in range last
 * frame. Callers emit `NpcApproached` exactly once per approach rather than
 * once per frame while standing nearby.
 */
export function hasApproached(
  position: Vector3,
  entityPosition: Vector3,
  thresholdMeters: number,
  wasInRangeLastFrame: boolean,
): boolean {
  const isInRangeNow = position.distanceTo(entityPosition) <= thresholdMeters;
  return isInRangeNow && !wasInRangeLastFrame;
}

/** Companion check for `hasApproached`, so callers can track the "last frame" flag. */
export function isInRange(position: Vector3, entityPosition: Vector3, thresholdMeters: number): boolean {
  return position.distanceTo(entityPosition) <= thresholdMeters;
}
