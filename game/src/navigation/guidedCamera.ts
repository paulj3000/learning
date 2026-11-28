/**
 * The assisted third-person camera for the guided profile (LAI-2104S step B1): no free look;
 * the view turns behind the child as they walk. Pure yaw maths, applied to the controller's
 * yaw (the same yaw the shared `PlayerCameraController` orbits).
 *
 * Reduced motion: no sweeping turn. The view holds still while the child walks and only cuts,
 * in one frame, to behind the child when they are heading well away from it.
 */

/** Fastest the view turns, radians per second (about 95 degrees). */
export const GUIDED_CAMERA_MAX_TURN_RATE = 1.65;
/** How quickly the view closes on the heading (1 / seconds). */
export const GUIDED_CAMERA_FOLLOW = 3;
/** Reduced motion: only cut when the heading is further than this off the view, radians (about 60 degrees). */
export const GUIDED_CAMERA_CUT_ANGLE = 1.05;

/** The shortest signed turn from `from` to `to`, radians in (-PI, PI]. */
export function shortestAngle(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

export interface AssistedYawOptions {
  reducedMotion?: boolean;
}

/**
 * The yaw for the next frame, turning from `yaw` toward `heading` (where the child is going).
 * `heading` null (standing still, or steering by hand with the joystick) leaves the yaw alone.
 */
export function assistedYaw(
  yaw: number,
  heading: number | null,
  deltaSeconds: number,
  options: AssistedYawOptions = {},
): number {
  if (heading === null || !(deltaSeconds > 0) || !Number.isFinite(heading)) return yaw;
  const diff = shortestAngle(yaw, heading);
  if (options.reducedMotion) {
    return Math.abs(diff) > GUIDED_CAMERA_CUT_ANGLE ? yaw + diff : yaw;
  }
  const wanted = diff * (1 - Math.exp(-GUIDED_CAMERA_FOLLOW * deltaSeconds));
  const limit = GUIDED_CAMERA_MAX_TURN_RATE * deltaSeconds;
  return yaw + Math.max(-limit, Math.min(limit, wanted));
}
