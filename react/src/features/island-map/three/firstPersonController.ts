import { Box3, Vector3 } from 'three';
import {
  resolveLocomotion,
  targetSpeed,
  type LocomotionConfiguration,
} from './locomotionConfiguration';
import {
  jumpLaunchSpeed,
  resolveJumpConfiguration,
  type JumpConfiguration,
} from './jumpConfiguration';

/**
 * Movement/look state for the player in every free-roaming 3D location: the
 * one shared movement controller (`docs/ROADMAP.md` Phase 31, "tuned for
 * comfort (acceleration/deceleration, controlled camera pitch limits, no
 * forced cinematic camera motion)"), extended by LAI-JMP-01 with jumping,
 * gravity, falling and landing.
 *
 * Deliberately holds only math (`THREE.Vector3`/`THREE.Box3`), never a
 * scene, camera, or renderer, so it needs no GPU context and stays unit
 * testable in jsdom. The runtime reads `position`/`yaw`/`pitch` each frame
 * and applies them to the actual `PerspectiveCamera`; `position.y` is the
 * height of the child's feet (0 on the ground).
 *
 * Collision rules (LAI-JMP-01, "safe by architecture"):
 * - A **solid** collider (the default) blocks at every height. It is tested
 *   at ground level exactly as before jumping existed, so walking is
 *   unchanged, and no jump ever carries the child over a wall, a locked gate,
 *   a quest barrier or the edge of the world.
 * - A **jumpable** collider (`ColliderSpec.jumpable`, a rock, crate, log or
 *   step) blocks only where it really is in height. The child can hop onto it,
 *   walk along its top, step down off it, or bump their head on its underside.
 *   Steps no taller than `stepHeight` are walked up without jumping.
 *
 * Jump input is an edge: `pressJump()` latches one press, so holding the
 * button or key never repeats a jump. Forgiving windows: a press up to
 * `jumpBufferMs` before landing still jumps on landing, and a press up to
 * `coyoteTimeMs` after walking off an edge still jumps. No double jump unless
 * the location allows it.
 */

export interface MoveInput {
  /** -1 (back) to 1 (forward). */
  forward: number;
  /** -1 (left) to 1 (right). */
  strafe: number;
  /**
   * The input is analog (a joystick drag or a stick), so a strong push runs
   * rather than walks. Keyboard input is not: full keys walk, as always.
   */
  analog?: boolean;
  /** Sprint is held or toggled on (Shift, L3, a drag past the joystick edge). */
  sprint?: boolean;
}

/** How the player is moving over the ground, for animation, sound and the HUD. */
export type Gait = 'idle' | 'walk' | 'run' | 'sprint';

/**
 * What the player's body is doing, for animation and sound. `JUMP_START` is
 * the first moment of a jump, `AIRBORNE` the rest of the rise, `FALLING` the
 * way down (from a jump or off an edge), `LANDING` the moment after touching
 * down.
 */
export type MovementState =
  'IDLE' | 'WALK' | 'RUN' | 'SPRINT' | 'JUMP_START' | 'AIRBORNE' | 'FALLING' | 'LANDING';

/** One-off things the controller did this frame, drained by `consumeEvents`. */
export type MovementEvent =
  | {
      type: 'JUMPED';
      /** Jumped within coyote time, after walking off an edge. */
      fromCoyote: boolean;
      /** Jumped on landing, from a press remembered by the jump buffer. */
      buffered: boolean;
      /** A second jump in the air (only where `allowDoubleJump`). */
      airJump: boolean;
    }
  | {
      type: 'LANDED';
      /** Downward speed at touch-down, m/s. */
      impactSpeed: number;
    }
  | {
      type: 'RECOVERED';
      /** Why the child was put back. */
      reason: 'FELL_OUT_OF_WORLD' | 'LEFT_PLAYABLE_AREA' | 'INVALID_POSITION';
    };

