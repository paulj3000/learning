import { Box3 } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CheckpointsService,
  validateGameplayEvent,
  type AnyGameplayEvent,
  type EnvironmentQuery,
} from '@lai/game-engine';
import type { JsonValue } from '../../island-map/three/runtime/locationManifest';
import {
  currentClaimsBinding,
  forwardClaim,
  resetLocationClaimsForTests,
  setDefaultLocationClaimsBinding,
  setLocationClaimSink,
  setLocationClaimsBinding,
} from '../../island-map/three/runtime/gameplayClaimSink';
import { WorldEngineEventBus } from '../../island-map/three/worldEngineEvents';
import type { BridgePlayerState, LocationBridgeHost } from '../bridge/bridgeHost';
import { mountEngineBridge, type ClaimsBinding } from '../bridge/engineBridge';

/**
 * Wave 2 stabilization, areas 1, 6, 8 and 9 (bridge side): disposal of the engine bridge, resume
 * and setSignals ordering, recovery to the latest checkpoint, no claims or toasts on resume, the
 * lazy and default claim bindings (gameplayClaimSink), and claim uniqueness through the bridge.
 */

function fakeHost(config: { [key: string]: JsonValue }) {
  const bus = new WorldEngineEventBus();
  const frames = new Set<(dt: number) => void>();
  const colliders = new Map<string, { box: Box3 }>();
  const environmentCalls: (EnvironmentQuery | null)[] = [];
  const teleports: { x: number; z: number; yaw: number }[] = [];
  const player: BridgePlayerState = {
    position: { x: 0, y: 0, z: 0 },
    yaw: 0,
    velocity: { x: 0, y: 0, z: 0 },
    grounded: true,
    supportId: null,
  };
  const host: LocationBridgeHost = {
    bus,
    config,
    reducedMotion: false,
    addCollider(box, options = {}) {
      const id = options.id ?? `anonymous:${colliders.size}`;
      colliders.set(id, { box });
      return id;
    },
    removeCollider: (id) => colliders.delete(id),
    playerPosition: () => ({ x: player.position.x, z: player.position.z }),
    teleportPlayer(x, z, yaw) {
      teleports.push({ x, z, yaw });
      player.position = { x, y: 0, z };
    },
    onFrame(callback) {
      frames.add(callback);
      return () => frames.delete(callback);
    },
    childPlacement: () => ({ x: player.position.x, z: player.position.z, yaw: player.yaw }),
    playerState: () => ({ ...player, position: { ...player.position } }),
    setEnvironment: (q) => environmentCalls.push(q),
  };
  return {
    host,
    bus,
    colliders,
    environmentCalls,
    teleports,
    player,
    frameCount: () => frames.size,
    at(x: number, z = 0) {
      player.position = { x, y: 0, z };
    },
    advance(seconds: number) {
      for (let t = 0; t < seconds - 1e-9; t += 1 / 60) {
        for (const frame of [...frames]) frame(1 / 60);
      }
    },
  };
}

const context = {
  realmId: 'firepeak',
  adventureId: 'heart-of-firepeak',
  areaId: 'heart',
  sessionRef: null,
};
const binding: ClaimsBinding = { context };

const course: JsonValue = {
  id: 'gameplay.checkpoints',
  config: {
    checkpoints: [
      {
        id: 'cp.gate',
        courseId: 'course.heart',
        position: { x: 5, y: 0, z: 0 },
        label: 'the gate',
      },
      {
        id: 'cp.bridge',
        courseId: 'course.heart',
        position: { x: 20, y: 0, z: 0 },
        label: 'the bridge',
        requiresSignalId: 'world:HEART_BRIDGE_OPEN',
      },
      {
        id: 'cp.summit',
        courseId: 'course.heart',
        position: { x: 40, y: 0, z: 0 },
        label: 'the summit',
      },
    ],
  },
};
const door: JsonValue = {
  id: 'gameplay.doors',
  config: {
    doors: [{ id: 'door.a', position: { x: 8, y: 0, z: 10 }, size: { x: 0.4, y: 2, z: 2 } }],
  },
};
const ice: JsonValue = {
  id: 'environment.volumes',
  config: {
    surfaces: [
      {
        id: 'lake.ice',
        surfaceId: 'ice',
        box: { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 0.2, z: 10 } },
      },
    ],
  },
};
const coins: JsonValue = {
  id: 'gameplay.collectibles',
  config: {
    collectibles: [
      { id: 'ember.1', position: { x: 3, y: 0, z: 0 }, setId: 'embers' },
      { id: 'ember.2', position: { x: 60, y: 0, z: 0 }, setId: 'embers' },
    ],
  },
};
const hazard: JsonValue = {
  id: 'gameplay.hazards',
  config: {
    hazards: [
      {
        id: 'pit',
        kind: 'WATER',
        rect: { minX: 50, maxX: 55, minZ: -3, maxZ: 3 },
        checkpointId: 'cp.gate',
        messageKey: 'hazard.pit',
      },
    ],
  },
};

