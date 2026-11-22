import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
} from 'three';
import {
  validationFailed,
  validationOk,
  type CapabilityDefinition,
  type CapabilityRequest,
  type EngineRuntime,
  type EventMap,
} from '@lai/game-engine/core';
import {
  PLAYER_ENTITY_ID,
  PhysicsProviderService,
  PlayerTransformComponent,
  createGameplayEventFactory,
  interpolatePlayerPosition,
  type ColliderSpec,
  type Vec3Like,
} from '@lai/game-engine/contracts';
import {
  CollectiblesService,
  GameplayEventFactoryService,
  GameplaySettingsService,
  PlatformsService,
  type GameplaySettings,
} from '@lai/game-engine/components';
import { createAabbPhysicsProvider, type AabbPhysicsProvider } from '@lai/game-engine/physics';
import { resolveProfile } from '@lai/game-engine/sdk';
import {
  createStandardCapabilityRegistry,
  wireStandardGameplay,
  type StandardCapabilityRegistry,
  type StandardEngineHandle,
  type StandardInput,
} from '@lai/game-engine/engine';
import type { MovementInputFrame } from '@lai/game-engine/movement';
import { HostPreferencesService, HostViewService, type HostView } from '../hostTypes';

/**
 * DEV ONLY test scene for the Playground. It runs the real engine: the standard capability
 * registry, the AABB physics provider, the shared movement controller and the gameplay
 * components, on a small authored layout (a jumpable crate and steps, a gate, a ramp, an ice
 * patch, one collectible, a checkpoint beside a pond, and a moving ferry on an optional route).
 * It is not child-facing content and touches no child data, API or AI.
 */

export type PlaygroundAgeBand = 'SPROUT' | 'PATHFINDER' | 'EXPLORER';

/** Step height of the demo JUMPABLE blocks per age band: a small child gets lower steps. */
export const STEP_HEIGHT_BY_AGE_BAND: Readonly<Record<PlaygroundAgeBand, number>> = Object.freeze({
  SPROUT: 0.4,
  PATHFINDER: 0.6,
  EXPLORER: 0.8,
});

// --- the authored demo layout --------------------------------------------------------------

const POND = { minX: -6, maxX: -3, minZ: 4, maxZ: 8 } as const;
const ICE = { min: { x: 5, y: -0.5, z: -6 }, max: { x: 10, y: 0.5, z: -2 } } as const;
const FERRY = { position: { x: -8, y: 0, z: -4 }, size: { x: 2, y: 0.5, z: 2 } } as const;
const COIN = { x: 6, y: 0.5, z: 2 } as const;
const DOCK = { x: -2, y: 0, z: 6 } as const;

// --- the demo scene capability -------------------------------------------------------------

export interface DemoSceneConfig {
  ageBand: PlaygroundAgeBand;
}

export const DEMO_SCENE_CAPABILITY_ID = 'playground.demoScene';

const AGE_BANDS: readonly PlaygroundAgeBand[] = ['SPROUT', 'PATHFINDER', 'EXPLORER'];

