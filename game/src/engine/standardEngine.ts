/**
 * The standard engine assembly (GE-001): turns an adventure's capability requests into real
 * gameplay. It creates a runtime on the standard registry, provides the host services the
 * capabilities need, starts it, then wires the pieces the capabilities deliberately leave to
 * the host:
 *
 * - one AABB `PhysicsProvider` (doors, gates and platforms add colliders to it; the shared
 *   controller reads its live boxes);
 * - the shared `FirstPersonController`, tuned from `movement.locomotion` and `movement.jump`
 *   (jump disabled when the adventure does not request it), with the environment volumes gated
 *   by the movement capabilities installed, and recovery to the latest checkpoint;
 * - the movement system, the single writer of the canonical `PlayerTransform`;
 * - platform carry, leaving a moving platform with its speed, and bounce pads;
 * - hazard recovery: a `HazardRecoveryRequested` puts the child back at the checkpoint, and
 *   exactly one `PlayerRecovered { reason: 'HAZARD', hazardId, checkpointId }` follows;
 * - optionally the camera rig, when the host provides a view and a camera capability is on;
 * - optionally the avatar (`character.avatar`) and its animation (`character.animation`): the
 *   avatar root sits exactly at the interpolated canonical transform, is attached to the host
 *   scene when there is a view, and loads its model only through an injected loader (no loader:
 *   the capsule placeholder, never a network fetch). Root motion is stripped from every clip.
 *
 * Defaults keep the extracted controller's behaviour: nothing here changes how the child moves
 * unless a capability asks for it. Everything is disposed through `runtime.resources`.
 */

import { Vector3 } from 'three';
import { applyCameraFrame, CameraRig, type CameraLike } from '../camera/cameraRig';
import {
  CAMERA_COLLISION,
  CAMERA_FIRST_PERSON,
  CAMERA_THIRD_PERSON,
  cameraRigOptionsFromCapabilities,
  type CameraCollisionConfig,
  type FirstPersonCameraConfig,
  type ThirdPersonCameraConfig,
} from '../camera/capabilities';
import { createCameraSystem } from '../camera/cameraSystem';
import { createAvatarController, type AvatarController, type AvatarDefinition, type AvatarLoaderPort } from '../character/avatar';
import { createAvatarFollowSystem } from '../character/avatarSystem';
import {
  animationDefinitionFromConfig,
  CHARACTER_ANIMATION,
  CHARACTER_AVATAR,
  type AnimationCapabilityConfig,
  type AvatarCapabilityConfig,
} from '../character/capabilities';
import { CheckpointsService } from '../components/checkpoints';
import {
  GameplayEventFactoryService,
  GameplaySettingsService,
  RequirementCheckService,
  onPresentation,
  type GameplaySettings,
  type HazardRecoveryRequest,
  type RequirementChecker,
} from '../components/common';
import { PlatformsService } from '../components/platforms';
import { createGameplayEventFactory, type GameplayEventContext, type GameplayEventFactoryOptions } from '../contracts/gameplayEvents';
import { EnvironmentQueryService, PhysicsProviderService } from '../contracts/physics';
import { PLAYER_ENTITY_ID, PlayerTransformComponent, type Vec3Like } from '../contracts/player';
import type { CapabilityRequest } from '../core/capabilities';
import type { DiagnosticsOptions } from '../core/diagnostics';
import type { EventMap } from '../core/eventBus';
import type { FixedTimestepOptions } from '../core/fixedTimestep';
import { createEngineRuntime, type EngineRuntime } from '../core/runtime';
import { MOVEMENT_JUMP, MOVEMENT_LOCOMOTION } from '../movement/capabilities';
import { FirstPersonController } from '../movement/firstPersonController';
import { JUMP_DISABLED, type JumpConfiguration } from '../movement/jumpConfiguration';
import { DEFAULT_LOCOMOTION, type LocomotionConfiguration } from '../movement/locomotionConfiguration';
import {
  gateEnvironment,
  installedMovementFeatures,
  installMovementSystem,
  maxWalkableSlopeOf,
  reducedMotionScaleOf,
  type MovementInputFrame,
  type MovementInputSource,
} from '../movement/movementSystem';
import { createAabbPhysicsProvider, type AabbPhysicsProvider } from '../physics/aabbProvider';
import { HOST_EVENTS, HostViewService } from './host';
import { createStandardCapabilityRegistry, type StandardCapabilityRegistry } from './standardRegistry';

