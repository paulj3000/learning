import { Box3, Ray, Vector3 } from 'three';
import { CameraHeightFollower } from './cameraHeightFollower';
import type { CameraMode, PlayerCameraConfiguration } from './playerPresentation';

/**
 * The one player camera controller for every 3D location (LAI-JMP-01a), in
 * both perspectives. It decides where the camera is and where interactions
 * are aimed from; it never moves the player. The shared movement controller
 * (`FirstPersonController`) stays the only authority on position, and its
 * `yaw`/`pitch` stay the look direction in both modes, so walking is always
 * relative to where the camera faces.
 *
 * - **First-person:** the existing view, unchanged: the eye at 1.6 m above
 *   the feet, eased on steps and dipped on landing (`CameraHeightFollower`).
 * - **Third-person:** an orbit behind and above a follow point just over the
 *   avatar's head. The follow point eases after the player (vertically more
 *   gently, so a jump is not a lurch). The camera is pulled in front of any
 *   solid collider between it and the follow point **at once**, so it never
 *   shows through a wall, and eases back out when the way is clear. Ceilings
 *   (`maxHeight`) and the ground bound it too.
 *
 * Pure math over `Vector3`/`Box3`: no scene, renderer or DOM.
 */

/** Feet position and look direction of the player, read from the movement controller. */
export interface PlayerCameraInput {
  feet: { x: number; y: number; z: number };
  grounded: boolean;
  /** Radians; the controller's yaw (forward at 0 is +Z). */
  yaw: number;
  /** Radians; the controller's pitch (negative looks down). */
  pitch: number;
  /** Running & sprinting: the child is sprinting (widens the view a little, if configured). */
  sprinting?: boolean;
}

export interface PlayerCameraFrame {
  readonly mode: CameraMode;
  /** Where the camera is. */
  readonly position: Vector3;
  /** Camera rotation to apply (`rotation.order = 'YXZ'`). */
  readonly yaw: number;
  readonly pitch: number;
  /**
   * Where interactions are aimed from: the player's own eye in first-person,
   * the follow point over the avatar in third-person. Never the camera, so
   * reach is measured from the child, not from a camera metres behind them.
   * The screen-centre reticle lies on the line from here along the view.
   */
  readonly aimOrigin: Vector3;
  /** Whether to draw the avatar: never in first-person, or when the camera is right against it. */
  readonly avatarVisible: boolean;
  /** Third-person: the current camera distance from the follow point. */
  readonly distance: number;
  /** Degrees to add to the base field of view (the sprint widening, eased; 0 under reduced motion). */
  readonly fovOffset: number;
}

/** Finds how far along a ray the first obstruction is, or `null` for none within `maxDistance`. */
export type ObstructionProbe = (
  origin: Vector3,
  direction: Vector3,
  maxDistance: number,
) => number | null;

export interface PlayerCameraOptions {
  eyeHeight: number;
  reducedMotion?: boolean;
  /** Third-person collision; absent means nothing obstructs. */
  obstruction?: ObstructionProbe;
}

/** Third-person look limits, radians: not straight down, and never far below the follow point. */
export const THIRD_PERSON_MIN_PITCH = -1.1;
export const THIRD_PERSON_MAX_PITCH = 0.45;
/** The pitch a child gets on switching into third-person: a gentle look down over the shoulder. */
export const THIRD_PERSON_ENTRY_PITCH = -0.25;
/** How far in front of an obstruction the camera stops, metres (its near plane is 0.1 m). */
export const CAMERA_RADIUS = 0.3;
/** Closest the camera may get to the follow point when pulled in by a wall. */
export const NEAREST_CAMERA_DISTANCE = 0.35;
/** Below this camera distance the avatar is hidden, so the view never goes inside its head. */
export const AVATAR_HIDE_DISTANCE = 0.8;
/** Lowest the camera goes, metres above the ground. */
export const CAMERA_GROUND_CLEARANCE = 0.25;
/** Kept between the camera and a ceiling (`maxHeight`). */
const CEILING_MARGIN = 0.15;
/** Per second: how fast the camera eases back out once the way is clear. */
const RETURN_RATE = 4;
const REDUCED_MOTION_RETURN_RATE = 2;
/** The follow point eases vertically at this fraction of `followDamping` (jumps feel steady). */
const VERTICAL_FOLLOW_FRACTION = 0.5;
const REDUCED_MOTION_VERTICAL_FOLLOW_FRACTION = 0.3;
/** Per second: how fast the sprint field-of-view widening eases in and out. */
const FOV_EASE_RATE = 5;
/** A jump of the follow point bigger than this (a teleport) snaps rather than eases. */
const SNAP_DISTANCE = 3;