export interface FirstPersonControllerOptions {
  /** Units/second the controller accelerates toward the target speed. */
  acceleration?: number;
  /** Units/second the controller decelerates toward zero with no input. */
  deceleration?: number;
  /** Top walking speed, units/second. Same as `locomotion.walkSpeed`; this wins when both are set. */
  maxSpeed?: number;
  /** Walking, running and sprinting tuning. Missing fields take the defaults. */
  locomotion?: Partial<LocomotionConfiguration>;
  /** Radians. Clamps how far up/down the camera can look. */
  maxPitch?: number;
  /** Every collider, solid and jumpable. The array is read live, so it may change. */
  colliders?: Box3[];
  /** The colliders in `colliders` the child may jump onto or over. Read live. */
  jumpableColliders?: ReadonlySet<Box3>;
  startPosition?: Vector3;
  /** Jump tuning. Missing fields take the defaults (`jumpConfiguration.ts`). */
  jump?: Partial<JumpConfiguration>;
  /** Tallest ledge walked up without jumping, metres. */
  stepHeight?: number;
  /** Feet to top of head, metres, for head bumps on jumpable colliders. */
  bodyHeight?: number;
  /**
   * The ground's height under a point, or `null` where there is no ground (a
   * hole the child would fall into). Defaults to flat ground at 0 everywhere,
   * which is every location today.
   */
  groundHeightAt?: (x: number, z: number) => number | null;
  /** Feet below this height count as fallen out of the world and are put back. */
  recoveryDepth?: number;
  /** Where the child may be at all. Outside it they are put back. Defaults to anywhere. */
  isInPlayableArea?: (x: number, z: number) => boolean;
}

const DEFAULT_MAX_PITCH = Math.PI / 2 - 0.05; // just short of straight up/down
/** Physics substep, seconds: the jump arc comes out the same at 30 or 144 frames per second. */
export const PHYSICS_STEP_SECONDS = 1 / 120;
export const DEFAULT_STEP_HEIGHT = 0.25;
export const DEFAULT_BODY_HEIGHT = 1.7;
export const DEFAULT_RECOVERY_DEPTH = -10;
/** How long `JUMP_START` and `LANDING` last, seconds. */
const JUMP_START_SECONDS = 0.15;
const LANDING_SECONDS = 0.15;
/** Horizontal speed, m/s, under which a grounded child counts as standing still. */
const WALK_SPEED_THRESHOLD = 0.2;
/** How far above a gait's top speed counts as the next gait, m/s (keeps states from flickering). */
const GAIT_MARGIN = 0.25;
/**
 * Longest horizontal step tested for collision at once, metres. A long frame
 * at sprinting speed is cut into steps this short, so no wall thicker than
 * this can be skipped (every authored collider is thicker; a test checks).
 */
export const MAX_COLLISION_STEP = 0.1;
/** In the air with no input, the fraction of ground deceleration (times `airControl`) that applies. */
const AIR_DRAG_FACTOR = 0.2;
/** Tolerance for floating-point contact, metres. */
const CONTACT_EPSILON = 1e-4;

export class FirstPersonController {
  readonly position: Vector3;
  yaw = 0;
  pitch = 0;

  private readonly velocity = new Vector3();
  private readonly locomotion: LocomotionConfiguration;
  private readonly maxPitch: number;
  private readonly colliders: Box3[];
  private readonly jumpable: ReadonlySet<Box3>;
  private readonly stepHeight: number;
  private readonly bodyHeight: number;
  private readonly groundHeightAt: (x: number, z: number) => number | null;
  private readonly recoveryDepth: number;
  private readonly isInPlayableArea: (x: number, z: number) => boolean;
  private jumpConfig: JumpConfiguration;

  private verticalSpeed = 0;
  private onGround = true;
  private coyoteRemaining = 0;
  private bufferRemaining = 0;
  private pressPending = false;
  private airJumpsUsed = 0;
  private jumpStartRemaining = 0;
  private landingRemaining = 0;
  private readonly lastSafe = new Vector3();
  private events: MovementEvent[] = [];

  constructor(options: FirstPersonControllerOptions = {}) {
    this.locomotion = resolveLocomotion({
      ...options.locomotion,
      ...(options.acceleration !== undefined ? { acceleration: options.acceleration } : {}),
      ...(options.deceleration !== undefined ? { deceleration: options.deceleration } : {}),
      ...(options.maxSpeed !== undefined ? { walkSpeed: options.maxSpeed } : {}),
    });
    this.maxPitch = options.maxPitch ?? DEFAULT_MAX_PITCH;
    this.colliders = options.colliders ?? [];
    this.jumpable = options.jumpableColliders ?? new Set();
    this.stepHeight = options.stepHeight ?? DEFAULT_STEP_HEIGHT;
    this.bodyHeight = options.bodyHeight ?? DEFAULT_BODY_HEIGHT;
    this.groundHeightAt = options.groundHeightAt ?? (() => 0);
    this.recoveryDepth = options.recoveryDepth ?? DEFAULT_RECOVERY_DEPTH;
    this.isInPlayableArea = options.isInPlayableArea ?? (() => true);
    this.jumpConfig = resolveJumpConfiguration(options.jump);
    this.position = options.startPosition?.clone() ?? new Vector3();
    this.lastSafe.copy(this.position);
  }

