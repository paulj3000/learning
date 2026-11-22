/**
 * The camera rig: the engine's one camera system (GE-030).
 *
 * It reads the canonical `PlayerTransform` (contracts/player.ts), interpolated with
 * `interpolatePlayerPosition` and the frame alpha, and nothing else, so the camera follows the
 * collided position and the achieved velocity exactly as the avatar does. It never moves the
 * player and never reads a desired position (the wall-penetration fixes).
 *
 * It wraps the QA'd `PlayerCameraController` (third-person boom with wall pull-in, the tall-wall
 * boom lift, first-person eye height and landing dip) and adds:
 * - first-person and third-person (default) with the child's choice remembered through an
 *   injected storage port (no direct `localStorage`);
 * - boom collision through `PhysicsProviderService` (`PhysicsProvider.raycast`), skipping
 *   colliders with `cameraIgnores` (invisible world boundaries) and triggers, plus a last safety
 *   pass so the camera never ends inside a collider;
 * - reduced motion: no landing dip, no sprint zoom, gentler easing (the controller's rules),
 *   and no head bob (there is none).
 *
 * The math is pure over `Vector3`: it needs no renderer. `applyCameraFrame` copies a frame to
 * a `PerspectiveCamera` (or anything shaped like one).
 */

import { Vector3 } from 'three';
import { interpolatePlayerPosition, type PlayerTransform } from '../contracts/player';
import type { ColliderSpec, PhysicsProvider } from '../contracts/physics';
import {
  loadCameraPreference,
  saveCameraPreference,
  type PreferenceStorage,
} from './cameraPreference';
import {
  PlayerCameraController,
  type ObstructionProbe,
  type PlayerCameraFrame,
} from './playerCamera';
import {
  initialCameraMode,
  resolvePlayerCamera,
  type CameraMode,
  type PlayerCameraConfiguration,
} from './playerPresentation';
import { toControllerYaw, type YawConvention } from './yaw';

/** The first-person eye height above the feet, metres (the shared controller's). */
export const DEFAULT_EYE_HEIGHT = 1.6;
/** Half-size of the box used to keep the camera out of colliders, metres. */
export const DEFAULT_SAFETY_RADIUS = 0.12;

type PhysicsSource = PhysicsProvider | (() => PhysicsProvider | undefined) | undefined;

function resolvePhysics(source: PhysicsSource): PhysicsProvider | undefined {
  return typeof source === 'function' ? source() : source;
}

function insideSpec(spec: ColliderSpec, p: Readonly<{ x: number; y: number; z: number }>): boolean {
  return (
    p.x >= spec.min.x &&
    p.x <= spec.max.x &&
    p.y >= spec.min.y &&
    p.y <= spec.max.y &&
    p.z >= spec.min.z &&
    p.z <= spec.max.z
  );
}

/** Whether camera collision should consider this collider at all. */
function blocksCamera(spec: ColliderSpec): boolean {
  return spec.kind !== 'TRIGGER' && spec.cameraIgnores !== true;
}

/**
 * An obstruction probe over the physics provider: the nearest collider along the boom, skipping
 * triggers, `cameraIgnores` boundaries and any box the follow point is already inside (a
 * jumpable crate the child stands against must not pin the camera to their head).
 */
export function physicsObstruction(source: PhysicsSource): ObstructionProbe {
  return (origin, direction, maxDistance) => {
    const physics = resolvePhysics(source);
    if (!physics) {
      return null;
    }
    const hit = physics.raycast(
      origin,
      direction,
      maxDistance,
      (spec) => blocksCamera(spec) && !insideSpec(spec, origin),
    );
    return hit ? hit.distance : null;
  };
}

/**
 * Safety pass: moves `position` back toward `anchor` until a box of half-size `radius` around
 * it overlaps no camera-blocking collider (ignoring boxes the anchor itself is inside). The
 * boom raycast already stops short of a wall; this catches corners and thin colliders a single
 * ray slips past. Mutates and returns `position`.
 */
export function keepCameraOutOfColliders(
  physics: PhysicsProvider,
  anchor: Readonly<{ x: number; y: number; z: number }>,
  position: Vector3,
  radius = DEFAULT_SAFETY_RADIUS,
): Vector3 {
  const blocked = (p: Readonly<{ x: number; y: number; z: number }>): boolean => {
    const ids = physics.overlaps(
      { x: p.x - radius, y: p.y - radius, z: p.z - radius },
      { x: p.x + radius, y: p.y + radius, z: p.z + radius },
    );
    return ids.some((id) => {
      const spec = physics.getCollider(id);
      return spec !== undefined && blocksCamera(spec) && !insideSpec(spec, anchor);
    });
  };
  if (!blocked(position)) {
    return position;
  }
  const end = position.clone();
  const probe = new Vector3();
  let low = 0;
  let high = 1;
  for (let i = 0; i < 12; i += 1) {
    const mid = (low + high) / 2;
    probe.set(
      anchor.x + (end.x - anchor.x) * mid,
      anchor.y + (end.y - anchor.y) * mid,
      anchor.z + (end.z - anchor.z) * mid,
    );
    if (blocked(probe)) {
      high = mid;
    } else {
      low = mid;
    }
  }
  return position.set(
    anchor.x + (end.x - anchor.x) * low,
    anchor.y + (end.y - anchor.y) * low,
    anchor.z + (end.z - anchor.z) * low,
  );
}

export interface CameraPreferenceOptions {
  /** The child's profile id, the preference key (already in every play URL). */
  childId: string;
  /** The injected storage port. `null` means nothing is remembered. */
  storage: PreferenceStorage | null;
}