afterEach(() => resetLocationClaimsForTests());

describe('engine bridge disposal', () => {
  it('dispose stops frames, removes mirrored colliders, clears the environment and empties the runtime', () => {
    const fake = fakeHost({ capabilities: [course, door, ice] });
    const mount = mountEngineBridge(fake.host);
    const runtime = mount.api.runtime!;
    expect(fake.frameCount()).toBe(1);
    expect(fake.colliders.has('engine:door.a')).toBe(true);
    expect(fake.environmentCalls).toHaveLength(1);
    expect(runtime.state).toBe('running');
    fake.advance(0.2);
    mount.dispose();
    expect(fake.frameCount()).toBe(0);
    expect(fake.colliders.size).toBe(0);
    expect(fake.environmentCalls.at(-1)).toBeNull();
    expect(runtime.state).toBe('disposed');
    expect(runtime.resources.count()).toBe(0);
    expect(runtime.world.size).toBe(0);
    expect(runtime.systems.ids()).toEqual([]);
    expect(runtime.events.listenerCount()).toBe(0);
    expect(runtime.services.ids()).toEqual([]);
  });

  it('dispose is idempotent and does not clear the environment twice', () => {
    const fake = fakeHost({ capabilities: [ice] });
    const mount = mountEngineBridge(fake.host);
    mount.dispose();
    mount.dispose();
    expect(fake.environmentCalls.filter((c) => c === null)).toHaveLength(1);
  });

  it('20 mount/dispose cycles on one host never grow frames, colliders or environment handles', () => {
    const fake = fakeHost({ capabilities: [course, door, ice, coins] });
    for (let i = 0; i < 20; i += 1) {
      const mount = mountEngineBridge(fake.host, { claims: binding, onGameplayEvent: () => {} });
      fake.advance(0.1);
      expect(fake.frameCount()).toBe(1);
      expect(fake.colliders.size).toBe(1);
      mount.dispose();
      expect(fake.frameCount()).toBe(0);
      expect(fake.colliders.size).toBe(0);
      expect(mount.api.runtime!.state).toBe('disposed');
      expect(mount.api.runtime!.resources.count()).toBe(0);
    }
    expect(fake.environmentCalls).toHaveLength(40); // one handed and one cleared per cycle
  });

  it('a host frame after dispose is a no-op (the runtime is gone)', () => {
    const fake = fakeHost({ capabilities: [coins] });
    const claims: AnyGameplayEvent[] = [];
    const mount = mountEngineBridge(fake.host, {
      claims: binding,
      onGameplayEvent: (e) => claims.push(e),
    });
    mount.dispose();
    fake.at(3);
    fake.advance(0.5);
    expect(claims).toEqual([]);
  });

  it('dispose immediately after mount (start has no async setup, so there is no during-start window) leaves nothing behind', () => {
    const fake = fakeHost({ capabilities: [course, door, ice] });
    const mount = mountEngineBridge(fake.host);
    mount.dispose();
    expect(mount.api.runtime!.state).toBe('disposed');
    expect(fake.colliders.size).toBe(0);
    expect(fake.frameCount()).toBe(0);
  });

  it('a refused request mounts nothing and disposes safely', () => {
    const fake = fakeHost({ capabilities: [{ id: 'movement.locomotion' }] });
    const mount = mountEngineBridge(fake.host);
    expect(mount.api.runtime).toBeNull();
    expect(() => mount.dispose()).not.toThrow();
    expect(fake.frameCount()).toBe(0);
  });
});

