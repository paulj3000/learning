/**
 * Test harness for the gameplay components: a runtime with a player, an in-memory
 * `PhysicsProvider`, a gameplay-event factory with a counter id and a step helper. It imports
 * no test framework, so the boundary guard treats it as ordinary engine code.
 */

import { createGameplayEventFactory, validateGameplayEvent, type AnyGameplayEvent } from '../contracts/gameplayEvents';
import { PhysicsProviderService, type ColliderSpec, type PhysicsProvider, type RayHit } from '../contracts/physics';
import { createPlayerTransform, PLAYER_ENTITY_ID, PlayerTransformComponent, type Vec3Like } from '../contracts/player';
import { createCapabilityRegistry, type CapabilityRegistry, type CapabilityRequest } from '../core/capabilities';
import type { EventMap } from '../core/eventBus';
import { createEngineRuntime, type EngineRuntime } from '../core/runtime';
import { GameplayEventFactoryService, GameplaySettingsService, type GameplaySettings } from './common';

export function createFakePhysics(): PhysicsProvider & { log: string[] } {
  const colliders = new Map<string, ColliderSpec>();
  const listeners = new Set<() => void>();
  const log: string[] = [];
  const changed = () => listeners.forEach((l) => l());
  return {
    id: 'test.fake',
    log,
    addCollider(spec) {
      if (colliders.has(spec.id)) {
        throw new Error(`duplicate collider ${spec.id}`);
      }
      if (spec.gate && spec.kind === 'JUMPABLE') {
        throw new Error('gate colliders are never jumpable');
      }
      colliders.set(spec.id, spec);
      log.push(`add:${spec.id}`);
      changed();
    },
    updateCollider(id, min, max) {
      const spec = colliders.get(id);
      if (!spec) {
        throw new Error(`unknown collider ${id}`);
      }
      colliders.set(id, { ...spec, min: { ...min }, max: { ...max } });
      changed();
    },
    removeCollider(id) {
      log.push(`remove:${id}`);
      const had = colliders.delete(id);
      if (had) {
        changed();
      }
      return had;
    },
    hasCollider: (id) => colliders.has(id),
    getCollider: (id) => colliders.get(id),
    colliders: () => [...colliders.values()],
    raycast: (): RayHit | null => null,
    overlaps(min, max) {
      return [...colliders.values()]
        .filter((c) => c.min.x <= max.x && c.max.x >= min.x && c.min.y <= max.y && c.max.y >= min.y && c.min.z <= max.z && c.max.z >= min.z)
        .map((c) => c.id);
    },
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export interface Harness {
  runtime: EngineRuntime<EventMap>;
  physics: ReturnType<typeof createFakePhysics>;
  settings: GameplaySettings;
  claims: AnyGameplayEvent[];
  /** Every presentation event name and payload, in order. */
  events: { name: string; payload: unknown }[];
  registry: CapabilityRegistry<EngineRuntime<EventMap>>;
  /** Starts the runtime with the requested capabilities. */
  start(requests: readonly CapabilityRequest[]): Promise<void>;
  /** Moves the player (feet position), grounded on `supportId` optionally. */
  setPlayer(position: Vec3Like, supportId?: string | null): void;
  /** Advances `seconds` of simulated time in 1/60 s steps. */
  advance(seconds: number): void;
  eventsNamed(name: string): unknown[];
  claimsOfType(type: string): AnyGameplayEvent[];
  dispose(): void;
}

const STEP = 1 / 60;

export function createHarness(register: (registry: CapabilityRegistry<EngineRuntime<EventMap>>) => void): Harness {
  const registry = createCapabilityRegistry<EngineRuntime<EventMap>>();
  register(registry);
  const runtime = createEngineRuntime<EventMap>({ id: 'test.area', capabilities: registry });
  const physics = createFakePhysics();
  const settings: GameplaySettings = { reducedMotion: false };
  let counter = 0;
  runtime.services.provide(PhysicsProviderService, physics);
  runtime.services.provide(GameplaySettingsService, settings);
  runtime.services.provide(
    GameplayEventFactoryService,
    createGameplayEventFactory(
      { realmId: 'realm.test', adventureId: 'adventure.test', areaId: 'area.test', sessionRef: null },
      { newEventId: () => `evt-${String((counter += 1)).padStart(8, '0')}`, now: () => Date.UTC(2026, 10, 18) },
    ),
  );
  const player = runtime.world.create(PLAYER_ENTITY_ID);
  runtime.world.add(player, PlayerTransformComponent, createPlayerTransform({ x: 100, y: 0, z: 100 }));
  const claims: AnyGameplayEvent[] = [];
  const events: { name: string; payload: unknown }[] = [];
  runtime.events.onAny((name, payload) => {
    if (name === 'gameplay.event') {
      const result = validateGameplayEvent(payload);
      if (!result.ok) {
        throw new Error(`invalid claim emitted: ${JSON.stringify(result.issues)}`);
      }
      claims.push(payload as AnyGameplayEvent);
    } else {
      events.push({ name, payload });
    }
  });
  let step = 0;
  return {
    runtime,
    physics,
    settings,
    claims,
    events,
    registry,
    start: (requests) => runtime.start(requests),
    setPlayer(position, supportId = null) {
      runtime.world.set(player, PlayerTransformComponent, {
        ...createPlayerTransform(position),
        previousPosition: { ...position },
        supportId,
      });
    },
    advance(seconds) {
      const steps = Math.round(seconds / STEP);
      for (let i = 0; i < steps; i += 1) {
        step += 1;
        const time = step * STEP;
        runtime.systems.runStep({ dt: STEP, step, time });
        runtime.systems.runFrame({ frameSeconds: STEP, alpha: 1, time });
      }
    },
    eventsNamed: (name) => events.filter((e) => e.name === name).map((e) => e.payload),
    claimsOfType: (type) => claims.filter((c) => c.type === type),
    dispose: () => runtime.dispose(),
  };
}