  /** The jump tuning in force. */
  get jump(): Readonly<JumpConfiguration> {
    return this.jumpConfig;
  }

  /** Whether the child can jump here at all. */
  get jumpEnabled(): boolean {
    return this.jumpConfig.enabled;
  }

  /** Replaces the jump tuning (missing fields take the defaults). Turning jumping off drops a pending press. */
  configureJump(jump: Partial<JumpConfiguration> | undefined): void {
    this.jumpConfig = resolveJumpConfiguration(jump);
    if (!this.jumpConfig.enabled) this.clearJumpInput();
  }

  /** On the ground (or a jumpable collider's top) rather than in the air. */
  get grounded(): boolean {
    return this.onGround;
  }

  /** Upward speed, m/s; negative while falling. */
  get verticalVelocity(): number {
    return this.verticalSpeed;
  }

  /** Top walking speed, m/s (full keyboard input). */
  get walkSpeed(): number {
    return this.locomotion.walkSpeed;
  }

  /** Top running speed, m/s (full analog input). */
  get runSpeed(): number {
    return this.locomotion.runSpeed;
  }

  /** Sprinting speed, m/s. */
  get sprintSpeed(): number {
    return this.locomotion.sprintSpeed;
  }

  /** The walking, running and sprinting tuning in force. */
  get speeds(): Readonly<LocomotionConfiguration> {
    return this.locomotion;
  }

  /** How the child is moving over the ground right now, from their real speed. */
  get gait(): Gait {
    const speed = this.horizontalSpeed;
    if (speed <= WALK_SPEED_THRESHOLD) return 'idle';
    if (speed > this.locomotion.runSpeed + GAIT_MARGIN) return 'sprint';
    if (speed > this.locomotion.walkSpeed + GAIT_MARGIN) return 'run';
    return 'walk';
  }

