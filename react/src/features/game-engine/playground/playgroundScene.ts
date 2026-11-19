import {
  BoxGeometry,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
} from 'three';
import {
  createCapabilityRegistry,
  validationFailed,
  validationOk,
  type CapabilityDefinition,
  type CapabilityRegistry,
  type CapabilityRequest,
  type EngineRuntime,
  type EventMap,
} from '@lai/game-engine/core';
import {
  PLAYER_ENTITY_ID,
  PhysicsProviderService,
  PlayerTransformComponent,
  createPlayerTransform,
  type ColliderSpec,
  type PhysicsProvider,
  type RayHit,
  type Vec3Like,
} from '@lai/game-engine/contracts';
import { HostPreferencesService, HostViewService } from '../hostTypes';

/**
 * DEV ONLY test scene for the Playground. It uses only the core runtime and the contracts:
 * a ground plane, SOLID and JUMPABLE boxes, a gate and a ramp, plus a minimal in-memory
 * `PhysicsProvider` so the collision overlay has something to draw. It is not gameplay.
 */

export type PlaygroundAgeBand = 'SPROUT' | 'PATHFINDER' | 'EXPLORER';

/** Step height of the demo JUMPABLE blocks per age band: a small child gets lower steps. */
export const STEP_HEIGHT_BY_AGE_BAND: Readonly<Record<PlaygroundAgeBand, number>> = Object.freeze({
  SPROUT: 0.4,
  PATHFINDER: 0.6,
  EXPLORER: 0.8,
});

// --- in-memory physics provider (a fake, for the overlay only) -----------------------------

type Box = { min: Vec3Like; max: Vec3Like };

function rayBox(origin: Vec3Like, dir: Vec3Like, box: Box): number | null {
  let tMin = 0;
  let tMax = Number.POSITIVE_INFINITY;
  for (const axis of ['x', 'y', 'z'] as const) {
    const d = dir[axis];
    if (Math.abs(d) < 1e-9) {
      if (origin[axis] < box.min[axis] || origin[axis] > box.max[axis]) {
        return null;
      }
      continue;
    }
    const t1 = (box.min[axis] - origin[axis]) / d;
    const t2 = (box.max[axis] - origin[axis]) / d;
    tMin = Math.max(tMin, Math.min(t1, t2));
    tMax = Math.min(tMax, Math.max(t1, t2));
    if (tMin > tMax) {
      return null;
    }
  }
  return tMin;
}