export const demoSceneCapability: CapabilityDefinition<DemoSceneConfig, EngineRuntime<EventMap>> = {
  id: DEMO_SCENE_CAPABILITY_ID,
  version: '0.2.0',
  description: 'Playground layout: ground, crate, steps, gate, ramp, pond, ice patch, coin, ferry.',
  defaults: { ageBand: 'PATHFINDER' },
  validate(input) {
    const value = (input ?? {}) as Partial<DemoSceneConfig>;
    const ageBand = value.ageBand ?? 'PATHFINDER';
    if (!AGE_BANDS.includes(ageBand)) {
      return validationFailed([
        { path: 'ageBand', message: `must be one of ${AGE_BANDS.join(', ')}` },
      ]);
    }
    return validationOk({ ageBand });
  },
  install(runtime, config) {
    const view = runtime.services.require(HostViewService);
    const preferences = runtime.services.get(HostPreferencesService);
    const provider = runtime.services.require(PhysicsProviderService);
    const scope = runtime.resources.child('playground.demoScene');

    const group = new Group();
    group.name = 'playground.demoScene';
    view.scene.background = new Color(0x9fd3f0);
    const hemi = new HemisphereLight(0xffffff, 0x4a6b3a, 1.1);
    const sun = new DirectionalLight(0xffffff, 1.4);
    sun.position.set(6, 12, 4);
    group.add(hemi, sun);

    const material = (color: number, opacity = 1) =>
      scope.track(new MeshStandardMaterial({ color, transparent: opacity < 1, opacity }));
    const addBox = (
      id: string,
      kind: ColliderSpec['kind'],
      min: Vec3Like,
      max: Vec3Like,
      color: number,
      gate = false,
    ) => {
      const mesh = new Mesh(
        scope.track(new BoxGeometry(max.x - min.x, max.y - min.y, max.z - min.z)),
        material(color, gate ? 0.6 : 1),
      );
      mesh.name = id;
      mesh.position.set((min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2);
      group.add(mesh);
      provider.addCollider({ id, kind, min, max, ...(gate ? { gate: true } : {}) });
      return mesh;
    };
    const addPatch = (
      name: string,
      minX: number,
      maxX: number,
      minZ: number,
      maxZ: number,
      color: number,
      y = 0.01,
    ) => {
      const mesh = new Mesh(
        scope.track(new PlaneGeometry(maxX - minX, maxZ - minZ)),
        material(color, 0.85),
      );
      mesh.name = name;
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set((minX + maxX) / 2, y, (minZ + maxZ) / 2);
      group.add(mesh);
    };

    const ground = new Mesh(scope.track(new PlaneGeometry(40, 40)), material(0x6fae5a));
    ground.rotation.x = -Math.PI / 2;
    ground.name = 'ground';
    group.add(ground);

    const step = STEP_HEIGHT_BY_AGE_BAND[config.ageBand];
    addBox('wall.solid.1', 'SOLID', { x: -4, y: 0, z: -3 }, { x: -2, y: 2, z: -2.5 }, 0xb0b8c0);
    addBox(
      'crate.jumpable.1',
      'JUMPABLE',
      { x: 2, y: 0, z: -4 },
      { x: 3.5, y: 0.5, z: -2.5 },
      0xa57c52,
    );
    addBox(
      'step.jumpable.1',
      'JUMPABLE',
      { x: 0, y: 0, z: -2 },
      { x: 1.5, y: step, z: -0.5 },
      0xffb84d,
    );
    addBox(
      'step.jumpable.2',
      'JUMPABLE',
      { x: 1.5, y: 0, z: -2 },
      { x: 3, y: step * 2, z: -0.5 },
      0xffa31a,
    );
    addBox('gate.1', 'SOLID', { x: -1, y: 0, z: 3 }, { x: 1, y: 2.2, z: 3.2 }, 0xffd84d, true);
    addBox(
      'zone.trigger.1',
      'TRIGGER',
      { x: -3, y: 0, z: 1 },
      { x: -1.5, y: 1.5, z: 2.5 },
      0x4da6ff,
    );

    // A ramp: drawn tilted, collided as a low jumpable step (the overlay shows the box).
    const ramp = new Mesh(scope.track(new BoxGeometry(2, 0.2, 3.2)), material(0xc98bd6));
    ramp.name = 'ramp.jumpable.1';
    ramp.position.set(4, 0.12, 2);
    ramp.rotation.x = Math.atan2(0.25, 3);
    group.add(ramp);
    provider.addCollider({
      id: 'ramp.jumpable.1',
      kind: 'JUMPABLE',
      min: { x: 3, y: 0, z: 0.5 },
      max: { x: 5, y: 0.25, z: 3.5 },
    });

    addPatch('pond', POND.minX, POND.maxX, POND.minZ, POND.maxZ, 0x3a7bd5);
    addPatch('ice', ICE.min.x, ICE.max.x, ICE.min.z, ICE.max.z, 0xe8f6ff);

    const flag = new Mesh(scope.track(new CylinderGeometry(0.05, 0.05, 1.6)), material(0xffffff));
    flag.name = 'checkpoint.dock';
    flag.position.set(DOCK.x, 0.8, DOCK.z);
    group.add(flag);

    const coin = new Mesh(
      scope.track(new CylinderGeometry(0.35, 0.35, 0.08, 20)),
      material(0xffcf33),
    );
    coin.name = 'collectible.coin';
    coin.rotation.x = Math.PI / 2;
    coin.position.set(COIN.x, COIN.y + 0.4, COIN.z);
    group.add(coin);

    const ferry = new Mesh(
      scope.track(new BoxGeometry(FERRY.size.x, FERRY.size.y, FERRY.size.z)),
      material(0x8b5a2b),
    );
    ferry.name = 'platform.ferry';
    ferry.position.set(FERRY.position.x, FERRY.size.y / 2, FERRY.position.z);
    group.add(ferry);

    const avatar = new Mesh(scope.track(new BoxGeometry(0.5, 1.2, 0.5)), material(0xff6b6b));
    avatar.name = 'playground.avatar';
    avatar.visible = false;
    group.add(avatar);

    view.scene.add(group);

    const camera = view.camera;
    if (camera instanceof PerspectiveCamera) {
      camera.position.set(9, 8, 11);
      camera.lookAt(0, 0.5, 0);
    }

    const remove = runtime.systems.add({
      id: 'playground.demoScene.presentation',
      phase: 'presentation',
      order: 5,
      update: ({ alpha, time }) => {
        // The avatar mirrors the canonical transform; it never moves on its own.
        const entity = runtime.world.bySemanticId(PLAYER_ENTITY_ID);
        const transform =
          entity === undefined ? undefined : runtime.world.get(entity, PlayerTransformComponent);
        // The stand-in box only when the engine avatar (character.avatar) is off.
        avatar.visible = transform !== undefined && !runtime.installed.has('character.avatar');
        if (transform) {
          const p = interpolatePlayerPosition(transform, alpha);
          avatar.position.set(p.x, p.y + 0.6, p.z);
          avatar.rotation.y = transform.yaw;
        }
        const platforms = runtime.services.get(PlatformsService);
        const top = platforms?.positionOf('ferry');
        if (top) {
          ferry.position.set(top.x, top.y - FERRY.size.y / 2, top.z);
        }
        const collectibles = runtime.services.get(CollectiblesService);
        coin.visible = !(collectibles?.isCollected('coin-1') ?? false);
        // Without a camera capability, a slow orbit (none under reduced motion).
        const hasCamera = [...runtime.installed.keys()].some((id) => id.startsWith('camera.'));
        if (
          !hasCamera &&
          !(preferences?.reducedMotion ?? false) &&
          camera instanceof PerspectiveCamera
        ) {
          const angle = time * 0.1;
          camera.position.set(Math.sin(angle) * 14, 9, Math.cos(angle) * 14);
          camera.lookAt(0, 0.5, 0);
        }
      },
    });

    return () => {
      remove();
      view.scene.remove(group);
      scope.dispose();
    };
  },
};

// --- keyboard input (dev only) -------------------------------------------------------------

/**
 * A minimal keyboard source: W A S D or arrows move, Space jumps (one per press), Shift
 * sprints. The shipped worlds use the shared pointer and gamepad input; this keeps the
 * Playground free of the island-map runtime.
 */
export function createKeyboardInput(
  target: EventTarget = window,
): StandardInput & { reset(): void; dispose(): void } {
  const held = new Set<string>();
  let jumpQueued = false;
  const down = (raw: Event) => {
    const event = raw as KeyboardEvent;
    if (
      event.target instanceof HTMLElement &&
      /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)
    )
      return;
    if (event.code === 'Space') {
      if (!event.repeat) jumpQueued = true;
      event.preventDefault();
    }
    held.add(event.code);
  };
  const up = (raw: Event) => {
    held.delete((raw as KeyboardEvent).code);
  };
  target.addEventListener('keydown', down);
  target.addEventListener('keyup', up);
  const axis = (positive: string[], negative: string[]) =>
    (positive.some((k) => held.has(k)) ? 1 : 0) - (negative.some((k) => held.has(k)) ? 1 : 0);
  return {
    poll(): MovementInputFrame {
      const frame: MovementInputFrame = {
        move: {
          forward: axis(['KeyW', 'ArrowUp'], ['KeyS', 'ArrowDown']),
          strafe: axis(['KeyD', 'ArrowRight'], ['KeyA', 'ArrowLeft']),
          sprint: held.has('ShiftLeft') || held.has('ShiftRight'),
        },
        jumpPressed: jumpQueued,
      };
      jumpQueued = false;
      return frame;
    },
    reset() {
      held.clear();
      jumpQueued = false;
    },
    dispose() {
      target.removeEventListener('keydown', down);
      target.removeEventListener('keyup', up);
    },
  };
}

