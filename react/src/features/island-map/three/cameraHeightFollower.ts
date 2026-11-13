/**
 * How high the player camera sits, frame by frame, while the feet move up and
 * down (LAI-JMP-01). Pure math; the runtime adds the result to the eye height.
 *
 * Comfort rules:
 * - In the air the camera rides the jump exactly. The arc is already smooth,
 *   and lagging it would make the view swim.
 * - On the ground a sudden change of floor height (stepping onto a crate,
 *   off a ledge, or a safe-return) is eased in, so the view never jumps.
 * - Landing gives a tiny dip, scaled by how hard the child landed, that
 *   springs back. With reduced motion there is no dip at all and steps ease in
 *   more gently.
 */
export interface CameraHeightFollowerOptions {
  /** `prefers-reduced-motion`. */
  reducedMotion?: boolean;
}

/** Per second: how fast the camera catches up with a floor-height change. */
export const STEP_FOLLOW_RATE = 14;
export const REDUCED_MOTION_STEP_FOLLOW_RATE = 8;
/** Deepest landing dip, metres. Small on purpose: a nod, not a jolt. */
export const MAX_LANDING_DIP = 0.07;
/** Metres of dip per m/s of landing speed. */
const DIP_PER_IMPACT_SPEED = 0.008;
/** Per second: how fast the dip recovers. */
const DIP_RECOVERY_RATE = 9;
/** A floor change bigger than this snaps rather than eases (a teleport across the map). */
const SNAP_DISTANCE = 3;

export class CameraHeightFollower {
  private readonly reducedMotion: boolean;
  private height: number | null = null;
  private dip = 0;

  constructor(options: CameraHeightFollowerOptions = {}) {
    this.reducedMotion = options.reducedMotion === true;
  }

  /** Call once on each landing with its downward speed (m/s). */
  landed(impactSpeed: number): void {
    if (this.reducedMotion || !Number.isFinite(impactSpeed) || impactSpeed <= 0) return;
    this.dip = Math.min(MAX_LANDING_DIP, Math.max(this.dip, impactSpeed * DIP_PER_IMPACT_SPEED));
  }

  /**
   * The camera's height offset for this frame: where the feet are, eased on
   * the ground, less any landing dip.
   */
  update(deltaSeconds: number, feetY: number, grounded: boolean): number {
    const dt = Number.isFinite(deltaSeconds) && deltaSeconds > 0 ? deltaSeconds : 0;
    if (this.height === null || !grounded || Math.abs(feetY - this.height) > SNAP_DISTANCE) {
      this.height = feetY;
    } else {
      const rate = this.reducedMotion ? REDUCED_MOTION_STEP_FOLLOW_RATE : STEP_FOLLOW_RATE;
      this.height += (feetY - this.height) * (1 - Math.exp(-rate * dt));
    }
    this.dip *= Math.exp(-DIP_RECOVERY_RATE * dt);
    if (this.dip < 1e-4) this.dip = 0;
    return this.height - this.dip;
  }

  /** Drop any easing (after a teleport the view should already be there). */
  reset(feetY: number): void {
    this.height = feetY;
    this.dip = 0;
  }
}
