/**
 * The player movement system (GE-020): drives a `FirstPersonController` in the `simulation`
 * phase from an input source and is the single writer of the canonical `PlayerTransform`
 * on the `player` entity. Camera, animation, audio and gameplay components read the
 * transform; nothing else moves the player. It maps controller events to the engine's
 * presentation events on `runtime.events`. It never validates answers, awards progress or
 * calls AI (ADR-020).
 */

import type { FirstPersonController, MoveInput } from './firstPersonController';
import { PHYSICS_STEP_SECONDS } from './firstPersonController';
import {
  MOVEMENT_CLIMBING,
  MOVEMENT_EXTERNAL_FORCES,
  MOVEMENT_SURFACES,
  MOVEMENT_SWIMMING,
  type ExternalForcesConfig,
  type SurfacesConfig,
} from './capabilities';
import type { EngineRuntime } from '../core/runtime';
import type { EngineSystem } from '../core/systems';
import type { EnvironmentQuery } from '../contracts/physics';
import { DEFAULT_SURFACE } from '../contracts/physics';
import type { EnginePresentationEventMap } from '../contracts/engineEvents';
import {
  PLAYER_ENTITY_ID,
  PlayerTransformComponent,
  createPlayerTransform,
  type PlayerGait,
} from '../contracts/player';
import type { AabbPhysicsProvider } from '../physics/aabbProvider';

/** One simulation step of player input, polled by the movement system. */
export interface MovementInputFrame {
  move: MoveInput;
  /** A jump press this step (an edge; held buttons must not repeat). */
  jumpPressed?: boolean;
  /** Look delta (pointer movement), applied before the step. */
  look?: { dx: number; dy: number };
}

export type MovementInputSource = () => MovementInputFrame;

export const MOVEMENT_SYSTEM_ID = 'movement.player';
/** Distance between footstep events while walking, metres. */
export const FOOTSTEP_STRIDE = 0.8;

export interface MovementSystemOptions {
  controller: FirstPersonController;
  input: MovementInputSource;
  /** Names the collider the child stands on (`supportId`). */
  physics?: AabbPhysicsProvider;
  /**
   * The one checkpoint system (`gameplay.checkpoints`, `CheckpointsService`) read-only:
   * `PlayerRecovered` names the latest checkpoint. Reaching checkpoints, their presentation
   * events and their claims are that system's job, never movement's.
   */
  checkpoints?: { latest(): { id: string } | null };
  /**
   * Names what caused the recovery the controller just made (a hazard and the checkpoint it
   * sent the child to), read once per `RECOVERED` so exactly one `PlayerRecovered` carries
   * them. Absent or `null`: the latest checkpoint, no hazard.
   */
  recoveryDetails?: () => { checkpointId?: string | null; hazardId?: string | null } | null;
}

export type MovementRuntime = Pick<
  EngineRuntime<EnginePresentationEventMap>,
  'world' | 'events' | 'systems'
>;

export interface MovementSystemHandle {
  readonly system: EngineSystem;
  /**
   * GE-L10: re-publishes the canonical transform after something else moved the controller
   * inside the same simulation step (platform carry, a bounce launch), so the transform never
   * shows the carried position a step late. Position, grounded, state and support follow the
   * controller; `previousPosition` stays the start of the step (interpolation then includes the
   * carry) and `velocity` stays the child's own (being carried is not walking: the avatar keeps
   * facing and gait). The movement system stays the single writer.
   */
  syncTransform(): void;
  dispose(): void;
}