// --- capability options --------------------------------------------------------------------

export interface PlaygroundCapabilityOption {
  id: string;
  label: string;
  description: string;
  defaultEnabled: boolean;
  /** Builds the capability request for the chosen age band. */
  toRequest(ageBand: PlaygroundAgeBand): CapabilityRequest;
}

/** The Playground's controls: each entry is one capability request the runtime installs. */
export const PLAYGROUND_CAPABILITIES: readonly PlaygroundCapabilityOption[] = Object.freeze([
  {
    id: DEMO_SCENE_CAPABILITY_ID,
    label: 'Demo scene',
    description: 'Ground, crate, steps, gate, ramp, pond, ice, coin and ferry.',
    defaultEnabled: true,
    toRequest: (ageBand) => ({ id: DEMO_SCENE_CAPABILITY_ID, config: { ageBand } }),
  },
  {
    id: 'movement.locomotion',
    label: 'Walk, run, sprint',
    description: 'The shared controller, at the age band walking speed.',
    defaultEnabled: true,
    toRequest: (ageBand) => ({
      id: 'movement.locomotion',
      config: { walkSpeed: resolveProfile(ageBand).movement.walkSpeed },
    }),
  },
  {
    id: 'movement.jump',
    label: 'Jumping',
    description: 'A standard capability; tuned per age band from the SDK profile.',
    defaultEnabled: true,
    toRequest: (ageBand) => ({
      id: 'movement.jump',
      config: { ...resolveProfile(ageBand).movement.jump },
    }),
  },
  {
    id: 'camera.thirdPerson',
    label: 'Third-person camera',
    description: 'Follows the canonical transform; boom collision through the physics provider.',
    defaultEnabled: true,
    toRequest: () => ({ id: 'camera.thirdPerson' }),
  },
  {
    id: 'camera.collision',
    label: 'Camera collision',
    description: 'Keeps the camera out of walls.',
    defaultEnabled: true,
    toRequest: () => ({ id: 'camera.collision' }),
  },
  {
    id: 'character.avatar',
    label: 'Avatar',
    description:
      'The child avatar (placeholder capsule here), placed only from the canonical transform.',
    defaultEnabled: true,
    toRequest: () => ({ id: 'character.avatar' }),
  },
  {
    id: 'character.animation',
    label: 'Avatar animation',
    description:
      'Clips from movement state and achieved speed (needs a loaded model; the placeholder has none).',
    defaultEnabled: true,
    toRequest: () => ({ id: 'character.animation' }),
  },
  {
    id: 'gameplay.checkpoints',
    label: 'Checkpoint',
    description: 'The old dock beside the pond.',
    defaultEnabled: true,
    toRequest: () => ({
      id: 'gameplay.checkpoints',
      config: {
        checkpoints: [
          {
            id: 'dock',
            courseId: 'playground-course',
            position: DOCK,
            yaw: 0,
            label: 'the old dock',
          },
        ],
      },
    }),
  },
  {
    id: 'gameplay.hazards',
    label: 'Pond hazard',
    description: 'Walking into the pond goes back to the dock. Nothing is lost.',
    defaultEnabled: true,
    toRequest: () => ({
      id: 'gameplay.hazards',
      config: {
        hazards: [
          {
            id: 'pond',
            kind: 'WATER',
            rect: POND,
            checkpointId: 'dock',
            messageKey: 'hazard.water.splash',
          },
        ],
      },
    }),
  },
  {
    id: 'gameplay.collectibles',
    label: 'Coin',
    description: 'One optional collectible on the ramp.',
    defaultEnabled: true,
    toRequest: () => ({
      id: 'gameplay.collectibles',
      config: { collectibles: [{ id: 'coin-1', position: COIN }] },
    }),
  },
  {
    id: 'gameplay.platforms',
    label: 'Ferry',
    description: 'A moving platform on an optional route.',
    defaultEnabled: true,
    toRequest: (ageBand) => ({
      id: 'gameplay.platforms',
      config: {
        platforms: [
          {
            id: 'ferry',
            position: FERRY.position,
            size: FERRY.size,
            route: 'OPTIONAL',
            moving: {
              path: [
                { x: 0, y: 0, z: 0 },
                { x: 0, y: 0, z: 6 },
              ],
              mode: 'PING_PONG',
              speed: ageBand === 'SPROUT' ? 0.4 : 0.8,
              pauseSeconds: 1.5,
            },
          },
        ],
      },
    }),
  },
  {
    id: 'movement.surfaces',
    label: 'Surface friction',
    description: 'Lets the ice patch change grip.',
    defaultEnabled: true,
    toRequest: () => ({ id: 'movement.surfaces' }),
  },
  {
    id: 'environment.volumes',
    label: 'Ice patch',
    description: 'A slippery volume; the child slides but always stops within a metre.',
    defaultEnabled: true,
    toRequest: () => ({
      id: 'environment.volumes',
      config: { surfaces: [{ id: 'ice-patch', surfaceId: 'ice', box: ICE }] },
    }),
  },
]);

