/** Small x/z geometry helpers shared by components (pure, no Three.js). */

import type { Vec3Like } from '../contracts/player';

export interface Rect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export function rectAround(x: number, z: number, halfX: number, halfZ = halfX): Rect {
  return { minX: x - halfX, maxX: x + halfX, minZ: z - halfZ, maxZ: z + halfZ };
}

export function rectContains(rect: Rect, x: number, z: number, margin = 0): boolean {
  return (
    x >= rect.minX - margin &&
    x <= rect.maxX + margin &&
    z >= rect.minZ - margin &&
    z <= rect.maxZ + margin
  );
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minZ <= b.maxZ && a.maxZ >= b.minZ;
}

export function inflateRect(rect: Rect, by: number): Rect {
  return { minX: rect.minX - by, maxX: rect.maxX + by, minZ: rect.minZ - by, maxZ: rect.maxZ + by };
}

/** Does the segment from (x, z) along (dx, dz) for `length` metres touch the rect? */
export function segmentHitsRect(
  x: number,
  z: number,
  dx: number,
  dz: number,
  length: number,
  rect: Rect,
): boolean {
  if (rectContains(rect, x, z)) {
    return true;
  }
  const norm = Math.hypot(dx, dz);
  if (norm < 1e-12) {
    return false;
  }
  const ux = dx / norm;
  const uz = dz / norm;
  let t0 = 0;
  let t1 = length;
  const slab = (origin: number, delta: number, low: number, high: number): boolean => {
    if (Math.abs(delta) < 1e-12) {
      return origin >= low && origin <= high;
    }
    let a = (low - origin) / delta;
    let b = (high - origin) / delta;
    if (a > b) {
      [a, b] = [b, a];
    }
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    return t0 <= t1;
  };
  return slab(x, ux, rect.minX, rect.maxX) && slab(z, uz, rect.minZ, rect.maxZ);
}

/** Does a box swept from its rest position along (dx, dz) for `length` metres touch the rect? */
export function sweptRectHitsRect(
  box: Rect,
  dx: number,
  dz: number,
  length: number,
  target: Rect,
): boolean {
  const halfX = (box.maxX - box.minX) / 2;
  const halfZ = (box.maxZ - box.minZ) / 2;
  const cx = (box.minX + box.maxX) / 2;
  const cz = (box.minZ + box.maxZ) / 2;
  return segmentHitsRect(cx, cz, dx, dz, length, {
    minX: target.minX - halfX,
    maxX: target.maxX + halfX,
    minZ: target.minZ - halfZ,
    maxZ: target.maxZ + halfZ,
  });
}

export function horizontalDistance(a: Vec3Like, bx: number, bz: number): number {
  return Math.hypot(a.x - bx, a.z - bz);
}