  /** Horizontal speed, m/s. */
  get horizontalSpeed(): number {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  /**
   * Horizontal velocity, m/s, as a copy (LAI-JMP-01a: the avatar faces where
   * the child is going). Reading it never changes the movement.
   */
  get horizontalVelocity(): { x: number; z: number } {
    return { x: this.velocity.x, z: this.velocity.z };
  }

  get movementState(): MovementState {
    if (this.onGround) {
      if (this.landingRemaining > 0) return 'LANDING';
      switch (this.gait) {
        case 'idle':
          return 'IDLE';
        case 'walk':
          return 'WALK';
        case 'run':
          return 'RUN';
        case 'sprint':
          return 'SPRINT';
      }
    }
    if (this.verticalSpeed > 0) {
      return this.jumpStartRemaining > 0 ? 'JUMP_START' : 'AIRBORNE';
    }
    return 'FALLING';
  }

  /**
   * One jump press (key down, button down, tap). Edge-triggered: the input
   * layer calls it once per press, so holding never repeats. Ignored where
   * jumping is off.
   */
  pressJump(): void {
    if (!this.jumpConfig.enabled) return;
    this.pressPending = true;
  }

  /** Forgets any pressed or buffered jump (focus lost, a panel opened, a pause). */
  clearJumpInput(): void {
    this.pressPending = false;
    this.bufferRemaining = 0;
  }

  /** What happened since the last call (jumps, landings, recoveries), oldest first. */
  consumeEvents(): MovementEvent[] {
    const drained = this.events;
    this.events = [];
    return drained;
  }

  /**
   * Puts the player somewhere at once and stops them (a safe-return respawn, Firepeak FP-D10).
   * Not a movement: colliders are not consulted, so callers pass an authored, walkable point.
   */
  teleport(x: number, z: number, yaw: number): void {
    this.position.set(x, this.groundHeightAt(x, z) ?? 0, z);
    this.yaw = yaw;
    this.stopEverything();
  }

  /** Applies a raw look delta (e.g. `movementX`/`movementY`), clamping pitch. */
  applyLookDelta(dx: number, dy: number, sensitivity = 0.0025): void {
    this.yaw -= dx * sensitivity;
    this.pitch -= dy * sensitivity;
    this.pitch = Math.max(-this.maxPitch, Math.min(this.maxPitch, this.pitch));
  }

  /** Advances position by `deltaSeconds`: walking, jumping, gravity, landing, collisions, recovery. */
  update(deltaSeconds: number, moveInput: MoveInput): void {
    const dt = Number.isFinite(deltaSeconds) && deltaSeconds > 0 ? deltaSeconds : 0;
    const hasInput = moveInput.forward !== 0 || moveInput.strafe !== 0;
    const forwardX = Math.sin(this.yaw);
    const forwardZ = Math.cos(this.yaw);
    // The child's right: forward turned a quarter clockwise seen from above. The camera
    // looks along forward (`rotation.y = yaw + PI`), so this is screen-right; at yaw 0 the
    // child faces +Z and right is -X. (It was +X, which walked left on ArrowRight.)
    const rightX = -Math.cos(this.yaw);
    const rightZ = Math.sin(this.yaw);

    const targetVelocity = new Vector3(
      forwardX * moveInput.forward + rightX * moveInput.strafe,
      0,
      forwardZ * moveInput.forward + rightZ * moveInput.strafe,
    );
    // Direction from the input; speed from its strength and the gait.
    const magnitude = Math.min(1, targetVelocity.length());
    if (magnitude > 0) targetVelocity.normalize();
    targetVelocity.multiplyScalar(
      targetSpeed(this.locomotion, magnitude, {
        analog: moveInput.analog,
        sprint: moveInput.sprint,
      }),
    );

    // In the air the child still steers, at `airControl` of the ground rate,
    // so a jump can be guided onto a rock; letting go of the stick only
    // drags gently, so a jump keeps its take-off momentum (a running jump
    // carries further than a standing one).
    const speedBefore = this.horizontalSpeed;
    const baseRate = hasInput ? this.locomotion.acceleration : this.locomotion.deceleration;
    const airRate = baseRate * this.jumpConfig.airControl * (hasInput ? 1 : AIR_DRAG_FACTOR);
    const rate = this.onGround ? baseRate : airRate;
    const t = Math.min(1, rate * dt);
    this.velocity.lerp(targetVelocity, t);
    if (hasInput) this.easeGaitChange(speedBefore, dt);

    // A fresh press opens the buffer window; a jump this frame consumes it.
    if (this.pressPending) {
      this.pressPending = false;
      this.bufferRemaining = Math.max(this.jumpConfig.jumpBufferMs / 1000, CONTACT_EPSILON);
    }
    this.tryJump(false);

    this.moveWithCollision(this.velocity.x * dt, this.velocity.z * dt);

    // Vertical motion in fixed substeps, so the arc does not depend on frame rate.
    let remaining = dt;
    while (remaining > 1e-9) {
      const step = Math.min(PHYSICS_STEP_SECONDS, remaining);
      const landed = this.stepVertical(step);
      remaining -= step;
      // A press remembered from just before landing jumps now.
      if (landed) this.tryJump(true);
    }

    this.bufferRemaining = Math.max(0, this.bufferRemaining - dt);
    if (!this.onGround) this.coyoteRemaining = Math.max(0, this.coyoteRemaining - dt);
    this.jumpStartRemaining = Math.max(0, this.jumpStartRemaining - dt);
    this.landingRemaining = Math.max(0, this.landingRemaining - dt);

    this.recoverIfLost();
  }

  /**
   * Whether a point on the ground is clear of every collider: somewhere the
   * child could be placed. Reads the live collider list, so a collider an
   * extension added, or removed because a bridge was mended, counts as it is
   * now.
   */
  canStandAt(x: number, z: number): boolean {
    return !this.blockedAt(x, z, this.groundHeightAt(x, z) ?? 0, this.stepHeight);
  }

  /**
   * Places the child at (`x`, `z`) facing `yaw`, standing still and looking
   * level, if they could stand there. Returns `false` and moves nothing when
   * the spot is solid. Leftover walking speed is dropped, so a placement
   * never carries the child on through a wall.
   */
  teleportTo(x: number, z: number, yaw: number = this.yaw): boolean {
    if (!this.canStandAt(x, z)) return false;
    this.position.set(x, this.groundHeightAt(x, z) ?? 0, z);
    this.yaw = yaw;
    this.pitch = 0;
    this.stopEverything();
    return true;
  }

  private stopEverything(): void {
    this.velocity.set(0, 0, 0);
    this.verticalSpeed = 0;
    this.onGround = true;
    this.coyoteRemaining = 0;
    this.airJumpsUsed = 0;
    this.jumpStartRemaining = 0;
    this.landingRemaining = 0;
    this.clearJumpInput();
    this.lastSafe.copy(this.position);
  }

  private tryJump(buffered: boolean): void {
    const config = this.jumpConfig;
    if (!config.enabled || this.bufferRemaining <= 0) return;
    const fromGround = this.onGround;
    const fromCoyote = !fromGround && this.coyoteRemaining > 0;
    const airJump = !fromGround && !fromCoyote && config.allowDoubleJump && this.airJumpsUsed < 1;
    if (!fromGround && !fromCoyote && !airJump) return;
    if (airJump) this.airJumpsUsed += 1;
    this.verticalSpeed = jumpLaunchSpeed(config);
    this.onGround = false;
    this.coyoteRemaining = 0;
    this.bufferRemaining = 0;
    this.jumpStartRemaining = JUMP_START_SECONDS;
    this.landingRemaining = 0;
    this.events.push({ type: 'JUMPED', fromCoyote, buffered, airJump });
  }

  /** One vertical substep. Returns true when the child touched down during it. */
  private stepVertical(step: number): boolean {
    const { x, z } = this.position;
    const before = this.position.y;

    if (this.onGround) {
      const support = this.supportHeight(x, z, before, this.stepHeight);
      if (support === null || support < before - this.stepHeight - CONTACT_EPSILON) {
        // Walked off an edge: fall, with a moment of coyote time to still jump.
        this.onGround = false;
        this.verticalSpeed = 0;
        this.coyoteRemaining = this.jumpConfig.coyoteTimeMs / 1000;
      } else {
        // Follow small steps up and down without leaving the ground.
        this.position.y = support;
        return false;
      }
    }

    this.verticalSpeed = Math.max(
      this.verticalSpeed - this.jumpConfig.gravity * step,
      -this.jumpConfig.maxFallSpeed,
    );
    let next = before + this.verticalSpeed * step;

    // Head bump: rising into the underside of a jumpable collider stops the rise.
    if (this.verticalSpeed > 0) {
      const ceiling = this.ceilingHeight(x, z, before + this.bodyHeight);
      if (ceiling !== null && next + this.bodyHeight > ceiling) {
        next = Math.max(before, ceiling - this.bodyHeight);
        this.verticalSpeed = 0;
      }
    }

    // Landing: the highest support at or below where the feet were. A top
    // within a step above the feet counts too, so a jump that only just
    // reaches a rock's edge lands on it rather than sinking into its side.
    if (this.verticalSpeed <= 0) {
      const support = this.supportHeight(x, z, before, this.stepHeight);
      if (support !== null && next <= support + CONTACT_EPSILON) {
        const impactSpeed = -this.verticalSpeed;
        this.position.y = support;
        this.verticalSpeed = 0;
        this.onGround = true;
        this.airJumpsUsed = 0;
        this.coyoteRemaining = 0;
        this.jumpStartRemaining = 0;
        this.landingRemaining = LANDING_SECONDS;
        this.events.push({ type: 'LANDED', impactSpeed });
        return true;
      }
    }

    this.position.y = next;
    return false;
  }

  /**
   * The highest surface under (x, z) whose top is no higher than
   * `feetY + allowance`: the ground, or a jumpable collider's top. `null`
   * when there is nothing (a hole).
   */
  private supportHeight(x: number, z: number, feetY: number, allowance: number): number | null {
    let best = this.groundHeightAt(x, z);
    if (best !== null && best > feetY + allowance) best = null;
    for (const box of this.colliders) {
      if (!this.jumpable.has(box) || !insideFootprint(box, x, z)) continue;
      const top = box.max.y;
      if (top <= feetY + allowance && (best === null || top > best)) best = top;
    }
    return best;
  }

  /** The lowest jumpable underside above the head at (x, z), or `null`. */
  private ceilingHeight(x: number, z: number, headY: number): number | null {
    let lowest: number | null = null;
    for (const box of this.colliders) {
      if (!this.jumpable.has(box) || !insideFootprint(box, x, z)) continue;
      const bottom = box.min.y;
      if (bottom >= headY - CONTACT_EPSILON && (lowest === null || bottom < lowest))
        lowest = bottom;
    }
    return lowest;
  }

  /**
   * Above walking pace, speed changes no faster than the gait rates: walk to
   * sprint, or sprint back to walk, eases over a fraction of a second rather
   * than snapping. Walking pace and below keep the existing snappy response.
   */
  private easeGaitChange(speedBefore: number, dt: number): void {
    const walk = this.locomotion.walkSpeed;
    const speed = this.horizontalSpeed;
    let limited = speed;
    if (speed > Math.max(walk, speedBefore)) {
      limited = Math.min(
        speed,
        Math.max(walk, speedBefore + this.locomotion.gaitAcceleration * dt),
      );
    } else if (speedBefore > walk && speed < speedBefore) {
      limited = Math.max(
        speed,
        Math.max(walk, speedBefore - this.locomotion.gaitDeceleration * dt),
      );
    }
    if (limited !== speed && speed > 0) {
      const scale = limited / speed;
      this.velocity.x *= scale;
      this.velocity.z *= scale;
    }
  }

  /**
   * Axis-separated collision resolution: a blocked axis stops, the other still
   * slides. A long move is cut into `MAX_COLLISION_STEP` pieces, so a fast
   * child on a slow frame cannot step clean through a thin wall.
   */
  private moveWithCollision(dx: number, dz: number): void {
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / MAX_COLLISION_STEP));
    let stepX = dx / steps;
    let stepZ = dz / steps;
    for (let i = 0; i < steps; i += 1) {
      const blocked = this.moveStep(stepX, stepZ);
      if (blocked.x) stepX = 0;
      if (blocked.z) stepZ = 0;
      if (stepX === 0 && stepZ === 0) return;
    }
  }

  /** One collision-tested step; reports which axes were blocked. */
  private moveStep(dx: number, dz: number): { x: boolean; z: boolean } {
    const blocked = { x: false, z: false };
    const allowance = this.stepHeight;
    if (dx !== 0) {
      const nextX = this.position.x + dx;
      if (!this.blockedAt(nextX, this.position.z, this.position.y, allowance)) {
        this.position.x = nextX;
      } else {
        this.velocity.x = 0;
        blocked.x = true;
      }
    }
    if (dz !== 0) {
      const nextZ = this.position.z + dz;
      if (!this.blockedAt(this.position.x, nextZ, this.position.y, allowance)) {
        this.position.z = nextZ;
      } else {
        this.velocity.z = 0;
        blocked.z = true;
      }
    }
    return blocked;
  }

  /**
   * Whether the body standing with its feet at `feetY` would be inside a
   * collider at (x, z). Solid colliders are tested at ground level, as they
   * always were, so they block at every height. Jumpable ones block only
   * where they overlap the body, less a step the feet may climb.
   */
  private blockedAt(x: number, z: number, feetY: number, stepAllowance: number): boolean {
    for (const box of this.colliders) {
      if (this.jumpable.has(box)) {
        if (!insideFootprint(box, x, z)) continue;
        const overlapsBody =
          box.max.y > feetY + stepAllowance + CONTACT_EPSILON &&
          box.min.y < feetY + this.bodyHeight - CONTACT_EPSILON;
        if (overlapsBody) return true;
      } else if (box.containsPoint(groundProbe.set(x, 0, z))) {
        return true;
      }
    }
    return false;
  }

  /** Safe recovery: a child who falls out of the world goes back to the last place they stood. */
  private recoverIfLost(): void {
    const { x, y, z } = this.position;
    let reason: Extract<MovementEvent, { type: 'RECOVERED' }>['reason'] | null = null;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      reason = 'INVALID_POSITION';
    } else if (y < this.recoveryDepth) {
      reason = 'FELL_OUT_OF_WORLD';
    } else if (!this.isInPlayableArea(x, z)) {
      reason = 'LEFT_PLAYABLE_AREA';
    }
    if (reason === null) {
      if (this.onGround) this.lastSafe.copy(this.position);
      return;
    }
    this.position.copy(this.lastSafe);
    this.stopEverything();
    this.events.push({ type: 'RECOVERED', reason });
  }
}

const groundProbe = new Vector3();

function insideFootprint(box: Box3, x: number, z: number): boolean {
  return x >= box.min.x && x <= box.max.x && z >= box.min.z && z <= box.max.z;
}
