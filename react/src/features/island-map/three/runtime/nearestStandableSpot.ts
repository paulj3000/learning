/**
 * GE-D4 (GE-070): where to put the child when an extension asks for a spot they cannot stand on
 * (a safe checkpoint a new collider now covers). Searches rings around the requested spot, nearest
 * ring first, and returns the first clear point. Pure; `canStandAt` is the movement controller's
 * own footprint test, so the answer agrees with what walking allows.
 */

/** How far from the requested spot a fallback may be, metres. Beyond this the spot is wrong. */
export const TELEPORT_SEARCH_RADIUS = 2;
/** Distance between rings, metres: under the child's 0.37 m footprint radius, so no gap is skipped. */
export const TELEPORT_SEARCH_STEP = 0.25;
/** Points tried on each ring. */
const POINTS_PER_RING = 16;

export function nearestStandableSpot(
  x: number,
  z: number,
  canStandAt: (x: number, z: number) => boolean,
  radius = TELEPORT_SEARCH_RADIUS,
  step = TELEPORT_SEARCH_STEP,
): { x: number; z: number } | null {
  if (!Number.isFinite(x) || !Number.isFinite(z) || !(step > 0)) return null;
  for (let ring = step; ring <= radius + 1e-9; ring += step) {
    for (let index = 0; index < POINTS_PER_RING; index += 1) {
      const angle = (index / POINTS_PER_RING) * Math.PI * 2;
      const px = x + Math.sin(angle) * ring;
      const pz = z + Math.cos(angle) * ring;
      if (canStandAt(px, pz)) return { x: px, z: pz };
    }
  }
  return null;
}