export interface CameraRigOptions {
  /** A partial override of `DEFAULT_PLAYER_CAMERA`; clamped by `resolvePlayerCamera`. */
  config?: Partial<PlayerCameraConfiguration> | null;
  eyeHeight?: number;
  reducedMotion?: boolean;
  /** The physics provider, or a getter for it (the service may arrive after the rig). */
  physics?: PhysicsSource;
  preference?: CameraPreferenceOptions;
  /** How `PlayerTransform.yaw` is read; see `yaw.ts`. Default `'controller'` (the contract: the shared controller's yaw). */
  yawConvention?: YawConvention;
  /** Half-size of the keep-out box, metres. */
  safetyRadius?: number;
}

export class CameraRig {
  readonly configuration: Readonly<PlayerCameraConfiguration>;
  private readonly options: CameraRigOptions;
  private readonly convention: YawConvention;
  private controller: PlayerCameraController;
  private readonly reducedMotion: boolean;
  private lastGrounded = true;
  private airborneFallSpeed = 0;

  constructor(options: CameraRigOptions = {}) {
    this.options = options;
    this.configuration = resolvePlayerCamera(options.config);
    this.convention = options.yawConvention ?? 'controller';
    this.reducedMotion = options.reducedMotion === true;
    const saved = options.preference
      ? loadCameraPreference(options.preference.childId, options.preference.storage)
      : null;
    this.controller = this.createController(initialCameraMode(this.configuration, saved));
  }

  private createController(mode: CameraMode): PlayerCameraController {
    return new PlayerCameraController(this.configuration as PlayerCameraConfiguration, mode, {
      eyeHeight: this.options.eyeHeight ?? DEFAULT_EYE_HEIGHT,
      reducedMotion: this.reducedMotion,
      obstruction: physicsObstruction(this.options.physics),
    });
  }

  get mode(): CameraMode {
    return this.controller.mode;
  }

  /**
   * Switches perspective where the location allows it, and remembers the choice. Returns
   * whether the mode is now `mode`.
   */
  setMode(mode: CameraMode): boolean {
    if (mode === this.controller.mode) {
      return true;
    }
    if (!this.configuration.allowModeSwitch) {
      return false;
    }
    this.controller.setMode(mode);
    if (this.options.preference) {
      saveCameraPreference(this.options.preference.childId, mode, this.options.preference.storage);
    }
    return true;
  }

  /** The V key, camera button or gamepad Y. Returns the mode afterwards. */
  toggleMode(): CameraMode {
    this.setMode(this.controller.mode === 'first-person' ? 'third-person' : 'first-person');
    return this.controller.mode;
  }

  /** The `PlayerLanded` event: a small dip, never under reduced motion. */
  landed(impactSpeed: number): void {
    this.controller.landed(impactSpeed);
  }

  /** Forget smoothing, after a teleport or a safe return. */
  reset(): void {
    this.controller.reset();
    this.lastGrounded = true;
    this.airborneFallSpeed = 0;
  }

  /**
   * Once per rendered frame, after movement. `alpha` is the interpolation fraction between the
   * last two simulation states (`FrameContext.alpha`).
   */
  update(frameSeconds: number, transform: PlayerTransform, alpha: number): PlayerCameraFrame {
    // A landing dip from the transform alone, so a host that forwards no events still gets it.
    if (!transform.grounded) {
      this.airborneFallSpeed = Math.max(0, -transform.velocity.y);
    } else if (!this.lastGrounded) {
      this.controller.landed(this.airborneFallSpeed);
      this.airborneFallSpeed = 0;
    }
    this.lastGrounded = transform.grounded;

    const feet = interpolatePlayerPosition(transform, alpha);
    const frame = this.controller.update(frameSeconds, {
      feet,
      grounded: transform.grounded,
      yaw: toControllerYaw(transform.yaw, this.convention),
      pitch: transform.pitch,
      sprinting: transform.state === 'SPRINT' || transform.gait === 'sprint',
    });

    const physics = resolvePhysics(this.options.physics);
    if (frame.mode === 'third-person' && physics && this.configuration.collisionEnabled) {
      keepCameraOutOfColliders(
        physics,
        frame.aimOrigin,
        frame.position,
        this.options.safetyRadius ?? DEFAULT_SAFETY_RADIUS,
      );
    }
    return frame;
  }
}

/** The part of `THREE.PerspectiveCamera` a frame is applied to. */
export interface CameraLike {
  position: { copy(v: Vector3): unknown };
  rotation: { order: string; set(x: number, y: number, z: number): unknown };
  fov?: number;
  updateProjectionMatrix?(): void;
}

/**
 * Copies a frame to a camera, as the existing runtime does: `rotation.y = yaw + PI` (the
 * controller yaw looks down +Z, a Three.js camera down -Z) and `rotation.x = pitch`.
 * `baseFov` plus the frame's sprint offset sets the field of view when a base is given.
 */
export function applyCameraFrame(
  frame: PlayerCameraFrame,
  camera: CameraLike,
  baseFov?: number,
): void {
  camera.rotation.order = 'YXZ';
  camera.position.copy(frame.position);
  camera.rotation.set(frame.pitch, frame.yaw + Math.PI, 0);
  if (baseFov !== undefined && camera.fov !== undefined) {
    const fov = baseFov + frame.fovOffset;
    if (Math.abs(camera.fov - fov) > 1e-3) {
      camera.fov = fov;
      camera.updateProjectionMatrix?.();
    }
  }
}