export function createInMemoryPhysicsProvider(id = 'playground.physics'): PhysicsProvider {
  const specs = new Map<string, ColliderSpec>();
  const listeners = new Set<() => void>();
  const notify = () => [...listeners].forEach((listener) => listener());
  return {
    id,
    addCollider(spec) {
      specs.set(spec.id, spec);
      notify();
    },
    updateCollider(colliderId, min, max) {
      const current = specs.get(colliderId);
      if (current) {
        specs.set(colliderId, { ...current, min, max });
        notify();
      }
    },
    removeCollider(colliderId) {
      const removed = specs.delete(colliderId);
      if (removed) {
        notify();
      }
      return removed;
    },
    hasCollider: (colliderId) => specs.has(colliderId),
    getCollider: (colliderId) => specs.get(colliderId),
    colliders: () => [...specs.values()],
    raycast(origin, direction, maxDistance, filter) {
      let best: RayHit | null = null;
      for (const spec of specs.values()) {
        if (filter && !filter(spec)) {
          continue;
        }
        const t = rayBox(origin, direction, spec);
        if (t !== null && t <= maxDistance && (!best || t < best.distance)) {
          best = {
            colliderId: spec.id,
            distance: t,
            point: { x: origin.x + direction.x * t, y: origin.y + direction.y * t, z: origin.z + direction.z * t },
          };
        }
      }
      return best;
    },
    overlaps(min, max) {
      return [...specs.values()]
        .filter(
          (s) =>
            s.min.x < max.x && s.max.x > min.x && s.min.y < max.y && s.max.y > min.y && s.min.z < max.z && s.max.z > min.z,
        )
        .map((s) => s.id);
    },
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

// --- the demo scene capability -------------------------------------------------------------

export interface DemoSceneConfig {
  ageBand: PlaygroundAgeBand;
}

export const DEMO_SCENE_CAPABILITY_ID = 'playground.demoScene';

const AGE_BANDS: readonly PlaygroundAgeBand[] = ['SPROUT', 'PATHFINDER', 'EXPLORER'];

export const demoSceneCapability: CapabilityDefinition<DemoSceneConfig, EngineRuntime<EventMap>> = {
  id: DEMO_SCENE_CAPABILITY_ID,
  version: '0.1.0',
  description: 'Playground test scene: ground, SOLID and JUMPABLE boxes, a gate and a ramp.',
  defaults: { ageBand: 'PATHFINDER' },
  validate(input) {
    const value = (input ?? {}) as Partial<DemoSceneConfig>;
    const ageBand = value.ageBand ?? 'PATHFINDER';
    if (!AGE_BANDS.includes(ageBand)) {
      return validationFailed([{ path: 'ageBand', message: `must be one of ${AGE_BANDS.join(', ')}` }]);
    }
    return validationOk({ ageBand });
  },
  install(runtime, config) {
    const view = runtime.services.require(HostViewService);
    const preferences = runtime.services.get(HostPreferencesService);
    const scope = runtime.resources.child('playground.demoScene');
    const provider = createInMemoryPhysicsProvider();
    runtime.services.provide(PhysicsProviderService, provider);

    const group = new Group();
    group.name = 'playground.demoScene';
    view.scene.background = new Color(0x9fd3f0);
    const hemi = new HemisphereLight(0xffffff, 0x4a6b3a, 1.1);
    const sun = new DirectionalLight(0xffffff, 1.4);
    sun.position.set(6, 12, 4);
    group.add(hemi, sun);

    const addBox = (id: string, kind: ColliderSpec['kind'], min: Vec3Like, max: Vec3Like, color: number, gate = false) => {
      const geometry = scope.track(new BoxGeometry(max.x - min.x, max.y - min.y, max.z - min.z));
      const material = scope.track(new MeshStandardMaterial({ color, transparent: gate, opacity: gate ? 0.6 : 1 }));
      const mesh = new Mesh(geometry, material);
      mesh.name = id;
      mesh.position.set((min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2);
      group.add(mesh);
      provider.addCollider({ id, kind, min, max, ...(gate ? { gate: true } : {}) });
      return mesh;
    };

    const ground = new Mesh(
      scope.track(new PlaneGeometry(40, 40)),
      scope.track(new MeshStandardMaterial({ color: 0x6fae5a })),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.name = 'ground';
    group.add(ground);

    const step = STEP_HEIGHT_BY_AGE_BAND[config.ageBand];
    addBox('wall.solid.1', 'SOLID', { x: -4, y: 0, z: -3 }, { x: -2, y: 2, z: -2.5 }, 0xb0b8c0);
    addBox('crate.solid.2', 'SOLID', { x: 2, y: 0, z: -4 }, { x: 3.5, y: 1.2, z: -2.5 }, 0xa57c52);
    addBox('step.jumpable.1', 'JUMPABLE', { x: 0, y: 0, z: -2 }, { x: 1.5, y: step, z: -0.5 }, 0xffb84d);
    addBox('step.jumpable.2', 'JUMPABLE', { x: 1.5, y: 0, z: -2 }, { x: 3, y: step * 2, z: -0.5 }, 0xffa31a);
    addBox('gate.1', 'SOLID', { x: -1, y: 0, z: 3 }, { x: 1, y: 2.2, z: 3.2 }, 0xffd84d, true);
    addBox('zone.trigger.1', 'TRIGGER', { x: -3, y: 0, z: 1 }, { x: -1.5, y: 1.5, z: 2.5 }, 0x4da6ff);

    // A ramp: drawn tilted, collided as its bounding box (the overlay shows the AABB).
    const rampBox = { min: { x: 3, y: 0, z: 0.5 }, max: { x: 5, y: 1, z: 3.5 } };
    const ramp = new Mesh(
      scope.track(new BoxGeometry(2, 0.2, 3.2)),
      scope.track(new MeshStandardMaterial({ color: 0xc98bd6 })),
    );
    ramp.name = 'ramp.jumpable.1';
    ramp.position.set(4, 0.5, 2);
    ramp.rotation.x = Math.atan2(1, 3);
    group.add(ramp);
    provider.addCollider({ id: 'ramp.jumpable.1', kind: 'JUMPABLE', ...rampBox });

    view.scene.add(group);

    // Camera: a fixed three-quarter view, with a slow orbit unless reduced motion is on.
    const camera = view.camera;
    if (camera instanceof PerspectiveCamera) {
      camera.position.set(9, 8, 11);
      camera.lookAt(0, 0.5, 0);
    }

    // A moving marker entity gives the player gizmo a canonical transform to follow.
    const entity = runtime.world.create(PLAYER_ENTITY_ID);
    runtime.world.add(entity, PlayerTransformComponent, createPlayerTransform({ x: 0, y: 0, z: 2 }));
    const marker = new Mesh(
      scope.track(new BoxGeometry(0.5, 1.2, 0.5)),
      scope.track(new MeshStandardMaterial({ color: 0xff6b6b })),
    );
    marker.name = 'playground.marker';
    group.add(marker);
    const remove = runtime.systems.add({
      id: 'playground.demoScene.motion',
      phase: 'presentation',
      update: ({ time }) => {
        const still = preferences?.reducedMotion ?? false;
        const t = still ? 0 : time * 0.6;
        const position = { x: Math.cos(t) * 2, y: 0, z: 2 + Math.sin(t) * 1.5 };
        const previous = runtime.world.get(entity, PlayerTransformComponent) ?? createPlayerTransform(position);
        runtime.world.set(entity, PlayerTransformComponent, {
          ...previous,
          previousPosition: previous.position,
          position,
          yaw: -t,
        });
        marker.position.set(position.x, 0.6, position.z);
        if (!still && camera instanceof PerspectiveCamera) {
          const angle = time * 0.1;
          camera.position.set(Math.sin(angle) * 12, 8, Math.cos(angle) * 12);
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

// --- integration points --------------------------------------------------------------------

export interface PlaygroundCapabilityOption {
  id: string;
  label: string;
  description: string;
  defaultEnabled: boolean;
  /** Builds the capability request for the chosen age band. */
  toRequest(ageBand: PlaygroundAgeBand): CapabilityRequest;
}

/**
 * INTEGRATION POINT. The Playground lists these in its controls panel. After the movement,
 * camera and component branches merge, add their entries here (e.g. `movement.jump`,
 * `camera.thirdPerson`), and register their definitions in `PLAYGROUND_CAPABILITY_DEFINITIONS`
 * below. Each entry's `toRequest` returns the `{ id, config }` the runtime installs.
 */
export const PLAYGROUND_CAPABILITIES: readonly PlaygroundCapabilityOption[] = Object.freeze([
  {
    id: DEMO_SCENE_CAPABILITY_ID,
    label: 'Demo scene',
    description: 'Ground, boxes, gate and ramp with an in-memory collision provider.',
    defaultEnabled: true,
    toRequest: (ageBand) => ({ id: DEMO_SCENE_CAPABILITY_ID, config: { ageBand } }),
  },
  // INTEGRATION POINT: movement.jump, camera.thirdPerson, ... go here after merge.
]);

/** INTEGRATION POINT: capability definitions the Playground's registry must know. */
export const PLAYGROUND_CAPABILITY_DEFINITIONS: readonly CapabilityDefinition<never, EngineRuntime<EventMap>>[] = [
  demoSceneCapability as unknown as CapabilityDefinition<never, EngineRuntime<EventMap>>,
];

export function createPlaygroundRegistry(): CapabilityRegistry<EngineRuntime<EventMap>> {
  const registry = createCapabilityRegistry<EngineRuntime<EventMap>>();
  for (const definition of PLAYGROUND_CAPABILITY_DEFINITIONS) {
    registry.register(definition);
  }
  return registry;
}