/** Player input: a polled source, optionally able to forget held input (focus lost). */
export interface StandardInput {
  poll(): MovementInputFrame;
  /** Clears held keys, pointers and gamepad state. Called on `host.inputReset`. */
  reset?(): void;
}

export interface StandardEngineOptions {
  /** Stable id of what the runtime hosts (an adventure or Area id). */
  id: string;
  /** The adventure's capability requests (an `AdventureDefinition.capabilities` list). */
  requests: readonly CapabilityRequest[];
  input: StandardInput | MovementInputSource;
  /** An existing AABB provider (with authored colliders); otherwise a new, empty one. */
  physics?: AabbPhysicsProvider;
  /** Where the child starts, feet position. */
  startPosition?: Vec3Like;
  startYaw?: number;
  /** Reduced motion at start; change it later through `handle.settings.reducedMotion`. */
  reducedMotion?: boolean;
  /** Bind gameplay claims to this realm, adventure, area and session. Omit for no claims. */
  claims?: { context: GameplayEventContext; options?: GameplayEventFactoryOptions };
  /** The host's requirement check for doors, gates and portals (quest steps, world changes). */
  requirements?: RequirementChecker;
  /** Ground height for terrain (optional; flat ground at 0 by default). */
  groundHeightAt?: (x: number, z: number) => number | null;
  isInPlayableArea?: (x: number, z: number) => boolean;
  timestep?: FixedTimestepOptions;
  diagnostics?: DiagnosticsOptions;
  /** A registry to use instead of a fresh standard one (it must contain the requests). */
  registry?: StandardCapabilityRegistry;
  /**
   * Called after the runtime starts and the player exists, before the first tick (host
   * services such as the view or a Sound Manager are provided by then, see `provide`).
   */
  setup?: (handle: StandardEngineHandle) => void | Promise<void>;
  /** Provide extra host services before capabilities install (view, sound, published content). */
  provide?: (runtime: EngineRuntime<EventMap>) => void;
  /**
   * The child's avatar, used when the adventure requests `character.avatar`. `definition`
   * overrides the defaults (an asset id, an animation map, sockets); `loader` is the host's asset
   * port. Without a loader the avatar is the capsule placeholder.
   */
  avatar?: { definition?: Partial<AvatarDefinition>; loader?: AvatarLoaderPort };
}

/** The avatar used when the adventure names none: a placeholder-sized child with standard clip names. */
export const DEFAULT_AVATAR_DEFINITION: AvatarDefinition = Object.freeze({
  id: 'avatar.default',
  assetId: 'avatar.default',
  scale: 1,
  rotationOffset: 0,
  eyeHeight: 1.1,
  footprintOffset: Object.freeze({ x: 0, z: 0 }),
  animationMap: Object.freeze({ idle: 'Idle', walk: 'Walk', run: 'Run', jump: 'Jump', fall: 'Fall', land: 'Land' }),
  sockets: Object.freeze({}),
});

export interface StandardEngineHandle {
  readonly runtime: EngineRuntime<EventMap>;
  readonly controller: FirstPersonController;
  readonly physics: AabbPhysicsProvider;
  /** Live gameplay settings shared with every component (reduced motion). */
  readonly settings: GameplaySettings;
  /** The camera rig, when a host view and a camera capability are present. */
  readonly camera: CameraRig | null;
  /** The avatar, when the adventure requests `character.avatar` (and it is enabled). */
  readonly avatar: AvatarController | null;
  dispose(): void;
}

function toInput(input: StandardInput | MovementInputSource): StandardInput {
  return typeof input === 'function' ? { poll: input } : input;
}

/**
 * Creates, starts and wires a standard engine. Rejects (and disposes) when the requests are
 * invalid. The returned runtime is `running`; the host drives it with `runtime.tick(seconds)`.
 */
export async function createStandardEngine(options: StandardEngineOptions): Promise<StandardEngineHandle> {
  const registry = options.registry ?? createStandardCapabilityRegistry();
  const runtime = createEngineRuntime<EventMap>({
    id: options.id,
    capabilities: registry,
    ...(options.timestep ? { timestep: options.timestep } : {}),
    ...(options.diagnostics ? { diagnostics: options.diagnostics } : {}),
  });

  // Services the capabilities read while installing.
  const physics = options.physics ?? createAabbPhysicsProvider();
  const settings: GameplaySettings = { reducedMotion: options.reducedMotion === true };
  runtime.services.provide(PhysicsProviderService, physics);
  runtime.services.provide(GameplaySettingsService, settings);
  if (options.requirements) {
    runtime.services.provide(RequirementCheckService, options.requirements);
  }
  if (options.claims) {
    runtime.services.provide(GameplayEventFactoryService, createGameplayEventFactory(options.claims.context, options.claims.options));
  }
  options.provide?.(runtime);

  let handle: StandardEngineHandle | null = null;
  await runtime.start(options.requests, async (rt) => {
    handle = wireStandardGameplay(rt, { ...options, physics, settings });
    await options.setup?.(handle);
  });
  if (!handle) {
    // A dispose during start wins (the runtime is already disposed).
    throw new Error(`Engine "${options.id}" was disposed while starting`);
  }
  return handle;
}

