/**
 * Yaw conventions.
 *
 * The canonical `PlayerTransform.yaw` (contracts/player.ts) uses the shared controller's
 * convention: yaw 0 looks down +Z, the convention of the QA'd camera math in `playerCamera.ts`,
 * the avatar models and the movement system, which writes the controller's yaw unchanged. So
 * `'controller'` is the default everywhere. `'threejs'` (0 looks down -Z, half a turn apart)
 * remains for a host that feeds a Three.js object rotation instead.
 */

export type YawConvention = 'controller' | 'threejs';

/** The yaw in the controller convention (forward at 0 is +Z) for a transform yaw. */
export function toControllerYaw(yaw: number, convention: YawConvention): number {
  return convention === 'threejs' ? yaw + Math.PI : yaw;
}