/** The Playground's registry: the standard engine registry plus the demo scene. */
export function createPlaygroundRegistry(): StandardCapabilityRegistry {
  const registry = createStandardCapabilityRegistry();
  registry.register(demoSceneCapability);
  return registry;
}

export interface PlaygroundServices {
  physics: AabbPhysicsProvider;
  settings: GameplaySettings;
}

/** Provides the services the capabilities need before they install. */
export function providePlaygroundServices(runtime: EngineRuntime<EventMap>): PlaygroundServices {
  const physics = createAabbPhysicsProvider();
  const settings: GameplaySettings = { reducedMotion: false };
  runtime.services.provide(PhysicsProviderService, physics);
  runtime.services.provide(GameplaySettingsService, settings);
  runtime.services.provide(
    GameplayEventFactoryService,
    createGameplayEventFactory({
      realmId: 'realm.playground',
      adventureId: 'adventure.playground',
      areaId: 'area.playground',
      sessionRef: null,
    }),
  );
  return { physics, settings };
}

/**
 * Wires movement, platform carry, hazard recovery and the camera after the capabilities have
 * installed (the standard engine's wiring step). Returns null when locomotion is off.
 */
export function wirePlayground(
  runtime: EngineRuntime<EventMap>,
  services: PlaygroundServices,
  input: StandardInput,
  view: HostView,
): StandardEngineHandle | null {
  const preferences = runtime.services.get(HostPreferencesService);
  services.settings.reducedMotion = preferences?.reducedMotion ?? false;
  if (!runtime.installed.has('movement.locomotion')) {
    return null;
  }
  void view;
  return wireStandardGameplay(runtime, {
    id: runtime.id,
    requests: [],
    input,
    physics: services.physics,
    settings: services.settings,
    startPosition: { x: 0, y: 0, z: 6 },
    startYaw: Math.PI,
  });
}
