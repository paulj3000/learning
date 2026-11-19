import { CheckpointsService, SignalBoardService } from '@lai/game-engine';
import { Box3 } from 'three';
import { PhysicsProviderService, validateGameplayEvent, type AnyGameplayEvent, type EnvironmentQuery } from '@lai/game-engine';
import type { JsonValue } from '../../island-map/three/runtime/locationManifest';
import { WorldEngineEventBus } from '../../island-map/three/worldEngineEvents';
import type { BridgePlayerState, LocationBridgeHost } from './bridgeHost';
import { bridgeCapabilityRequests, createEngineBridgeExtension, mountEngineBridge, type ClaimsBinding } from './engineBridge';

/** A fake island-map host: today's members, plus the GE-070 ones when `full`. */
function fakeHost(config: { [key: string]: JsonValue }, full: boolean) {
  const bus = new WorldEngineEventBus();
  const frames = new Set<(dt: number) => void>();
  const colliders = new Map<string, { box: Box3; jumpable: boolean; gate: boolean }>();
  const environmentCalls: (EnvironmentQuery | null)[] = [];
  const teleports: { x: number; z: number; yaw: number }[] = [];
  let generated = 0;
  const player: BridgePlayerState = { position: { x: 0, y: 0, z: 0 }, yaw: 0, velocity: { x: 0, y: 0, z: 0 }, grounded: true, supportId: null };
  const base: LocationBridgeHost = {
    bus,
    config,
    reducedMotion: false,
    addCollider(box, options = {}) {
      const id = full ? (options.id ?? `extension:engineBridge:${(generated += 1)}`) : `anonymous:${(generated += 1)}`;
      colliders.set(id, { box, jumpable: options.jumpable === true && options.gate !== true, gate: options.gate === true });
      return full ? id : undefined;
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
  };
  const host: LocationBridgeHost = full
    ? { ...base, playerState: () => ({ ...player, position: { ...player.position } }), setEnvironment: (q) => environmentCalls.push(q) }
    : base;
  return {
    host,
    bus,
    colliders,
    environmentCalls,
    teleports,
    player,
    frameCount: () => frames.size,
    advance(seconds: number) {
      for (let t = 0; t < seconds - 1e-9; t += 1 / 60) {
        for (const frame of [...frames]) frame(1 / 60);
      }
    },
  };
}

const claimsContext: ClaimsBinding = {
  context: { realmId: 'firepeak', adventureId: 'heart-of-firepeak', areaId: 'heart', sessionRef: null },
  options: { newEventId: () => `11111111-2222-4333-8444-${String(Date.now()).padStart(12, '0').slice(-12)}` },
};

const checkpoints = { id: 'gameplay.checkpoints', config: { checkpoints: [{ id: 'cp.ledge', courseId: 'course.heart', position: { x: 5, y: 0, z: 0 }, label: 'the ledge' }] } };
const rock = {
  id: 'hz.rock',
  kind: 'FALLING_ROCK',
  rect: { minX: -1, maxX: 1, minZ: -1, maxZ: 1 },
  route: 'OPTIONAL',
  checkpointId: 'cp.ledge',
  messageKey: 'hazard.rock.kind',
  telegraphSeconds: 2,
  activeSeconds: 0.5,
  restSeconds: 3,
  offsetSeconds: 0,
};
const iceVolume = { id: 'environment.volumes', config: { surfaces: [{ id: 'lake.ice', surfaceId: 'ice', box: { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 0.2, z: 10 } } }] } };