describe('checkpoint restoration through the bridge', () => {
  it('resume marks checkpoints silently, places the child at the furthest, and latestCheckpoint agrees', () => {
    const fake = fakeHost({ capabilities: [course] });
    const toasts: string[] = [];
    fake.bus.on('CourseCheckpointReached', (e) => toasts.push(e.checkpointId));
    const claims: AnyGameplayEvent[] = [];
    const mount = mountEngineBridge(fake.host, {
      claims: binding,
      onGameplayEvent: (e) => claims.push(e),
    });
    expect(mount.api.latestCheckpoint()).toBeNull();
    const result = mount.api.resume(['cp.gate', 'cp.summit']);
    expect(result).toEqual({ placedAt: 'cp.summit', unknown: [] });
    expect(mount.api.latestCheckpoint()).toMatchObject({ id: 'cp.summit', x: 40, z: 0 });
    expect(fake.teleports).toEqual([{ x: 40, z: 0, yaw: expect.any(Number) }]);
    // Standing on each resumed checkpoint afterwards still claims and toasts nothing.
    for (const x of [5, 40]) {
      fake.at(x);
      fake.advance(0.3);
    }
    expect(toasts).toEqual([]);
    expect(claims).toEqual([]);
    mount.dispose();
  });

  it('resume sends no PlayerRecovered, no jump or landing and no other presentation event', () => {
    const fake = fakeHost({ capabilities: [course] });
    const names: string[] = [];
    for (const name of [
      'PlayerRecovered',
      'PlayerJumped',
      'PlayerLanded',
      'CourseCheckpointReached',
      'PlatformGoalReached',
    ] as const) {
      fake.bus.on(name, () => names.push(name));
    }
    const mount = mountEngineBridge(fake.host);
    mount.api.resume(['cp.gate', 'cp.bridge', 'cp.summit']);
    fake.advance(0.3);
    expect(names).toEqual([]);
    mount.dispose();
  });

  it('resume with only unknown ids places nobody and reports them', () => {
    const fake = fakeHost({ capabilities: [course] });
    const mount = mountEngineBridge(fake.host);
    expect(mount.api.resume(['cp.nowhere', 'cp.elsewhere'])).toEqual({
      placedAt: null,
      unknown: ['cp.nowhere', 'cp.elsewhere'],
    });
    expect(fake.teleports).toEqual([]);
    expect(mount.api.latestCheckpoint()).toBeNull();
    mount.dispose();
  });

  it('resume then setSignals and setSignals then resume reach the same checkpoint state, with no events either way', () => {
    const run = (order: 'resume-first' | 'signals-first') => {
      const fake = fakeHost({ capabilities: [course] });
      const toasts: string[] = [];
      fake.bus.on('CourseCheckpointReached', (e) => toasts.push(e.checkpointId));
      const claims: AnyGameplayEvent[] = [];
      const mount = mountEngineBridge(fake.host, {
        claims: binding,
        onGameplayEvent: (e) => claims.push(e),
      });
      const resume = () => mount.api.resume(['cp.gate', 'cp.bridge']);
      const signals = () => mount.api.setSignals(['world:HEART_BRIDGE_OPEN']);
      if (order === 'resume-first') {
        resume();
        signals();
      } else {
        signals();
        resume();
      }
      fake.at(20);
      fake.advance(0.3);
      const state = {
        reached: [...mount.api.runtime!.services.require(CheckpointsService).reachedIds()],
        latest: mount.api.latestCheckpoint()?.id,
        toasts,
        claims: claims.length,
      };
      mount.dispose();
      return state;
    };
    const a = run('resume-first');
    const b = run('signals-first');
    expect(a).toEqual(b);
    expect(a).toEqual({
      reached: ['cp.gate', 'cp.bridge'],
      latest: 'cp.bridge',
      toasts: [],
      claims: 0,
    });
  });

  it('a gated checkpoint the server already holds is restored even while its signal is off, and stays silent when the signal comes on', () => {
    const fake = fakeHost({ capabilities: [course] });
    const toasts: string[] = [];
    fake.bus.on('CourseCheckpointReached', (e) => toasts.push(e.checkpointId));
    const mount = mountEngineBridge(fake.host);
    mount.api.resume(['cp.bridge']);
    expect(mount.api.latestCheckpoint()?.id).toBe('cp.bridge');
    fake.at(20);
    fake.advance(0.2);
    mount.api.setSignals(['world:HEART_BRIDGE_OPEN']);
    fake.advance(0.2);
    expect(toasts).toEqual([]);
    mount.dispose();
  });

  it('a hazard recovery after resume returns the child to the furthest resumed checkpoint, with one PlayerRecovered', () => {
    const fake = fakeHost({ capabilities: [course, hazard] });
    const recovered: unknown[] = [];
    fake.bus.on('PlayerRecovered', (e) => recovered.push(e));
    const mount = mountEngineBridge(fake.host);
    mount.api.resume(['cp.gate']);
    fake.teleports.length = 0;
    fake.at(52);
    fake.advance(0.3);
    expect(fake.teleports).toHaveLength(1);
    expect(fake.teleports[0]).toMatchObject({ x: 5, z: 0 });
    expect(recovered).toEqual([{ reason: 'HAZARD', checkpointId: 'cp.gate', hazardId: 'pit' }]);
    mount.dispose();
  });

  it('latestCheckpoint follows a checkpoint reached by walking and is the same target recovery uses', () => {
    const fake = fakeHost({ capabilities: [course] });
    const mount = mountEngineBridge(fake.host);
    fake.at(5);
    fake.advance(0.2);
    expect(mount.api.latestCheckpoint()).toMatchObject({ id: 'cp.gate' });
    fake.at(40);
    fake.advance(0.2);
    const latest = mount.api.latestCheckpoint()!;
    expect(latest.id).toBe('cp.summit');
    const target = mount.api.runtime!.services.require(CheckpointsService).resolveRecovery(null)!;
    expect([target.id, target.position.x, target.position.z, target.yaw]).toEqual([
      latest.id,
      latest.x,
      latest.z,
      latest.yaw,
    ]);
    mount.dispose();
  });

  it('latestCheckpoint is null when the bridge has no checkpoints capability', () => {
    const fake = fakeHost({ capabilities: [coins] });
    const mount = mountEngineBridge(fake.host);
    expect(mount.api.latestCheckpoint()).toBeNull();
    expect(mount.api.resume(['cp.gate'])).toEqual({ placedAt: null, unknown: ['cp.gate'] });
    mount.dispose();
  });

  it('setSignals([]) turns off exactly what was fed and a later call can turn it back on', () => {
    const fake = fakeHost({ capabilities: [course] });
    const toasts: string[] = [];
    fake.bus.on('CourseCheckpointReached', (e) => toasts.push(e.checkpointId));
    const mount = mountEngineBridge(fake.host);
    mount.api.setSignals(['world:HEART_BRIDGE_OPEN']);
    mount.api.setSignals([]);
    fake.at(20);
    fake.advance(0.2);
    expect(toasts).toEqual([]); // closed again
    mount.api.setSignals(['world:HEART_BRIDGE_OPEN']);
    fake.advance(0.2);
    expect(toasts).toEqual(['cp.bridge']);
    mount.dispose();
  });
});