interface WireOptions extends StandardEngineOptions {
  physics: AabbPhysicsProvider;
  settings: GameplaySettings;
}

/** The wiring step, exported for hosts that start their own runtime on the standard registry. */
export function wireStandardGameplay(runtime: EngineRuntime<EventMap>, options: WireOptions): StandardEngineHandle {
  const { physics, settings } = options;
  const input = toInput(options.input);

  const locomotion = runtime.capabilityConfig<LocomotionConfiguration>(MOVEMENT_LOCOMOTION);
  const jump = runtime.capabilityConfig<JumpConfiguration>(MOVEMENT_JUMP);

  const checkpoints = runtime.services.get(CheckpointsService);
  const platforms = () => runtime.services.get(PlatformsService);
  const environmentSource = runtime.services.get(EnvironmentQueryService);
  const environment = environmentSource
    ? gateEnvironment(environmentSource, {
        features: installedMovementFeatures(runtime),
        reducedMotion: () => settings.reducedMotion,
        reducedMotionScale: reducedMotionScaleOf(runtime),
      })
    : undefined;
  const maxWalkableSlope = maxWalkableSlopeOf(runtime);

  // A hazard recovery names its target; the controller's recovery point reads it once.
  let pendingRecovery: HazardRecoveryRequest | null = null;
  let reportedRecovery: HazardRecoveryRequest | null = null;

  const start = options.startPosition ?? { x: 0, y: 0, z: 0 };
  const controller = new FirstPersonController({
    ...(locomotion ? { locomotion } : {}),
    // Jumping is a capability: off unless the adventure requests movement.jump.
    jump: jump ?? JUMP_DISABLED,
    colliders: physics.boxes,
    jumpableColliders: physics.jumpableBoxes,
    startPosition: new Vector3(start.x, start.y, start.z),
    ...(environment ? { environment } : {}),
    ...(maxWalkableSlope !== undefined ? { maxWalkableSlope } : {}),
    ...(options.groundHeightAt ? { groundHeightAt: options.groundHeightAt } : {}),
    ...(options.isInPlayableArea ? { isInPlayableArea: options.isInPlayableArea } : {}),
    // A moving, falling or appearing engine platform is never remembered as safe ground.
    isSafeGround: () => {
      const box = controller.supportingBox();
      if (!box) return true;
      const id = physics.idOfBox(box);
      return id === undefined || id === null || platforms()?.positionOf(id) === undefined;
    },
    recoveryPoint: () => {
      if (pendingRecovery) {
        const { position, yaw } = pendingRecovery;
        return { x: position.x, z: position.z, yaw };
      }
      const latest = checkpoints?.latest();
      return latest ? { x: latest.position.x, z: latest.position.z, yaw: latest.yaw } : null;
    },
  });
  if (options.startYaw !== undefined) {
    controller.yaw = options.startYaw;
  }

  const movement = installMovementSystem(runtime as never, {
    controller,
    input: () => input.poll(),
    physics,
    ...(checkpoints ? { checkpoints } : {}),
    recoveryDetails: () => {
      const detail = reportedRecovery;
      reportedRecovery = null;
      return detail ? { checkpointId: detail.checkpointId, hazardId: detail.hazardId } : null;
    },
  });
  runtime.resources.track(() => movement.dispose());

  // Hazards: recover now, report once (the movement system drains the controller's event).
  runtime.resources.track(
    onPresentation(runtime, 'HazardRecoveryRequested', (request) => {
      pendingRecovery = request;
      controller.recover('HAZARD');
      pendingRecovery = null;
      reportedRecovery = request;
    }),
  );

  // Platforms: carry the rider, keep their speed when they step off, bounce pads.
  let lastCarry: Vec3Like = { x: 0, y: 0, z: 0 };
  let lastSupport: string | null = null;
  const removeCarry = runtime.systems.add({
    id: 'engine.platformCarry',
    phase: 'simulation',
    // After the movement system (-100) and the platforms (-10): the platform has moved this step.
    order: 10,
    update({ dt }) {
      const api = platforms();
      if (!api) return;
      const launch = api.consumeLaunch();
      let moved = false;
      if (launch) {
        controller.launch(launch.height);
        moved = true;
      }
      const entity = runtime.world.bySemanticId(PLAYER_ENTITY_ID);
      const transform = entity === undefined ? undefined : runtime.world.get(entity, PlayerTransformComponent);
      const supportId = transform?.supportId ?? null;
      if (supportId) {
        const v = api.carryVelocityAt(supportId, controller.position.x, controller.position.z);
        if (v.x !== 0 || v.y !== 0 || v.z !== 0) {
          controller.carry(v.x * dt, v.y * dt, v.z * dt);
          moved = true;
        }
        lastCarry = v;
      } else if (lastSupport && !controller.grounded) {
        controller.inheritVelocity(lastCarry.x, lastCarry.z);
        lastCarry = { x: 0, y: 0, z: 0 };
      }
      lastSupport = supportId;
      // GE-L10: the transform shows the carried position in this same step, not the next.
      if (moved) movement.syncTransform();
    },
  });
  runtime.resources.track(removeCarry);

  // Focus lost: forget held input, so nothing keeps walking.
  runtime.resources.track(
    runtime.events.on(HOST_EVENTS.inputReset as never, (() => {
      input.reset?.();
      controller.clearJumpInput();
    }) as never),
  );

  // Camera: only with a host view and a camera capability.
  let camera: CameraRig | null = null;
  const view = runtime.services.get(HostViewService);
  const thirdPerson = runtime.capabilityConfig<ThirdPersonCameraConfig>(CAMERA_THIRD_PERSON);
  const firstPerson = runtime.capabilityConfig<FirstPersonCameraConfig>(CAMERA_FIRST_PERSON);
  if (view && (thirdPerson || firstPerson)) {
    const collision = runtime.capabilityConfig<CameraCollisionConfig>(CAMERA_COLLISION);
    camera = new CameraRig(
      cameraRigOptionsFromCapabilities(
        {
          ...(thirdPerson ? { thirdPerson } : {}),
          ...(firstPerson ? { firstPerson } : {}),
          ...(collision ? { collision } : {}),
        },
        { reducedMotion: settings.reducedMotion, physics },
      ),
    );
    const rig = camera;
    runtime.resources.track(
      runtime.systems.add(
        createCameraSystem({
          world: runtime.world,
          rig,
          onFrame: (frame) => applyCameraFrame(frame, view.camera as unknown as CameraLike),
        }),
      ),
    );
  }

  // Avatar and animation: only when requested. The avatar reads the canonical transform and
  // nothing else; the follow system (order 10) runs before the camera system (order 20).
  let avatar: AvatarController | null = null;
  const avatarConfig = runtime.capabilityConfig<AvatarCapabilityConfig>(CHARACTER_AVATAR);
  if (avatarConfig && avatarConfig.enabled) {
    const animationConfig = runtime.capabilityConfig<AnimationCapabilityConfig>(CHARACTER_ANIMATION);
    const base = { ...DEFAULT_AVATAR_DEFINITION, ...options.avatar?.definition };
    const definition: AvatarDefinition = {
      ...base,
      // A location costume (`assetKey`) wins over the child's own avatar asset.
      assetId: avatarConfig.assetKey ?? base.assetId,
      scale: avatarConfig.scale,
      rotationOffset: avatarConfig.rotationOffset,
    };
    const created = createAvatarController({
      definition,
      ...(options.avatar?.loader ? { loader: options.avatar.loader } : {}),
      yawConvention: 'controller',
      facing: avatarConfig.facing,
      animate: animationConfig !== undefined,
      ...(animationConfig ? { animationDefinition: animationDefinitionFromConfig(animationConfig) } : {}),
    });
    avatar = created;
    if (view) {
      view.scene.add(created.root);
    }
    const tuning = locomotion ?? DEFAULT_LOCOMOTION;
    // Removing the system disposes the avatar, which detaches its root from the scene.
    runtime.resources.track(
      runtime.systems.add(
        createAvatarFollowSystem({
          world: runtime.world,
          avatar: created,
          speeds: () => ({ walkSpeed: tuning.walkSpeed, runSpeed: tuning.runSpeed }),
        }),
      ),
    );
  }

  return {
    runtime,
    controller,
    physics,
    settings,
    camera,
    avatar,
    dispose: () => runtime.dispose(),
  };
}
