import type { ThreeLocationManifest } from '../locationManifest';
import { ROOMS } from '../../storykeeperCastleRegion';

/**
 * Walkability for the castle **as the manifest actually builds it**: the
 * region module's own flood fill (`storykeeperCastleRegion.test.ts`) sees
 * only derived walls, so it cannot notice a dais, a pedestal or a new room's
 * furniture that the manifest adds as a collider. This one reads the
 * manifest's colliders, so a visual or layout pass that walls something in
 * fails a test instead of a child.
 *
 * Test support only: a 0.25 m grid, half the wall thickness, so no wall is
 * stepped over and no archway is missed between samples.
 */
export const REACHABILITY_STEP = 0.25;

interface Cell {
  x: number;
  z: number;
}

const keyOf = (cell: Cell) =>
  `${Math.round(cell.x / REACHABILITY_STEP)}:${Math.round(cell.z / REACHABILITY_STEP)}`;
const snap = (value: number) => Math.round(value / REACHABILITY_STEP) * REACHABILITY_STEP;

/** Whether a child could stand here: on some room's floor and outside every collider. */
export function isManifestWalkable(manifest: ThreeLocationManifest, x: number, z: number): boolean {
  const onFloor = ROOMS.some(
    (room) =>
      x >= room.floor.minX && x <= room.floor.maxX && z >= room.floor.minZ && z <= room.floor.maxZ,
  );
  if (!onFloor) return false;
  return !manifest.colliders.some(
    (collider) =>
      // A collider that only holds under a requirement is checked at its strictest: present.
      x >= collider.rect.minX &&
      x <= collider.rect.maxX &&
      z >= collider.rect.minZ &&
      z <= collider.rect.maxZ,
  );
}

/** Every grid cell reachable on foot from `start`, as keys for `isReached`. */
export function reachableCells(manifest: ThreeLocationManifest, start: Cell): Set<string> {
  const origin = { x: snap(start.x), z: snap(start.z) };
  if (!isManifestWalkable(manifest, origin.x, origin.z)) return new Set();
  const seen = new Set<string>([keyOf(origin)]);
  const queue: Cell[] = [origin];
  while (queue.length > 0) {
    const cell = queue.pop() as Cell;
    for (const [dx, dz] of [
      [REACHABILITY_STEP, 0],
      [-REACHABILITY_STEP, 0],
      [0, REACHABILITY_STEP],
      [0, -REACHABILITY_STEP],
    ] as const) {
      const next = { x: cell.x + dx, z: cell.z + dz };
      const key = keyOf(next);
      if (seen.has(key) || !isManifestWalkable(manifest, next.x, next.z)) continue;
      seen.add(key);
      queue.push(next);
    }
  }
  return seen;
}

export function isReached(reached: Set<string>, x: number, z: number): boolean {
  return reached.has(keyOf({ x, z }));
}

/** Whether any reachable cell lies within `radius` metres of the point (a prop is solid; its front is what matters). */
export function hasReachableCellNear(
  reached: Set<string>,
  x: number,
  z: number,
  radius: number,
): boolean {
  const steps = Math.ceil(radius / REACHABILITY_STEP);
  for (let dx = -steps; dx <= steps; dx += 1) {
    for (let dz = -steps; dz <= steps; dz += 1) {
      const px = x + dx * REACHABILITY_STEP;
      const pz = z + dz * REACHABILITY_STEP;
      if (Math.hypot(px - x, pz - z) <= radius && isReached(reached, px, pz)) return true;
    }
  }
  return false;
}

/** Whether any reachable cell lies inside the rectangle (a trigger zone the child must be able to enter). */
export function zoneIsEnterable(
  reached: Set<string>,
  zone: { minX: number; maxX: number; minZ: number; maxZ: number },
): boolean {
  for (let x = snap(zone.minX); x <= zone.maxX; x += REACHABILITY_STEP) {
    for (let z = snap(zone.minZ); z <= zone.maxZ; z += REACHABILITY_STEP) {
      if (x >= zone.minX && z >= zone.minZ && isReached(reached, x, z)) return true;
    }
  }
  return false;
}