describe('engine bridge capability requests', () => {
  it('refuses what the live runtime owns, with a clear issue, and installs nothing', () => {
    const fake = fakeHost({ capabilities: [{ id: 'movement.locomotion' }, { id: 'gameplay.platforms', config: { platforms: [] } }, { id: 'camera.thirdPerson' }] }, true);
    const reported: string[] = [];
    const mount = mountEngineBridge(fake.host, { onIssues: (issues) => reported.push(...issues.map((i) => i.message)) });
    expect(mount.api.runtime).toBeNull();
    expect(mount.api.issues.map((i) => i.path)).toEqual(['capabilities[0]', 'capabilities[1]', 'capabilities[2]']);
    expect(reported[0]).toMatch(/owned by the live location runtime/);
    expect(reported[1]).toMatch(/live platform system until GE-076/);
    expect(fake.frameCount()).toBe(0);
  });

  it('allows engine platforms only when asked, and reports unknown capabilities', () => {
    expect(bridgeCapabilityRequests({ capabilities: [{ id: 'gameplay.platforms' }] }, true).issues).toEqual([]);
    const fake = fakeHost({ capabilities: [{ id: 'gameplay.wings' }] }, true);
    expect(mountEngineBridge(fake.host).api.issues[0]?.message).toMatch(/Unknown capability/);
    expect(bridgeCapabilityRequests({ capabilities: 'all' }).issues[0]?.path).toBe('capabilities');
  });

  it('reads allowEnginePlatforms from the scene config (scene.engineBridge seed data)', () => {
    const fake = fakeHost({ allowEnginePlatforms: true, capabilities: [{ id: 'gameplay.platforms', config: { platforms: [] } }] }, true);
    const mount = mountEngineBridge(fake.host);
    expect(mount.api.issues).toEqual([]);
    mount.dispose();
  });
});

describe('engine bridge on a host without the GE-070 members (degraded, never silent)', () => {
  it('mounts through the WorldExtension, falls back to playerPosition and warns about what is missing', () => {
    const fake = fakeHost({ capabilities: [iceVolume] }, false);
    const extension = createEngineBridgeExtension();
    expect(extension.id).toBe('engineBridge');
    const mount = mountEngineBridge(fake.host);
    const runtime = mount.api.runtime!;
    expect(runtime.state).toBe('running');
    expect(mount.api.support).toEqual({ playerState: false, setEnvironment: false });
    const codes = runtime.diagnostics.snapshot().warnings.map((w) => w.code);
    expect(codes).toEqual(expect.arrayContaining(['HOST_PLAYER_STATE_MISSING', 'HOST_ENVIRONMENT_UNSUPPORTED']));
    fake.player.position = { x: 2, y: 0, z: 0 };
    fake.advance(0.1);
    expect(fake.frameCount()).toBe(1);
    mount.dispose();
    expect(fake.frameCount()).toBe(0);
  });
});