describe('claim bindings (lazy, companion and default) through the location claim sink', () => {
  const COMPANION = {
    realmId: 'pirate-builder-bay',
    adventureId: 'treasure-rush-cove',
    areaId: 'cove',
    sessionRef: '0b5f8c4e-6d0a-4c43-9b6c-2f2b1b3f9a10',
  };
  const EXPLORE = {
    realmId: 'firepeak',
    adventureId: 'explore:heart',
    areaId: 'heart',
    sessionRef: null,
  };

  function mountWithSink() {
    const fake = fakeHost({ capabilities: [coins] });
    const received: AnyGameplayEvent[] = [];
    setLocationClaimSink((e) => received.push(e));
    const mount = mountEngineBridge(fake.host, {
      claims: () => currentClaimsBinding() as ClaimsBinding | null,
      onGameplayEvent: forwardClaim,
    });
    return { fake, mount, received };
  }

  it('emits nothing before any binding exists, and counts it as unbound (not invalid)', () => {
    const { fake, mount, received } = mountWithSink();
    fake.at(3);
    fake.advance(0.3);
    expect(received).toEqual([]);
    expect(mount.api.unboundClaims()).toBe(1);
    expect(mount.api.droppedClaims()).toBe(0);
    mount.dispose();
  });

  it('uses the default (free exploration) binding when no companion has set one', () => {
    setDefaultLocationClaimsBinding(EXPLORE);
    const { fake, mount, received } = mountWithSink();
    fake.at(3);
    fake.advance(0.3);
    expect(received.map((e) => e.type)).toEqual(['collectible.collected']);
    expect(received[0]).toMatchObject({ adventureId: 'explore:heart', sessionRef: null });
    expect(validateGameplayEvent(received[0]).ok).toBe(true);
    mount.dispose();
  });

  it('the companion binding wins over the default, mid-visit, and its session ref reaches the claim', () => {
    setDefaultLocationClaimsBinding(EXPLORE);
    const { fake, mount, received } = mountWithSink();
    setLocationClaimsBinding(COMPANION);
    fake.at(3);
    fake.advance(0.3);
    expect(received[0]).toMatchObject({
      adventureId: 'treasure-rush-cove',
      sessionRef: COMPANION.sessionRef,
    });
    mount.dispose();
  });

  it('clearing the companion binding falls back to the default; clearing both stops claims', () => {
    setDefaultLocationClaimsBinding(EXPLORE);
    const release = setLocationClaimsBinding(COMPANION);
    const { fake, mount, received } = mountWithSink();
    release();
    fake.at(3);
    fake.advance(0.3);
    expect(received[0]).toMatchObject({ adventureId: 'explore:heart' });
    setDefaultLocationClaimsBinding(null);
    fake.at(60);
    fake.advance(0.3);
    expect(received).toHaveLength(1);
    expect(mount.api.unboundClaims()).toBe(1);
    mount.dispose();
  });

  it('with a binding but no sink (nobody listening) nothing is delivered and nothing throws', () => {
    setDefaultLocationClaimsBinding(EXPLORE);
    const fake = fakeHost({ capabilities: [coins] });
    const mount = mountEngineBridge(fake.host, {
      claims: () => currentClaimsBinding() as ClaimsBinding | null,
      onGameplayEvent: forwardClaim,
    });
    fake.at(3);
    expect(() => fake.advance(0.3)).not.toThrow();
    mount.dispose();
  });

  it('a binding that arrives later does not replay claims emitted while unbound', () => {
    const { fake, mount, received } = mountWithSink();
    fake.at(3);
    fake.advance(0.3);
    setDefaultLocationClaimsBinding(EXPLORE);
    fake.advance(0.5);
    expect(received).toEqual([]); // ember.1 was consumed while unbound: the engine will not re-emit it
    fake.at(60);
    fake.advance(0.3);
    expect(received.map((e) => (e.payload as { collectibleId: string }).collectibleId)).toEqual([
      'ember.2',
    ]);
    mount.dispose();
  });
});