function ease(current: number, target: number, rate: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Clamps a pitch into the third-person range. */
export function thirdPersonPitch(pitch: number): number {
  return clamp(pitch, THIRD_PERSON_MIN_PITCH, THIRD_PERSON_MAX_PITCH);
}

/** The unit look direction for a yaw and pitch (forward at yaw 0 is +Z). */
export function lookDirection(yaw: number, pitch: number, into = new Vector3()): Vector3 {
  const cos = Math.cos(pitch);
  return into.set(Math.sin(yaw) * cos, Math.sin(pitch), Math.cos(yaw) * cos);
}

export class PlayerCameraController {
  private currentMode: CameraMode;
  private config: PlayerCameraConfiguration;
  private readonly eyeHeight: number;
  private readonly reducedMotion: boolean;
  private readonly obstruction?: ObstructionProbe;
  private readonly heightFollower: CameraHeightFollower;

  private readonly pivot = new Vector3();
  private pivotReady = false;
  private currentDistance: number;

  private fovOffset = 0;
  private readonly position = new Vector3();
  private readonly aim = new Vector3();
  private readonly direction = new Vector3();
  private readonly back = new Vector3();

  constructor(config: PlayerCameraConfiguration, mode: CameraMode, options: PlayerCameraOptions) {
    this.config = config;
    this.currentMode = mode;
    this.eyeHeight = options.eyeHeight;
    this.reducedMotion = options.reducedMotion === true;
    this.obstruction = options.obstruction;
    this.heightFollower = new CameraHeightFollower({ reducedMotion: this.reducedMotion });
    this.currentDistance = config.distance;
  }

  get mode(): CameraMode {
    return this.currentMode;
  }

  get configuration(): Readonly<PlayerCameraConfiguration> {
    return this.config;
  }

  /**
   * Switches perspective. The next frame starts fresh (no easing from the old
   * view), so a switch is one clean cut rather than a swoop.
   */
  setMode(mode: CameraMode): void {
    if (mode === this.currentMode) return;
    this.currentMode = mode;
    this.reset();
  }

  /** Forget smoothing, e.g. after a teleport or a safe return. */
  reset(): void {
    this.pivotReady = false;
    this.currentDistance = this.config.distance;
    this.heightFollower.reset();
  }

  /** Call once per landing: first-person's small landing dip. */
  landed(impactSpeed: number): void {
    this.heightFollower.landed(impactSpeed);
  }

  update(deltaSeconds: number, input: PlayerCameraInput): PlayerCameraFrame {
    const dt = Number.isFinite(deltaSeconds) && deltaSeconds > 0 ? deltaSeconds : 0;
    // The sprint widening eases over about half a second: never a zoom snap.
    const wanted = input.sprinting && !this.reducedMotion ? this.config.sprintFovBoost : 0;
    this.fovOffset = ease(this.fovOffset, wanted, FOV_EASE_RATE, dt);
    if (Math.abs(this.fovOffset - wanted) < 0.01) this.fovOffset = wanted;
    const frame =
      this.currentMode === 'first-person'
        ? this.firstPerson(dt, input)
        : this.thirdPerson(dt, input);
    return { ...frame, fovOffset: this.fovOffset };
  }

  private firstPerson(dt: number, input: PlayerCameraInput): Omit<PlayerCameraFrame, 'fovOffset'> {
    const eyeOffset = this.heightFollower.update(dt, input.feet.y, input.grounded);
    this.position.set(input.feet.x, this.eyeHeight + eyeOffset, input.feet.z);
    this.aim.copy(this.position);
    return {
      mode: 'first-person',
      position: this.position,
      yaw: input.yaw,
      pitch: input.pitch,
      aimOrigin: this.aim,
      avatarVisible: false,
      distance: 0,
    };
  }

  private thirdPerson(dt: number, input: PlayerCameraInput): Omit<PlayerCameraFrame, 'fovOffset'> {
    const config = this.config;
    const targetX = input.feet.x;
    const targetY = input.feet.y + config.heightOffset;
    const targetZ = input.feet.z;

    const far =
      !this.pivotReady ||
      Math.hypot(targetX - this.pivot.x, targetY - this.pivot.y, targetZ - this.pivot.z) >
        SNAP_DISTANCE;
    if (far) {
      this.pivot.set(targetX, targetY, targetZ);
      this.pivotReady = true;
    } else {
      const rate = config.followDamping;
      const vertical =
        rate *
        (this.reducedMotion ? REDUCED_MOTION_VERTICAL_FOLLOW_FRACTION : VERTICAL_FOLLOW_FRACTION);
      this.pivot.x = ease(this.pivot.x, targetX, rate, dt);
      this.pivot.z = ease(this.pivot.z, targetZ, rate, dt);
      this.pivot.y = ease(this.pivot.y, targetY, vertical, dt);
    }
    if (config.maxHeight !== undefined) {
      this.pivot.y = Math.min(this.pivot.y, config.maxHeight - CEILING_MARGIN);
    }

    const pitch = thirdPersonPitch(input.pitch);
    lookDirection(input.yaw, pitch, this.direction);
    this.back.copy(this.direction).negate();

    // How far back the camera may go this frame: its distance, less any wall or ceiling.
    let allowed = config.distance;
    // How far back the camera could go before touching something solid.
    let limit = Number.POSITIVE_INFINITY;
    if (config.collisionEnabled && this.obstruction) {
      const hit = this.obstruction(this.pivot, this.back, config.distance + CAMERA_RADIUS);
      if (hit !== null) {
        limit = hit;
        allowed = Math.min(allowed, hit - CAMERA_RADIUS);
      }
    }
    if (config.maxHeight !== undefined && this.back.y > 1e-6) {
      const ceiling = (config.maxHeight - CEILING_MARGIN - this.pivot.y) / this.back.y;
      limit = Math.min(limit, ceiling + CEILING_MARGIN);
      allowed = Math.min(allowed, ceiling);
    }
    // Keep a little room from the follow point, but never at the price of going
    // into the wall: a child flush against a wall gets a camera at their
    // shoulder (and the avatar hidden), not one inside the stone.
    allowed = Math.max(Math.min(NEAREST_CAMERA_DISTANCE, limit * 0.5), allowed);

    if (far || allowed < this.currentDistance) {
      // In front of a wall at once: never a frame looking through it.
      this.currentDistance = allowed;
    } else {
      const rate = this.reducedMotion ? REDUCED_MOTION_RETURN_RATE : RETURN_RATE;
      this.currentDistance = ease(this.currentDistance, allowed, rate, dt);
    }

    this.position.copy(this.pivot).addScaledVector(this.back, this.currentDistance);
    this.position.y = Math.max(
      this.position.y,
      input.feet.y + CAMERA_GROUND_CLEARANCE,
      CAMERA_GROUND_CLEARANCE,
    );
    if (config.maxHeight !== undefined) {
      this.position.y = Math.min(this.position.y, config.maxHeight - CEILING_MARGIN);
    }

    // Aim from the player's real follow point (not the eased one), so reach is the child's.
    this.aim.set(targetX, targetY, targetZ);
    return {
      mode: 'third-person',
      position: this.position,
      yaw: input.yaw,
      pitch,
      aimOrigin: this.aim,
      avatarVisible: this.currentDistance > AVATAR_HIDE_DISTANCE,
      distance: this.currentDistance,
    };
  }
}

const probeRay = new Ray();
const probeHit = new Vector3();

/**
 * An obstruction probe over the location's live solid colliders (the same
 * `Box3` list the movement controller blocks on). A box the follow point is
 * already inside is ignored, so a jumpable crate the child stands in front of
 * does not pin the camera to their head.
 */
export function colliderObstruction(colliders: readonly Box3[]): ObstructionProbe {
  return (origin, direction, maxDistance) => {
    probeRay.origin.copy(origin);
    probeRay.direction.copy(direction);
    let nearest: number | null = null;
    for (const box of colliders) {
      if (box.containsPoint(origin)) continue;
      if (!probeRay.intersectBox(box, probeHit)) continue;
      const distance = probeHit.distanceTo(origin);
      if (distance <= maxDistance && (nearest === null || distance < nearest)) nearest = distance;
    }
    return nearest;
  };
}