describe('engine bridge on a full host', () => {
  describe('resume and world-change signals (Firepeak acceptance scenario 10)', () => {
    const course: JsonValue = {
      id: 'gameplay.checkpoints',
      config: {
        checkpoints: [
          { id: 'cp.gate', courseId: 'course.heart', position: { x: 5, y: 0, z: 0 }, label: 'the gate' },
          { id: 'cp.bridge', courseId: 'course.heart', position: { x: 20, y: 0, z: 0 }, label: 'the bridge', requiresSignalId: 'world:HEART_BRIDGE_OPEN' },
          { id: 'cp.summit', courseId: 'course.heart', position: { x: 40, y: 0, z: 0 }, label: 'the summit' },
        ],
      },
    };

    it('marks earned checkpoints silently and places the child at the furthest in authored order', () => {
      const fake = fakeHost({ capabilities: [course] }, true);
      const reached: string[] = [];
      fake.bus.on('CourseCheckpointReached', (e) => reached.push(e.checkpointId));
      const claims: AnyGameplayEvent[] = [];
      const mount = mountEngineBridge(fake.host, { claims: claimsContext, onGameplayEvent: (e) => claims.push(e) });
      // Passed in any order; "furthest" is the authored order, not the call order.
      expect(mount.api.resume(['cp.summit', 'cp.gate', 'cp.nowhere'])).toEqual({ placedAt: 'cp.summit', unknown: ['cp.nowhere'] });
      expect(fake.teleports.at(-1)).toMatchObject({ x: 40, z: 0 });
      fake.advance(0.1);
      expect(reached).toEqual([]); // resuming announces nothing
      expect(claims).toEqual([]); // and claims nothing: the server already holds these
      expect(mount.api.runtime!.services.require(CheckpointsService).reachedIds()).toEqual(['cp.gate', 'cp.summit']);
      mount.dispose();
    });

    it('opens a signal-gated checkpoint only while its world-change signal is fed, and forwards the toast event with its label', () => {
      const fake = fakeHost({ capabilities: [course] }, true);
      const toasts: { checkpointId: string; label: string }[] = [];
      fake.bus.on('CourseCheckpointReached', (e) => toasts.push(e));
      const mount = mountEngineBridge(fake.host);
      fake.player.position = { x: 20, y: 0, z: 0 };
      fake.advance(0.2);
      expect(toasts).toEqual([]); // the bridge is still closed
      mount.api.setSignals(['world:HEART_BRIDGE_OPEN']);
      fake.advance(0.2);
      expect(toasts).toEqual([{ checkpointId: 'cp.bridge', label: 'the bridge' }]);
      mount.dispose();
    });

    it('turns off only the signals it fed', () => {
      const fake = fakeHost({ capabilities: [course] }, true);
      const mount = mountEngineBridge(fake.host);
      const board = mount.api.runtime!.services.require(SignalBoardService);
      board.set('plate.1', true); // owned by a plate, not by the host feed
      mount.api.setSignals(['world:A', 'world:B']);
      mount.api.setSignals(['world:B']);
      expect([board.get('world:A'), board.get('world:B'), board.get('plate.1')]).toEqual([false, true, true]);
      mount.dispose();
    });

    it('resumes nothing on a bridge that installed nothing', () => {
      const fake = fakeHost({ capabilities: [{ id: 'movement.locomotion' }] }, true);
      const mount = mountEngineBridge(fake.host);
      expect(mount.api.resume(['cp.gate'])).toEqual({ placedAt: null, unknown: ['cp.gate'] });
      expect(fake.teleports).toEqual([]);
    });
  });

  it('sends a telegraphed-rock hit back to the latest checkpoint with exactly one PlayerRecovered naming the hazard', () => {
    const fake = fakeHost({ capabilities: [checkpoints, { id: 'gameplay.hazards', config: { telegraphed: [rock] } }] }, true);
    const recovered: unknown[] = [];
    fake.bus.on('PlayerRecovered', (event) => recovered.push(event));
    const reached: string[] = [];
    fake.bus.on('CourseCheckpointReached', (event) => reached.push(event.checkpointId));
    const mount = mountEngineBridge(fake.host);
    fake.player.position = { x: 5, y: 0, z: 0 };
    fake.advance(0.2);
    expect(reached).toEqual(['cp.ledge']); // forwarded to the host bus
    fake.player.position = { x: 0, y: 0, z: 0 };
    fake.advance(6);
    expect(fake.teleports).toEqual([{ x: 5, z: 0, yaw: expect.any(Number) }]);
    expect(recovered).toEqual([{ reason: 'HAZARD', checkpointId: 'cp.ledge', hazardId: 'hz.rock' }]);
    mount.dispose();
  });

  it('resolves a lazy claims binding at emit time: nothing before the visit context exists', () => {
    const collectibles = [
      { id: 'ember.1', position: { x: 3, y: 0, z: 0 }, setId: 'embers' },
      { id: 'ember.2', position: { x: 6, y: 0, z: 0 }, setId: 'embers' },
    ];
    const fake = fakeHost({ capabilities: [{ id: 'gameplay.collectibles', config: { collectibles } }] }, true);
    const claims: AnyGameplayEvent[] = [];
    let visit: typeof claimsContext | null = null;
    const mount = mountEngineBridge(fake.host, { claims: () => visit, onGameplayEvent: (event) => claims.push(event) });
    fake.player.position = { x: 3, y: 0, z: 0 };
    fake.advance(0.2);
    expect(claims).toEqual([]); // the session has not started: no claim, nothing on the bus
    expect(mount.api.unboundClaims()).toBe(1);
    expect(mount.api.droppedClaims()).toBe(0);
    visit = claimsContext;
    fake.player.position = { x: 6, y: 0, z: 0 };
    fake.advance(0.2);
    expect(claims.map((c) => c.payload)).toEqual([expect.objectContaining({ collectibleId: 'ember.2' })]);
    expect(claims[0]!.sessionRef).toBe(claimsContext.context.sessionRef);
    expect(validateGameplayEvent(claims[0]).ok).toBe(true);
    mount.dispose();
  });

  it('sends a valid collectible.collected claim to the sink (decision E15)', () => {
    const fake = fakeHost({ capabilities: [{ id: 'gameplay.collectibles', config: { collectibles: [{ id: 'ember.1', position: { x: 3, y: 0, z: 0 }, setId: 'embers' }] } }] }, true);
    const claims: AnyGameplayEvent[] = [];
    const mount = mountEngineBridge(fake.host, { claims: claimsContext, onGameplayEvent: (event) => claims.push(event) });
    fake.player.position = { x: 3, y: 0, z: 0 };
    fake.advance(0.2);
    expect(claims.map((c) => c.type)).toEqual(['collectible.collected']);
    expect(claims[0]!.payload).toMatchObject({ collectibleId: 'ember.1', setId: 'embers' });
    expect(validateGameplayEvent(claims[0]).ok).toBe(true);
    mount.dispose();
  });

  it('counts and drops a claim whose sink throws, without throwing into play', () => {
    const fake = fakeHost({ capabilities: [{ id: 'gameplay.collectibles', config: { collectibles: [{ id: 'ember.1', position: { x: 0, y: 0, z: 0 } }] } }] }, true);
    const mount = mountEngineBridge(fake.host, {
      claims: claimsContext,
      onGameplayEvent: () => {
        throw new Error('sink failed');
      },
    });
    expect(() => fake.advance(0.2)).not.toThrow();
    expect(mount.api.droppedClaims()).toBe(1);
    mount.dispose();
  });

  it('hands the environment query to the live controller, and null on dispose', () => {
    const fake = fakeHost({ capabilities: [iceVolume] }, true);
    const mount = mountEngineBridge(fake.host);
    expect(fake.environmentCalls).toHaveLength(1);
    const query = fake.environmentCalls[0]!;
    const surface = query.surfaceAt(5, 0.1, 5);
    expect(surface.id).toBe('ice');
    expect(surface.friction).toBeLessThan(0.5);
    expect(query.surfaceAt(50, 0, 50).id).toBe('ground');
    mount.dispose();
    expect(fake.environmentCalls.at(-1)).toBeNull();
  });

  it('mirrors engine colliders into the host by reference with engine: ids, and removes them', () => {
    const fake = fakeHost({ capabilities: [checkpoints] }, true);
    const mount = mountEngineBridge(fake.host);
    const physics = mount.api.runtime!.services.require(PhysicsProviderService);
    physics.addCollider({ id: 'crate', kind: 'JUMPABLE', min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 0.5, z: 1 } });
    physics.addCollider({ id: 'gate.north', kind: 'SOLID', gate: true, min: { x: 2, y: 0, z: 0 }, max: { x: 3, y: 3, z: 1 } });
    physics.addCollider({ id: 'zone', kind: 'TRIGGER', min: { x: 5, y: 0, z: 5 }, max: { x: 6, y: 1, z: 6 } });
    expect([...fake.colliders.keys()].sort()).toEqual(['engine:crate', 'engine:gate.north']);
    expect(fake.colliders.get('engine:crate')).toMatchObject({ jumpable: true, gate: false });
    expect(fake.colliders.get('engine:gate.north')).toMatchObject({ jumpable: false, gate: true });
    physics.updateCollider('crate', { x: 4, y: 0, z: 0 }, { x: 5, y: 0.5, z: 1 });
    expect(fake.colliders.get('engine:crate')!.box.min.x).toBe(4); // same Box3, moved in place
    expect(physics.raycast({ x: 0, y: 0.25, z: 0.5 }, { x: 1, y: 0, z: 0 }, 10)?.colliderId).toBe('gate.north');
    expect(physics.removeCollider('crate')).toBe(true);
    expect(fake.colliders.has('engine:crate')).toBe(false);
    mount.dispose();
    expect(fake.colliders.size).toBe(0);
  });

  it('disposes to zero resources and entities, once', () => {
    const fake = fakeHost({ capabilities: [checkpoints, iceVolume, { id: 'gameplay.hazards', config: { telegraphed: [rock] } }] }, true);
    const mount = mountEngineBridge(fake.host);
    const runtime = mount.api.runtime!;
    fake.advance(1);
    mount.dispose();
    mount.dispose();
    expect(runtime.state).toBe('disposed');
    expect(runtime.resources.count()).toBe(0);
    expect(runtime.world.size).toBe(0);
    expect(fake.frameCount()).toBe(0);
    expect(fake.environmentCalls.filter((q) => q === null)).toHaveLength(1);
  });
});