describe('claim uniqueness through the bridge', () => {
  it('re-entering checkpoint and collectible zones claims once each, with unique valid event ids', () => {
    const fake = fakeHost({ capabilities: [course, coins, hazard] });
    const claims: AnyGameplayEvent[] = [];
    const mount = mountEngineBridge(fake.host, {
      claims: binding,
      onGameplayEvent: (e) => claims.push(e),
    });
    for (let round = 0; round < 5; round += 1) {
      for (const x of [3, 5, 60, 52, 2]) {
        fake.at(x);
        fake.advance(0.3);
      }
    }
    const keys = claims.map((c) => `${c.type}:${JSON.stringify(c.payload)}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(claims.map((c) => c.type).sort()).toEqual([
      'collectible.collected',
      'collectible.collected',
      'course.checkpoint.reached',
    ]);
    expect(new Set(claims.map((c) => c.eventId)).size).toBe(claims.length);
    for (const claim of claims) expect(validateGameplayEvent(claim).issues).toEqual([]);
    mount.dispose();
  });

  it('a new bridge (a new visit) may claim again, and its ids never collide with the previous visit', () => {
    const ids = new Set<string>();
    for (let visit = 0; visit < 3; visit += 1) {
      const fake = fakeHost({ capabilities: [coins] });
      const claims: AnyGameplayEvent[] = [];
      const mount = mountEngineBridge(fake.host, {
        claims: binding,
        onGameplayEvent: (e) => claims.push(e),
      });
      fake.at(3);
      fake.advance(0.3);
      expect(claims).toHaveLength(1);
      ids.add(claims[0]!.eventId);
      mount.dispose();
    }
    expect(ids.size).toBe(3);
  });

  it('a throwing sink drops the claim and the engine does not re-emit it', () => {
    const fake = fakeHost({ capabilities: [coins] });
    const sink = vi.fn(() => {
      throw new Error('scoring down');
    });
    const mount = mountEngineBridge(fake.host, { claims: binding, onGameplayEvent: sink });
    fake.at(3);
    fake.advance(1);
    expect(sink).toHaveBeenCalledTimes(1);
    expect(mount.api.droppedClaims()).toBe(1);
    mount.dispose();
  });
});
