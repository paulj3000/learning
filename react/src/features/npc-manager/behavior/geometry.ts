/**
 * Ground-plane geometry for NPC behaviours (LAI-NPC-021, -024). Pure functions, no Three.js.
 *
 * Yaw follows `firstPersonController.ts` and `sceneLayout.yawTowards`: forward is
 * `(sin(yaw), cos(yaw))`, so the yaw that looks from `a` to `b` is `atan2(b.x - a.x, b.z - a.z)`.
 */

export interface MutablePoint {
  x: number;
  z: number;
}

const TWO_PI = Math.PI * 2;

/** The same angle in (-PI, PI]. */
export function normalizeAngle(angle: number): number {
  let a = angle % TWO_PI;
  if (a <= -Math.PI) a += TWO_PI;
  else if (a > Math.PI) a -= TWO_PI;
  return a;
}

/** Signed shortest turn from `from` to `to`, in (-PI, PI]. */
export function angleDelta(from: number, to: number): number {
  return normalizeAngle(to - from);
}

/** `yaw` turned toward `target` by at most `maxStep` radians (never overshoots). */
export function turnToward(yaw: number, target: number, maxStep: number): number {
  const delta = angleDelta(yaw, target);
  if (Math.abs(delta) <= maxStep) return normalizeAngle(target);
  return normalizeAngle(yaw + Math.sign(delta) * maxStep);
}

export function yawTowards(fromX: number, fromZ: number, toX: number, toZ: number): number {
  return Math.atan2(toX - fromX, toZ - fromZ);
}

export function distance(ax: number, az: number, bx: number, bz: number): number {
  return Math.hypot(bx - ax, bz - az);
}

/** Moves `point` (in place) onto the circle of `radius` around the centre when it lies outside. */
export function clampToCircle(
  point: MutablePoint,
  centerX: number,
  centerZ: number,
  radius: number,
): MutablePoint {
  const dx = point.x - centerX;
  const dz = point.z - centerZ;
  const d = Math.hypot(dx, dz);
  if (d > radius && d > 0) {
    const k = radius / d;
    point.x = centerX + dx * k;
    point.z = centerZ + dz * k;
  }
  return point;
}
