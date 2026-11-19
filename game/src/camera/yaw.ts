/**
 * Yaw conventions.
 *
 * The canonical `PlayerTransform.yaw` (contracts/player.ts) is documented as 0 looking down -Z,
 * as in Three.js. The shared first-person controller, the QA'd camera math in `playerCamera.ts`
 * and the avatar models all use the controller convention: yaw 0 looks down +Z. The two differ
 * by half a turn. Rather than rewrite the QA'd camera, camera and avatar systems convert the
 * canonical yaw once, here, so the choice is explicit and testable. A host whose movement
 * system writes the controller's yaw straight into the transform passes `'controller'`.
 */

export type YawConvention = 'controller' | 'threejs';

/** The yaw in the controller convention (forward at 0 is +Z) for a transform yaw. */
export function toControllerYaw(yaw: number, convention: YawConvention): number {
  return convention === 'threejs' ? yaw + Math.PI : yaw;
}
