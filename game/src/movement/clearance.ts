/**
 * Walk-under clearance for Solid colliders (GE-L16, owner-approved 2026-11-22).
 *
 * A Solid box is classified by the gap between the ground under it and its underside:
 * - `BELOW_GROUND`: its top is under the ground. It is ignored, as before.
 * - `COLUMN`: the gap is smaller than the avatar needs (every ground-level box, and a low raised
 *   one). It blocks the footprint at every height, so no jump ever carries the child over it.
 * - `OVERHEAD`: the gap is at least the avatar's collision height plus a safety margin (a lintel,
 *   an arch top, an upper wall). It blocks the body from its underside up and leaves the space
 *   under it open. It is never a standing surface: nobody can get above it.
 *
 * Elevation never makes a box jumpable; only its behaviour does (`jumpableColliders`).
 * Pure: no Three.js objects are created, nothing is mutated.
 */

export type SolidClearanceClass = 'BELOW_GROUND' | 'COLUMN' | 'OVERHEAD';

/** Extra headroom above the avatar's collision height before a gap counts as a passage. */
export const DEFAULT_CLEARANCE_MARGIN = 0;

/** Slack for floating-point box edges, metres. */
const CLEARANCE_EPSILON = 1e-6;

interface BoxLike {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
}

/** The gap a walk-under passage needs: the avatar's collision height plus the margin, metres. */
export function requiredClearance(
  bodyHeight: number,
  margin: number = DEFAULT_CLEARANCE_MARGIN,
): number {
  return bodyHeight + Math.max(0, margin);
}

/**
 * The highest ground under the box's footprint: its centre and four corners, so a box over a
 * slope is measured from the uphill side. `null` when there is no ground under any of them (the
 * box hangs over a hole).
 */
export function groundUnderBox(
  box: BoxLike,
  groundHeightAt: (x: number, z: number) => number | null,
): number | null {
  const cx = (box.min.x + box.max.x) / 2;
  const cz = (box.min.z + box.max.z) / 2;
  const samples: [number, number][] = [
    [cx, cz],
    [box.min.x, box.min.z],
    [box.min.x, box.max.z],
    [box.max.x, box.min.z],
    [box.max.x, box.max.z],
  ];
  let highest: number | null = null;
  for (const [x, z] of samples) {
    const height = groundHeightAt(x, z);
    if (height !== null && Number.isFinite(height) && (highest === null || height > highest)) {
      highest = height;
    }
  }
  return highest;
}

/**
 * How a Solid box blocks, given the ground under it and the clearance a passage needs.
 * A box over a hole (`ground` null) has no floor to walk under it on, so it is a column.
 */
export function classifySolidBox(
  box: BoxLike,
  ground: number | null,
  clearance: number,
): SolidClearanceClass {
  if (ground === null) return 'COLUMN';
  if (box.max.y < ground - CLEARANCE_EPSILON) return 'BELOW_GROUND';
  const gap = box.min.y - ground;
  return gap >= clearance - CLEARANCE_EPSILON ? 'OVERHEAD' : 'COLUMN';
}
