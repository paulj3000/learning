import { Box3, Vector3 } from 'three';
import {
  DEFAULT_SURFACE,
  type ClimbableInfo,
  type EnvironmentQuery,
} from '../contracts/physics';
import type { PlayerMovementState } from '../contracts/player';
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
import {
  footprintDistance,
  resolvePlayerCollision,
  type PlayerCollisionConfiguration,
} from './playerCollision';

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
 * The child is a vertical cylinder, not a point (Defect 2, castle walls): `collision.radius`
 * (0.35 m by default, `playerCollision.ts`) plus a small `skin` around the feet position, the
 * same in first- and third-person. Blocking uses `radius + skin`; standing on, landing on and
 * riding a jumpable box go by the feet first, and by the body's `radius` only where nothing
 * jumpable is under the feet (a body half over a crate's edge stands on it).
 * Heights never change: a barrel or platform is exactly as tall as before. A child
 * already overlapping something (an authored spawn too close to a wall) may always move away
 * from it, never further in.
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
      /** Why the child was put back (`HAZARD`: a platforming hazard such as water). */
      reason: 'FELL_OUT_OF_WORLD' | 'LEFT_PLAYABLE_AREA' | 'INVALID_POSITION' | 'HAZARD';
    }
  | {
      /** Platforms: a bounce pad threw the child up, to about `height` metres. */
      type: 'LAUNCHED';
      height: number;
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
  /** The child's horizontal footprint (radius, skin). Missing fields take the defaults. */
  collision?: Partial<PlayerCollisionConfiguration>;
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
  /**
   * Platforms: whether the ground under the feet may be remembered as the safe place to put a
   * lost child back. A moving or vanishing platform is not (it may be gone by then). Defaults
   * to everywhere.
   */
  isSafeGround?: (x: number, y: number, z: number) => boolean;
  /**
   * Platforms: where to put a lost child instead of the last safe ground (the latest course
   * checkpoint). `null` or absent: the last safe ground, as always.
   */
  recoveryPoint?: () => { x: number; z: number; yaw?: number } | null;
  /**
   * Optional world queries (GE-020, additive and off by default): surface friction and ice,
   * external forces, water, climbables. Absent, the controller behaves exactly as before.
   */
  environment?: EnvironmentQuery;
  /**
   * Steepest ground, as rise over run (1 is 45 degrees), the child may walk up. Ground rising
   * faster over one footprint step blocks like a wall; descending is never blocked. Default
   * unlimited: today's behaviour.
   */
  maxWalkableSlope?: number;
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
/** Platforms: feet within this of a box's top count as standing on it, metres. */
const SUPPORT_TOLERANCE = 0.05;
/** In the air with no input, the fraction of ground deceleration (times `airControl`) that applies. */
const AIR_DRAG_FACTOR = 0.2;
/** Friction is clamped to this range so a surface can never be a rink with no grip at all. */
export const MIN_SURFACE_FRICTION = 0.05;
/** A child on the slipperiest surface stops within this distance of letting go, metres. */
export const ICE_STOP_DISTANCE = 0.9;
/** Slowest ground acceleration on ice, 1/s: a child can always get going and steer. */
export const ICE_MIN_ACCELERATION = 3;
/** Surfaces below this friction make a coasting child `SLIDING`. */
export const SLIDING_FRICTION = 0.3;
/** Horizontal external force is capped at this, m/s squared. */
export const MAX_EXTERNAL_FORCE = 12;
/**
 * Forces are further capped so the drift they cause stays under this fraction of walking
 * speed: walking against any force always wins, and a child can walk out of it.
 */
export const FORCE_WALK_FRACTION = 0.4;
/** Swimming. Reduced gravity as a fraction, spring toward the float height, strokes, speed. */
export const SWIM_GRAVITY_FACTOR = 0.15;
export const SWIM_FLOAT_DEPTH = 0.9;
export const SWIM_BUOYANCY = 10;
export const SWIM_DAMPING = 3;
export const SWIM_STROKE_SPEED = 4.5;
export const SWIM_SPEED_FACTOR = 0.6;
const SWIM_ENTER_PROBE = 0.9;
const SWIM_STAY_PROBE = 0.1;
/** Climbing, m/s, and the pause before a ladder can be grabbed again after letting go, seconds. */
export const CLIMB_SPEED = 1.5;
const CLIMB_PROBE = 0.5;
const CLIMB_REGRAB_SECONDS = 0.5;
const CLIMB_ENTER_YAW = 1.2;
const CLIMB_JUMP_OFF_SPEED = 1.5;
/** Tolerance for floating-point contact, metres. */
const CONTACT_EPSILON = 1e-4;
/** How much closer an overlapping box may get in one step (rounding only): never a creep in. */
const ESCAPE_EPSILON = 1e-9;

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
  private readonly collisionConfig: PlayerCollisionConfiguration;
  /** `radius + skin`: how close the feet position may come to a blocking box, metres. */
  private readonly reach: number;
  private readonly groundHeightAt: (x: number, z: number) => number | null;
  private readonly recoveryDepth: number;
  private readonly isInPlayableArea: (x: number, z: number) => boolean;
  private readonly isSafeGround: (x: number, y: number, z: number) => boolean;
  private readonly recoveryPoint: () => { x: number; z: number; yaw?: number } | null;
  private jumpConfig: JumpConfiguration;
  private environment: EnvironmentQuery | null;
  private readonly maxWalkableSlope: number;
  private climb: ClimbableInfo | null = null;
  private climbCooldown = 0;
  private swimmingNow = false;
  private slidingNow = false;
  private surfaceFriction = 1;

  private verticalSpeed = 0;
  private onGround = true;
  private coyoteRemaining = 0;
  private bufferRemaining = 0;
  private pressPending = false;
  private airJumpsUsed = 0;
  private jumpStartRemaining = 0;
  private landingRemaining = 0;
  /**
   * How fast the child's own walking really moved them in the last update, m/s, after
   * collisions: the distance actually covered, not the speed asked for. Being carried by a
   * platform is not counted. Gait and animation read this, so a child pushing into a wall
   * stands idle instead of walking on the spot (or away from the camera).
   */
  private walkedSpeed = 0;
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
    this.collisionConfig = resolvePlayerCollision(options.collision);
    this.reach = this.collisionConfig.radius + this.collisionConfig.skin;
    this.groundHeightAt = options.groundHeightAt ?? (() => 0);
    this.recoveryDepth = options.recoveryDepth ?? DEFAULT_RECOVERY_DEPTH;
    this.isInPlayableArea = options.isInPlayableArea ?? (() => true);
    this.isSafeGround = options.isSafeGround ?? (() => true);
    this.recoveryPoint = options.recoveryPoint ?? (() => null);
    this.jumpConfig = resolveJumpConfiguration(options.jump);
    this.environment = options.environment ?? null;
    const slope = options.maxWalkableSlope;
    this.maxWalkableSlope =
      typeof slope === 'number' && Number.isFinite(slope) && slope > 0 ? slope : Infinity;
    this.position = options.startPosition?.clone() ?? new Vector3();
    this.lastSafe.copy(this.position);
  }

  /** The child's footprint in force (radius and skin, metres). */
  get collision(): Readonly<PlayerCollisionConfiguration> {
    return this.collisionConfig;
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

  /**
   * How the child is moving over the ground right now, from how far their own walking really
   * moved them (`locomotionSpeed`): blocked by a wall is idle, sliding along it is walking,
   * standing still on a moving platform is idle.
   */
  get gait(): Gait {
    const speed = this.walkedSpeed;
    if (speed <= WALK_SPEED_THRESHOLD) return 'idle';
    if (speed > this.locomotion.runSpeed + GAIT_MARGIN) return 'sprint';
    if (speed > this.locomotion.walkSpeed + GAIT_MARGIN) return 'run';
    return 'walk';
  }

  /**
   * Speed actually covered by the child's own walking in the last update, m/s, after
   * collisions (never more than `horizontalSpeed`, and 0 against a wall). Animation playback
   * and gait use this; platform carrying is excluded.
   */
  get locomotionSpeed(): number {
    return this.walkedSpeed;
  }

  /** Horizontal speed, m/s (the controller's velocity, before it meets anything). */
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
   * The full body state including `CLIMBING`, `SWIMMING` and `SLIDING` (the engine's
   * `PlayerMovementState`). `movementState` keeps its original eight values so existing
   * exhaustive consumers (animation tables) compile and behave unchanged; the engine's
   * movement system reads this one.
   */
  get playerState(): PlayerMovementState {
    if (this.climb !== null) return 'CLIMBING';
    if (this.swimmingNow) return 'SWIMMING';
    if (this.slidingNow) return 'SLIDING';
    return this.movementState;
  }

  /** On a ladder or other climbable. */
  /**
   * Replaces the environment (surfaces, forces, water, climbables) from the next update
   * (GE-065: a bridge extension mounts after the controller exists). `null` returns to plain
   * ground: any climb or swim ends at once and the child falls or stands normally, and friction
   * is 1 again. Setting the same environment again changes nothing.
   */
  setEnvironment(query: EnvironmentQuery | null): void {
    if (query === this.environment) {
      return;
    }
    this.environment = query;
    if (query === null) {
      this.climb = null;
      this.swimmingNow = false;
      this.slidingNow = false;
      this.surfaceFriction = 1;
    }
  }

  get climbing(): boolean {
    return this.climb !== null;
  }

  /** In water deep enough to swim. */
  get swimming(): boolean {
    return this.swimmingNow;
  }

  /** Coasting on a low-friction surface with no input. */
  get sliding(): boolean {
    return this.slidingNow;
  }

  /** The friction of the surface underfoot at the last update (1 without an environment). */
  get friction(): number {
    return this.surfaceFriction;
  }

  /** The id of the climbable being climbed, if any. */
  get climbableId(): string | null {
    return this.climb?.id ?? null;
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

    const env = this.environment;
    if (env !== null) {
      this.climbCooldown = Math.max(0, this.climbCooldown - dt);
      if (this.climb === null) this.tryStartClimb(moveInput);
      if (this.climb !== null) {
        this.updateClimb(dt, moveInput);
        this.recoverIfLost();
        return;
      }
      this.updateSwimState();
    }

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
    let rate = this.onGround ? baseRate : airRate;
    let forceCap = 0;
    if (env !== null) {
      const shaped = this.shapeRates(env, hasInput, targetVelocity, rate);
      rate = shaped.rate;
      forceCap = shaped.forceCap;
    }
    const t = Math.min(1, rate * dt);
    this.velocity.lerp(targetVelocity, t);
    if (hasInput) this.easeGaitChange(speedBefore, dt);
    if (env !== null) this.applyExternalForces(env, dt, forceCap);

    if (env !== null && this.swimmingNow && this.pressPending) {
      // Jump is a swim stroke in water: one push up, never a leap.
      this.pressPending = false;
      this.verticalSpeed = SWIM_STROKE_SPEED;
    }

    // A fresh press opens the buffer window; a jump this frame consumes it.
    if (this.pressPending) {
      this.pressPending = false;
      this.bufferRemaining = Math.max(this.jumpConfig.jumpBufferMs / 1000, CONTACT_EPSILON);
    }
    this.tryJump(false);

    const fromX = this.position.x;
    const fromZ = this.position.z;
    this.moveWithCollision(this.velocity.x * dt, this.velocity.z * dt);
    if (dt > 0) {
      this.walkedSpeed = Math.hypot(this.position.x - fromX, this.position.z - fromZ) / dt;
    }

    // Vertical motion in fixed substeps, so the arc does not depend on frame rate.
    let remaining = dt;
    while (remaining > 1e-9) {
      const step = Math.min(PHYSICS_STEP_SECONDS, remaining);
      const landed = this.swimmingNow ? this.stepSwim(step) : this.stepVertical(step);
      remaining -= step;
      // A press remembered from just before landing jumps now.
      if (landed) this.tryJump(true);
    }

    this.bufferRemaining = Math.max(0, this.bufferRemaining - dt);
    if (!this.onGround) this.coyoteRemaining = Math.max(0, this.coyoteRemaining - dt);
    this.jumpStartRemaining = Math.max(0, this.jumpStartRemaining - dt);
    this.landingRemaining = Math.max(0, this.landingRemaining - dt);

    if (env !== null) {
      this.slidingNow =
        this.onGround &&
        !hasInput &&
        this.surfaceFriction < SLIDING_FRICTION &&
        this.horizontalSpeed > WALK_SPEED_THRESHOLD;
    }
    this.recoverIfLost();
  }

  /**
   * Environment shaping of this frame's rate and top speed (only with an `environment`).
   * Returns the lerp rate and the cap for external forces. On the ground, friction scales
   * acceleration and deceleration, never top speed (ice does not make the child faster);
   * `speedMultiplier` scales top speed. Floors keep a child able to start, steer and stop
   * within `ICE_STOP_DISTANCE` of letting go at walking speed on any surface.
   */
  private shapeRates(
    env: EnvironmentQuery,
    hasInput: boolean,
    target: Vector3,
    plainRate: number,
  ): { rate: number; forceCap: number } {
    const walk = this.locomotion.walkSpeed;
    let rate = plainRate;
    let withInput: number;
    let withoutInput: number;
    if (this.swimmingNow) {
      target.multiplyScalar(SWIM_SPEED_FACTOR);
      this.surfaceFriction = 1;
      withInput = this.locomotion.acceleration * 0.5;
      withoutInput = this.locomotion.deceleration * 0.5;
      rate = hasInput ? withInput : withoutInput;
    } else if (this.onGround) {
      const { x, y, z } = this.position;
      const surface = env.surfaceAt(x, y, z) ?? DEFAULT_SURFACE;
      const friction = clamp(Number.isFinite(surface.friction) ? surface.friction : 1, MIN_SURFACE_FRICTION, 1);
      const speedMultiplier = clamp(Number.isFinite(surface.speedMultiplier) ? surface.speedMultiplier : 1, 0.5, 1.5);
      this.surfaceFriction = friction;
      target.multiplyScalar(speedMultiplier);
      if (friction >= 1) {
        // Normal ground: exactly the plain rates.
        withInput = this.locomotion.acceleration;
        withoutInput = this.locomotion.deceleration;
      } else {
        const stopRate = (walk - WALK_SPEED_THRESHOLD) / ICE_STOP_DISTANCE;
        withInput = Math.max(this.locomotion.acceleration * friction, ICE_MIN_ACCELERATION);
        withoutInput = Math.max(this.locomotion.deceleration * friction, stopRate);
        // Pushing against the way they slide is braking, which uses the stopping rate.
        const braking = hasInput && this.velocity.dot(target) < 0;
        rate = !hasInput || braking ? withoutInput : withInput;
      }
    } else {
      this.surfaceFriction = 1;
      const air = this.locomotion.acceleration * this.jumpConfig.airControl;
      withInput = air;
      withoutInput = air * AIR_DRAG_FACTOR;
    }
    const forceCap = Math.min(
      MAX_EXTERNAL_FORCE,
      FORCE_WALK_FRACTION * walk * Math.min(withInput, withoutInput),
    );
    return { rate, forceCap };
  }

  /**
   * Sums the forces at the body into velocity (wind, currents, conveyors, updrafts). The
   * horizontal push is capped (`MAX_EXTERNAL_FORCE`, and so that walking against it always
   * wins). Movement still goes through the collision sweep, so a force never pushes the child
   * through a collider.
   */
  private applyExternalForces(env: EnvironmentQuery, dt: number, forceCap: number): void {
    const { x, y, z } = this.position;
    let ax = 0;
    let ay = 0;
    let az = 0;
    for (const force of env.forcesAt(x, y, z)) {
      if (this.onGround && force.affectsGrounded === false) continue;
      const a = force.acceleration;
      if (Number.isFinite(a.x) && Number.isFinite(a.y) && Number.isFinite(a.z)) {
        ax += a.x;
        ay += a.y;
        az += a.z;
      }
    }
    const horizontal = Math.hypot(ax, az);
    if (horizontal > 0) {
      const scale = Math.min(1, forceCap / horizontal);
      this.velocity.x += ax * scale * dt;
      this.velocity.z += az * scale * dt;
    }
    if (ay !== 0 && !this.swimmingNow) {
      const limit = this.jumpConfig.gravity * 1.5;
      const lift = clamp(ay, -limit, limit);
      if (this.onGround) {
        // An updraft stronger than gravity lifts the child off the ground.
        if (lift > this.jumpConfig.gravity) {
          this.onGround = false;
          this.coyoteRemaining = 0;
          this.verticalSpeed += lift * dt;
        }
      } else {
        this.verticalSpeed += lift * dt;
      }
    }
  }

  /** Enters or leaves swimming from the water around the body. */
  private updateSwimState(): void {
    const env = this.environment!;
    const { x, y, z } = this.position;
    const probe = this.swimmingNow ? SWIM_STAY_PROBE : SWIM_ENTER_PROBE;
    const inWater = env.mediumAt(x, y + probe, z) === 'WATER' && env.waterSurfaceAt(x, z) !== null;
    if (inWater && !this.swimmingNow) {
      this.swimmingNow = true;
      this.onGround = false;
      this.coyoteRemaining = 0;
      this.airJumpsUsed = 0;
      this.jumpStartRemaining = 0;
      this.landingRemaining = 0;
      this.bufferRemaining = 0;
      this.verticalSpeed = Math.max(this.verticalSpeed, -2);
    } else if (!inWater && this.swimmingNow) {
      this.swimmingNow = false;
    }
  }

  /**
   * One swimming substep: reduced gravity, a spring toward the float height under the water
   * surface, damping, and the bed underfoot as a floor. No drowning and no timers.
   */
  private stepSwim(step: number): boolean {
    const { x, y, z } = this.position;
    const surface = this.environment!.waterSurfaceAt(x, z);
    const target = (surface ?? y + SWIM_FLOAT_DEPTH) - SWIM_FLOAT_DEPTH;
    const accel = SWIM_BUOYANCY * (target - y) - this.jumpConfig.gravity * SWIM_GRAVITY_FACTOR;
    this.verticalSpeed = (this.verticalSpeed + accel * step) * Math.max(0, 1 - SWIM_DAMPING * step);
    let next = y + this.verticalSpeed * step;
    const floor = this.supportHeight(x, z, y, this.stepHeight);
    if (floor !== null && next < floor) {
      next = floor;
      this.verticalSpeed = Math.max(0, this.verticalSpeed);
    }
    this.position.y = next;
    return false;
  }

  /** Starts climbing when the child pushes forward into a climbable they face. */
  private tryStartClimb(input: MoveInput): void {
    if (this.climbCooldown > 0 || input.forward < 0.5 || this.swimmingNow) return;
    const env = this.environment!;
    const { x, y, z } = this.position;
    const info = env.climbableAt(x, y + CLIMB_PROBE, z);
    if (!info) return;
    if (y > info.topY || y < info.bottomY - this.stepHeight) return;
    if (Math.abs(wrapAngle(this.yaw - info.facingYaw)) > CLIMB_ENTER_YAW) return;
    this.climb = info;
    this.yaw = info.facingYaw;
    this.position.y = Math.max(y, info.bottomY);
    this.velocity.set(0, 0, 0);
    this.verticalSpeed = 0;
    this.onGround = false;
    this.coyoteRemaining = 0;
    this.airJumpsUsed = 0;
    this.walkedSpeed = 0;
    this.slidingNow = false;
    this.clearJumpInput();
  }

  /**
   * Climbing: forward and back move the feet along the climbable, with no gravity. Jump, or
   * back at the bottom, lets go; the top puts the feet at `exitTop`.
   */
  private updateClimb(dt: number, input: MoveInput): void {
    const info = this.climb!;
    this.walkedSpeed = 0;
    this.velocity.set(0, 0, 0);
    this.verticalSpeed = 0;
    if (this.pressPending) {
      // Jump lets go and steps back off the ladder.
      this.pressPending = false;
      this.letGo(false);
      this.velocity.x = -Math.sin(info.facingYaw) * CLIMB_JUMP_OFF_SPEED;
      this.velocity.z = -Math.cos(info.facingYaw) * CLIMB_JUMP_OFF_SPEED;
      return;
    }
    const direction = clamp(input.forward, -1, 1);
    const y = this.position.y + direction * CLIMB_SPEED * dt;
    if (y >= info.topY) {
      this.position.set(info.exitTop.x, info.exitTop.y, info.exitTop.z);
      this.letGo(true);
      this.lastSafe.copy(this.position);
      return;
    }
    if (y <= info.bottomY && direction < 0) {
      this.position.y = info.bottomY;
      this.letGo(true);
      return;
    }
    this.position.y = Math.max(y, info.bottomY);
    const probeY = clamp(this.position.y + CLIMB_PROBE, info.bottomY + 0.01, info.topY - 0.01);
    const still = this.environment!.climbableAt(this.position.x, probeY, this.position.z);
    if (still === null || still.id !== info.id) this.letGo(false);
  }

  private letGo(grounded: boolean): void {
    this.climb = null;
    this.climbCooldown = CLIMB_REGRAB_SECONDS;
    this.onGround = grounded;
    this.verticalSpeed = 0;
    this.coyoteRemaining = 0;
  }

  /** Whether ground rising from one point to the next is steeper than the child may walk. */
  private tooSteep(fromX: number, fromZ: number, toX: number, toZ: number): boolean {
    if (this.maxWalkableSlope === Infinity || !this.onGround) return false;
    const from = this.groundHeightAt(fromX, fromZ);
    const to = this.groundHeightAt(toX, toZ);
    if (from === null || to === null) return false;
    const run = Math.hypot(toX - fromX, toZ - fromZ);
    return run > 0 && (to - from) / run > this.maxWalkableSlope + 1e-9;
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

  /**
   * Platforms: the jumpable box the child is standing on, if any (the highest whose top is at
   * the feet). `null` in the air or on plain ground.
   */
  supportingBox(): Box3 | null {
    if (!this.onGround) return null;
    const { x, y, z } = this.position;
    // As `supportHeight`: a box under the feet first, else one the body's edge rests on.
    for (const underFeet of [true, false]) {
      let best: Box3 | null = null;
      for (const box of this.colliders) {
        if (!this.jumpable.has(box)) continue;
        if (underFeet ? !insideFootprint(box, x, z) : !this.standsOver(box, x, z)) continue;
        if (Math.abs(box.max.y - y) > SUPPORT_TOLERANCE) continue;
        if (best === null || box.max.y > best.max.y) best = box;
      }
      if (best) return best;
    }
    return null;
  }

  /**
   * Platforms: moves a rider with the platform under them. Sideways movement is collision
   * tested like walking, so a platform never pushes the child through a wall (they stay put
   * and the platform slides on); height follows the platform exactly.
   */
  carry(dx: number, dy: number, dz: number): void {
    if (dx !== 0 || dz !== 0) {
      const vx = this.velocity.x;
      const vz = this.velocity.z;
      this.moveWithCollision(dx, dz);
      // Being carried is not walking: the child's own speed is left as it was.
      this.velocity.x = vx;
      this.velocity.z = vz;
    }
    if (dy !== 0) this.position.y += dy;
  }

  /**
   * Platforms: a child leaving a moving platform keeps its sideways speed, so a jump from a
   * ferry lands on the ferry rather than behind it. Air drag then eases it as usual.
   */
  inheritVelocity(vx: number, vz: number): void {
    if (Number.isFinite(vx)) this.velocity.x += vx;
    if (Number.isFinite(vz)) this.velocity.z += vz;
  }

  /**
   * Platforms: a bounce pad throws the child up to about `height` metres, like a jump that
   * needs no press. Gravity, air control and landing are the jump's own.
   */
  launch(height: number): void {
    if (!(height > 0)) return;
    this.verticalSpeed = Math.sqrt(2 * this.jumpConfig.gravity * height);
    this.onGround = false;
    this.coyoteRemaining = 0;
    this.bufferRemaining = 0;
    this.jumpStartRemaining = JUMP_START_SECONDS;
    this.landingRemaining = 0;
    this.events.push({ type: 'LAUNCHED', height });
  }

  /**
   * Platforms: puts the child back after a hazard (water under a missed jump): at the
   * recovery point if there is one and it is clear, else where they last stood safely.
   */
  recover(reason: 'HAZARD'): void {
    this.returnToSafety();
    this.events.push({ type: 'RECOVERED', reason });
  }

  private returnToSafety(): void {
    const point = this.recoveryPoint();
    if (point && this.canStandAt(point.x, point.z)) {
      this.position.set(point.x, this.groundHeightAt(point.x, point.z) ?? 0, point.z);
      if (point.yaw !== undefined) this.yaw = point.yaw;
      this.pitch = 0;
    } else {
      this.position.copy(this.lastSafe);
    }
    this.stopEverything();
  }

  private stopEverything(): void {
    this.velocity.set(0, 0, 0);
    this.verticalSpeed = 0;
    this.onGround = true;
    this.coyoteRemaining = 0;
    this.airJumpsUsed = 0;
    this.jumpStartRemaining = 0;
    this.landingRemaining = 0;
    this.walkedSpeed = 0;
    this.climb = null;
    this.swimmingNow = false;
    this.slidingNow = false;
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
    // The feet decide first, so a taller box beside the one underfoot never lifts the child;
    // only with nothing jumpable under the feet does the body's edge rest on a box.
    for (const underFeet of [true, false]) {
      let found: number | null = null;
      for (const box of this.colliders) {
        if (!this.jumpable.has(box)) continue;
        if (underFeet ? !insideFootprint(box, x, z) : !this.standsOver(box, x, z)) continue;
        const top = box.max.y;
        if (top <= feetY + allowance && (found === null || top > found)) found = top;
      }
      if (found !== null) return best === null || found > best ? found : best;
    }
    return best;
  }

  /** The lowest jumpable underside above the head at (x, z), or `null`. */
  private ceilingHeight(x: number, z: number, headY: number): number | null {
    let lowest: number | null = null;
    for (const box of this.colliders) {
      if (!this.jumpable.has(box) || !this.standsOver(box, x, z)) continue;
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

  /**
   * One collision-tested step; reports which axes were blocked. A blocked axis still comes up
   * to the obstacle (`CONTACT_SEARCH_ITERATIONS` halvings), so the child rests against a wall
   * rather than a few centimetres short of it. Otherwise the next frame finds a gap, walks into
   * it, and the gait flickers between walking and idle at every contact.
   */
  private moveStep(dx: number, dz: number): { x: boolean; z: boolean } {
    const blocked = { x: false, z: false };
    const allowance = this.stepHeight;
    if (dx !== 0) {
      const { x, z, y } = this.position;
      const free = (t: number) =>
        !this.blockedAt(x + dx * t, z, y, allowance, x, z) && !this.tooSteep(x, z, x + dx * t, z);
      if (free(1)) {
        this.position.x = x + dx;
      } else {
        this.position.x = x + dx * contactFraction(free);
        this.velocity.x = 0;
        blocked.x = true;
      }
    }
    if (dz !== 0) {
      const { x, z, y } = this.position;
      const free = (t: number) =>
        !this.blockedAt(x, z + dz * t, y, allowance, x, z) && !this.tooSteep(x, z, x, z + dz * t);
      if (free(1)) {
        this.position.z = z + dz;
      } else {
        this.position.z = z + dz * contactFraction(free);
        this.velocity.z = 0;
        blocked.z = true;
      }
    }
    return blocked;
  }

  /**
   * Whether the body standing with its feet at `feetY` would be blocked at (x, z). The body is
   * a cylinder of `radius + skin` around the feet position. Solid colliders are tested at ground
   * level, as they always were, so they block at every height. Jumpable ones block only where
   * they overlap the body, less a step the feet may climb.
   *
   * With a `from` position (a move), a box the body already overlaps blocks only a move that
   * goes further into it: a child placed too close to something can always step away.
   */
  private blockedAt(
    x: number,
    z: number,
    feetY: number,
    stepAllowance: number,
    fromX?: number,
    fromZ?: number,
  ): boolean {
    const reach = this.reach;
    for (const box of this.colliders) {
      if (this.jumpable.has(box)) {
        const overlapsBody =
          box.max.y > feetY + stepAllowance + CONTACT_EPSILON &&
          box.min.y < feetY + this.bodyHeight - CONTACT_EPSILON;
        if (!overlapsBody) continue;
      } else if (box.min.y > 0 || box.max.y < 0) {
        continue; // a solid box not at ground level (as `containsPoint` at y 0 was)
      }
      const distance = footprintDistance(box, x, z);
      if (distance >= reach) continue;
      if (fromX !== undefined && fromZ !== undefined) {
        const before = footprintDistance(box, fromX, fromZ);
        // Already overlapping: moving out of it, or along it, is allowed.
        if (before < reach && distance >= before - ESCAPE_EPSILON) continue;
      }
      return true;
    }
    return false;
  }

  /**
   * Whether the child's body (its `radius`, not the skin) is over a box's footprint: enough to
   * stand on its top, ride it, or bump a head on it. A body half over a crate's edge stands on
   * it, as a real child would, so a jump from right beside a crate still lands on it.
   */
  private standsOver(box: Box3, x: number, z: number): boolean {
    return footprintDistance(box, x, z) < this.collisionConfig.radius;
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
      if (this.onGround && this.isSafeGround(x, y, z)) this.lastSafe.copy(this.position);
      return;
    }
    this.returnToSafety();
    this.events.push({ type: 'RECOVERED', reason });
  }
}

/** Halvings used to bring a blocked step up to the obstacle: 0.1 m / 2^10, about 0.1 mm. */
const CONTACT_SEARCH_ITERATIONS = 10;

/** The largest fraction of a step (0..1) that is still free, by bisection. */
function contactFraction(free: (t: number) => boolean): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < CONTACT_SEARCH_ITERATIONS; i += 1) {
    const mid = (lo + hi) / 2;
    if (free(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

function insideFootprint(box: Box3, x: number, z: number): boolean {
  return x >= box.min.x && x <= box.max.x && z >= box.min.z && z <= box.max.z;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** An angle wrapped into -PI..PI. */
function wrapAngle(angle: number): number {
  const turn = Math.PI * 2;
  return angle - Math.round(angle / turn) * turn;
}