/** Installs the system on a runtime and creates the `player` entity with its transform. */
export function installMovementSystem(
  runtime: MovementRuntime,
  options: MovementSystemOptions,
): MovementSystemHandle {
  const { controller, input, physics, checkpoints } = options;
  const world = runtime.world;
  let entity = world.bySemanticId(PLAYER_ENTITY_ID);
  const initial = createPlayerTransform(controller.position, controller.yaw);
  if (entity === undefined) {
    entity = world.create(PLAYER_ENTITY_ID);
  }
  if (world.has(entity, PlayerTransformComponent)) {
    world.set(entity, PlayerTransformComponent, initial);
  } else {
    world.add(entity, PlayerTransformComponent, initial);
  }
  const player = entity;
  let lastGait: PlayerGait = controller.gait;
  let stride = 0;
  let stepStart: Readonly<{ x: number; y: number; z: number }> = initial.previousPosition;
  let stepVelocity: Readonly<{ x: number; y: number; z: number }> = initial.velocity;

  /** The one write of the canonical transform, from the controller and this step's start. */
  const publish = () => {
    const at = controller.position;
    const box = controller.supportingBox();
    world.set(player, PlayerTransformComponent, {
      position: Object.freeze({ x: at.x, y: at.y, z: at.z }),
      previousPosition: stepStart,
      yaw: controller.yaw,
      pitch: controller.pitch,
      velocity: stepVelocity,
      grounded: controller.grounded,
      state: controller.playerState,
      gait: controller.gait,
      supportId: box && physics ? physics.idOfBox(box) : null,
    });
  };

  const system: EngineSystem = {
    id: MOVEMENT_SYSTEM_ID,
    phase: 'simulation',
    order: -100,
    update({ dt }) {
      const frame = input();
      if (frame.look) {
        controller.applyLookDelta(frame.look.dx, frame.look.dy);
      }
      if (frame.jumpPressed) {
        controller.pressJump();
      }
      const before = {
        x: controller.position.x,
        y: controller.position.y,
        z: controller.position.z,
      };
      controller.update(dt, frame.move);

      const events = runtime.events;
      for (const event of controller.consumeEvents()) {
        switch (event.type) {
          case 'JUMPED':
            events.emit('PlayerJumped', { airJump: event.airJump });
            break;
          case 'LANDED':
            events.emit('PlayerLanded', { impactSpeed: event.impactSpeed });
            break;
          case 'RECOVERED': {
            const details = options.recoveryDetails?.() ?? null;
            const checkpointId =
              details?.checkpointId !== undefined
                ? details.checkpointId
                : (checkpoints?.latest()?.id ?? null);
            events.emit(
              'PlayerRecovered',
              details?.hazardId
                ? { reason: event.reason, checkpointId, hazardId: details.hazardId }
                : { reason: event.reason, checkpointId },
            );
            break;
          }
          case 'LAUNCHED':
            // A bounce needs the platform id; the platform component announces PlayerBounced.
            break;
        }
      }

      const after = controller.position;
      const safeDt = dt > 0 ? dt : PHYSICS_STEP_SECONDS;
      const gait = controller.gait;
      stepStart = Object.freeze(before);
      // Velocity actually achieved: zero into a wall, no drift.
      stepVelocity = Object.freeze({
        x: (after.x - before.x) / safeDt,
        y: (after.y - before.y) / safeDt,
        z: (after.z - before.z) / safeDt,
      });
      publish();

      if (gait !== lastGait) {
        lastGait = gait;
        events.emit('PlayerGaitChanged', { gait });
        stride = 0;
      }
      if (gait !== 'idle' && controller.grounded) {
        stride += Math.hypot(after.x - before.x, after.z - before.z);
        if (stride >= FOOTSTEP_STRIDE) {
          stride -= FOOTSTEP_STRIDE;
          events.emit('PlayerFootstep', { gait });
        }
      } else {
        stride = 0;
      }
    },
  };
  const remove = runtime.systems.add(system);
  return {
    system,
    syncTransform() {
      if (world.exists(player)) publish();
    },
    dispose() {
      remove();
      if (world.exists(player)) {
        world.destroy(player);
      }
    },
  };
}

// --- environment gating -------------------------------------------------------------------

export interface MovementEnvironmentOptions {
  /** Capability ids that are enabled (from `runtime.installed`). Features not listed are off. */
  features: ReadonlySet<string>;
  /** Reduced motion scales forces down (halved by default). */
  reducedMotion?: () => boolean;
  /** Scale applied to forces under reduced motion, 0 to 1. */
  reducedMotionScale?: number;
}

/** The features the runtime has installed, for `gateEnvironment`. */
export function installedMovementFeatures(runtime: Pick<EngineRuntime, 'installed'>): Set<string> {
  const on = new Set<string>();
  for (const id of [
    MOVEMENT_SURFACES,
    MOVEMENT_EXTERNAL_FORCES,
    MOVEMENT_SWIMMING,
    MOVEMENT_CLIMBING,
  ]) {
    const config = runtime.installed.get(id) as { enabled?: boolean } | undefined;
    if (runtime.installed.has(id) && config?.enabled !== false) {
      on.add(id);
    }
  }
  return on;
}

export function reducedMotionScaleOf(runtime: Pick<EngineRuntime, 'capabilityConfig'>): number {
  return (
    runtime.capabilityConfig<ExternalForcesConfig>(MOVEMENT_EXTERNAL_FORCES)?.reducedMotionScale ??
    0.5
  );
}

export function maxWalkableSlopeOf(
  runtime: Pick<EngineRuntime, 'capabilityConfig'>,
): number | undefined {
  return runtime.capabilityConfig<SurfacesConfig>(MOVEMENT_SURFACES)?.maxWalkableSlope ?? undefined;
}

/**
 * Wraps an environment so only enabled movement capabilities reach the controller: a world
 * that authors water but does not enable `movement.swimming` is just ground. Pass the result
 * as the controller's `environment` option.
 */
export function gateEnvironment(
  source: EnvironmentQuery,
  options: MovementEnvironmentOptions,
): EnvironmentQuery {
  const { features } = options;
  const scale = options.reducedMotionScale ?? 0.5;
  return {
    surfaceAt: (x, y, z) =>
      features.has(MOVEMENT_SURFACES) ? source.surfaceAt(x, y, z) : DEFAULT_SURFACE,
    forcesAt: (x, y, z) => {
      if (!features.has(MOVEMENT_EXTERNAL_FORCES)) {
        return [];
      }
      const forces = source.forcesAt(x, y, z);
      if (!options.reducedMotion?.() || forces.length === 0) {
        return forces;
      }
      return forces.map((force) => ({
        ...force,
        acceleration: {
          x: force.acceleration.x * scale,
          y: force.acceleration.y * scale,
          z: force.acceleration.z * scale,
        },
      }));
    },
    mediumAt: (x, y, z) => (features.has(MOVEMENT_SWIMMING) ? source.mediumAt(x, y, z) : 'AIR'),
    waterSurfaceAt: (x, z) =>
      features.has(MOVEMENT_SWIMMING) ? source.waterSurfaceAt(x, z) : null,
    climbableAt: (x, y, z) =>
      features.has(MOVEMENT_CLIMBING) ? source.climbableAt(x, y, z) : null,
  };
}
