import { Box3, Vector3 } from 'three';

/**
 * Movement/look state for the Phase 31 sandbox's first-person camera,
 * per `docs/ROADMAP.md` Phase 31 ("desktop keyboard/mouse (pointer-lock)
 * and tablet/touch movement and look controls, tuned for comfort
 * (acceleration/deceleration, controlled camera pitch limits, no forced
 * cinematic camera motion)").
 *
 * Deliberately holds only math (`THREE.Vector3`/`THREE.Box3`), never a
 * scene, camera, or renderer, so it needs no GPU context and stays unit
 * testable in jsdom. `sandboxScene.ts` reads `position`/`yaw`/`pitch` each
 * frame and applies them to the actual `PerspectiveCamera`.
 */

export interface MoveInput {
  /** -1 (back) to 1 (forward). */
  forward: number;
  /** -1 (left) to 1 (right). */
  strafe: number;
}

export interface FirstPersonControllerOptions {
  /** Units/second the controller accelerates toward the target speed. */
  acceleration?: number;
  /** Units/second the controller decelerates toward zero with no input. */
  deceleration?: number;
  /** Top move speed, units/second. */
  maxSpeed?: number;
  /** Radians. Clamps how far up/down the camera can look. */
  maxPitch?: number;
  colliders?: Box3[];
  startPosition?: Vector3;
}

const DEFAULT_MAX_PITCH = Math.PI / 2 - 0.05; // just short of straight up/down

export class FirstPersonController {
  readonly position: Vector3;
  yaw = 0;
  pitch = 0;

  private readonly velocity = new Vector3();
  private readonly acceleration: number;
  private readonly deceleration: number;
  private readonly maxSpeed: number;
  private readonly maxPitch: number;
  private readonly colliders: Box3[];

  constructor(options: FirstPersonControllerOptions = {}) {
    this.acceleration = options.acceleration ?? 20;
    this.deceleration = options.deceleration ?? 25;
    this.maxSpeed = options.maxSpeed ?? 4;
    this.maxPitch = options.maxPitch ?? DEFAULT_MAX_PITCH;
    this.colliders = options.colliders ?? [];
    this.position = options.startPosition?.clone() ?? new Vector3();
  }

  /** Applies a raw look delta (e.g. `movementX`/`movementY`), clamping pitch. */
  applyLookDelta(dx: number, dy: number, sensitivity = 0.0025): void {
    this.yaw -= dx * sensitivity;
    this.pitch -= dy * sensitivity;
    this.pitch = Math.max(-this.maxPitch, Math.min(this.maxPitch, this.pitch));
  }

  /** Advances position by `deltaSeconds`, easing velocity and resolving collisions. */
  update(deltaSeconds: number, moveInput: MoveInput): void {
    const hasInput = moveInput.forward !== 0 || moveInput.strafe !== 0;
    const forwardX = Math.sin(this.yaw);
    const forwardZ = Math.cos(this.yaw);
    const strafeX = Math.cos(this.yaw);
    const strafeZ = -Math.sin(this.yaw);

    const targetVelocity = new Vector3(
      forwardX * moveInput.forward + strafeX * moveInput.strafe,
      0,
      forwardZ * moveInput.forward - strafeZ * moveInput.strafe,
    );
    if (targetVelocity.lengthSq() > 1) {
      targetVelocity.normalize();
    }
    targetVelocity.multiplyScalar(this.maxSpeed);

    const rate = hasInput ? this.acceleration : this.deceleration;
    const t = Math.min(1, rate * deltaSeconds);
    this.velocity.lerp(targetVelocity, t);

    this.moveWithCollision(this.velocity.x * deltaSeconds, this.velocity.z * deltaSeconds);
  }

  /** Axis-separated collision resolution: a blocked axis stops, the other still slides. */
  private moveWithCollision(dx: number, dz: number): void {
    if (dx !== 0) {
      const next = this.position.clone();
      next.x += dx;
      if (!this.collidesAt(next)) {
        this.position.x = next.x;
      } else {
        this.velocity.x = 0;
      }
    }
    if (dz !== 0) {
      const next = this.position.clone();
      next.z += dz;
      if (!this.collidesAt(next)) {
        this.position.z = next.z;
      } else {
        this.velocity.z = 0;
      }
    }
  }

  private collidesAt(point: Vector3): boolean {
    return this.colliders.some((box) => box.containsPoint(point));
  }
}
