import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { EnvironmentQuery } from '@lai/game-engine';
import { describe, expect, it } from 'vitest';
import type { BridgePlayerState, LocationBridgeHost } from '../../game-engine/bridge/bridgeHost';
import { mountEngineBridge } from '../../game-engine/bridge/engineBridge';
import { recoveredText } from '../../island-map/three/platforms/platformCopy';
import type { JsonValue } from '../../island-map/three/runtime/locationManifest';
import { WorldEngineEventBus, type WorldEngineEventMap } from '../../island-map/three/worldEngineEvents';
import { bridgeCheckpoints, earnedBridgeCheckpoints, worldSignals } from '../engineBridgeProgress';

/**
 * GE-073: the Heart of Firepeak's one checkpoint list and its lava run in the engine bridge, from
 * the seed's `scene.engineBridge` (lai/apps/regions/firepeak_heart_scene.json). Same play as
 * before: a returning child resumes at the furthest earned checkpoint, gated checkpoints open
 * with their zone's world change, lava sends the child back to the last checkpoint, and standing
 * on the basalt bridge or the stones above the lava is safe.
 */

const KEYS = { map: 'FIREPEAK_HEART_MAP_READ', emberwood: 'FIREPEAK_HEART_EMBERWOOD_DONE', bridge: 'FIREPEAK_HEART_LAVA_BRIDGE' };

function bridgeBlock(): { [key: string]: JsonValue } {
  const path = resolve(process.cwd(), '../lai/apps/regions/firepeak_heart_scene.json');
  return (JSON.parse(readFileSync(path, 'utf8')) as { scene: { engineBridge: { [key: string]: JsonValue } } }).scene
    .engineBridge;
}

function host(config: { [key: string]: JsonValue }) {
  const bus = new WorldEngineEventBus();
  const frames = new Set<(dt: number) => void>();
  const teleports: { x: number; z: number }[] = [];
  const recovered: WorldEngineEventMap['PlayerRecovered'][] = [];
  const telegraphs: { hazardId: string; phase: string; at: number }[] = [];
  const platformPhases: WorldEngineEventMap['PlatformPhaseChanged'][] = [];
  let clock = 0;
  bus.on('HazardTelegraph', ({ hazardId, phase }) => telegraphs.push({ hazardId, phase, at: clock }));
  bus.on('PlatformPhaseChanged', (event) => platformPhases.push(event));
  const reached: string[] = [];
  const environment: (EnvironmentQuery | null)[] = [];
  bus.on('PlayerRecovered', (event) => recovered.push(event));
  bus.on('CourseCheckpointReached', ({ checkpointId }) => reached.push(checkpointId));
  const player: BridgePlayerState = { position: { x: 0, y: 0, z: 90 }, yaw: 0, velocity: { x: 0, y: 0, z: 0 }, grounded: true, supportId: null };
  const value: LocationBridgeHost = {
    bus,
    config,
    reducedMotion: false,
    addCollider: (_box, options = {}) => options.id ?? 'engine:generated',
    removeCollider: () => true,
    playerPosition: () => ({ x: player.position.x, z: player.position.z }),
    teleportPlayer(x, z) {
      teleports.push({ x, z });
      player.position = { x, y: 0, z };
    },
    onFrame(callback) {
      frames.add(callback);
      return () => frames.delete(callback);
    },
    playerState: () => ({ ...player, position: { ...player.position } }),
    setEnvironment: (query) => environment.push(query),
    carryPlayer(dx, dy, dz) {
      player.position = { x: player.position.x + dx, y: player.position.y + dy, z: player.position.z + dz };
    },
    launchPlayer: () => undefined,
  };
  const at = (x: number, y: number, z: number, supportId: string | null = null) => {
    player.position = { x, y, z };
    player.supportId = supportId;
  };
  const advance = (seconds: number) => {
    for (let t = 0; t < seconds - 1e-9; t += 1 / 60) {
      for (const frame of [...frames]) frame(1 / 60);
      clock += 1 / 60;
    }
  };
  return { value, teleports, recovered, reached, at, advance, environment, telegraphs, platformPhases };
}

describe('engine bridge progress helpers (GE-073)', () => {
  it('turns world changes into world:<key> signals, once each', () => {
    expect(worldSignals(['A', 'B', 'A'])).toEqual(['world:A', 'world:B']);
  });

  it('lists the earned checkpoints in authored order: only those a world change opens', () => {
    const block = bridgeBlock();
    expect(bridgeCheckpoints(block)).toHaveLength(8);
    // Only a world change is evidence: the ungated landing is the spawn, never a resume target.
    expect(earnedBridgeCheckpoints(block, [])).toEqual([]);
    expect(earnedBridgeCheckpoints(block, [KEYS.map, KEYS.emberwood])).toEqual(['fh-cp-emberwood', 'fh-cp-lava-near']);
    expect(earnedBridgeCheckpoints(null, [KEYS.map])).toEqual([]);
  });
});

describe('the Heart of Firepeak on the engine bridge (GE-073)', () => {
  it('mounts in full mode with nothing refused', () => {
    const fake = host(bridgeBlock());
    const mount = mountEngineBridge(fake.value);
    expect(mount.api.issues).toEqual([]);
    // The support report grows by addition (GE-066 part 2 added scene and carryLaunch): compare
    // only the members this Area relies on.
    expect(mount.api.support).toMatchObject({ playerState: true, setEnvironment: true });
    mount.dispose();
  });

  it('resumes a returning child at the furthest checkpoint they earned, without a toast', () => {
    const fake = host(bridgeBlock());
    const mount = mountEngineBridge(fake.value);
    const keys = [KEYS.map, KEYS.emberwood, KEYS.bridge];
    mount.api.setSignals(worldSignals(keys));
    const result = mount.api.resume(earnedBridgeCheckpoints(bridgeBlock(), keys));
    expect(result).toEqual({ placedAt: 'fh-cp-lava-far', unknown: [] });
    expect(fake.teleports.at(-1)).toEqual({ x: 0, z: 12.4 });
    expect(fake.reached).toEqual([]);
    mount.dispose();
  });

  it('a first visit resumes nowhere: the child starts at the spawn', () => {
    const fake = host(bridgeBlock());
    const mount = mountEngineBridge(fake.value);
    mount.api.setSignals([]);
    expect(mount.api.resume(earnedBridgeCheckpoints(bridgeBlock(), []))).toEqual({ placedAt: null, unknown: [] });
    expect(fake.teleports).toEqual([]);
    mount.dispose();
  });

  it('a gated checkpoint opens only with its world change', () => {
    const fake = host(bridgeBlock());
    const mount = mountEngineBridge(fake.value);
    fake.at(0, 0, 61.5); // Emberwood's checkpoint, before the map is read
    fake.advance(0.2);
    expect(fake.reached).not.toContain('fh-cp-emberwood');
    mount.api.setSignals(worldSignals([KEYS.map]));
    fake.advance(0.2);
    expect(fake.reached).toContain('fh-cp-emberwood');
    mount.dispose();
  });

  it('lava sends the child back once, naming the hazard and the checkpoint; the bridge above it is safe', () => {
    const fake = host(bridgeBlock());
    const mount = mountEngineBridge(fake.value);
    mount.api.setSignals(worldSignals([KEYS.map, KEYS.emberwood]));
    fake.at(0, 0, 34.5); // the near bank
    fake.advance(0.2);
    fake.at(0, 0.2, 24); // on the basalt bridge over the lava
    fake.advance(0.5);
    expect(fake.recovered).toEqual([]);
    fake.at(0, 0, 24); // in the lava
    fake.advance(0.2);
    expect(fake.recovered).toEqual([{ reason: 'HAZARD', checkpointId: 'fh-cp-lava-near', hazardId: 'fh-lava-hazard' }]);
    expect(fake.teleports.at(-1)).toEqual({ x: 0, z: 34.5 });
    // The toast still names the place and keeps the lava line.
    const labels = new Map(bridgeCheckpoints(bridgeBlock()).map((c) => [c.id, c.id]));
    labels.set('fh-cp-lava-near', 'the near bank');
    expect(recoveredText({ platforms: [], recoveryLead: 'Whoa, the lava is too hot!' }, 'fh-cp-lava-near', labels)).toBe(
      'Whoa, the lava is too hot! Back to the near bank. Have another go!',
    );
    mount.dispose();
  });

  it('the Forge steam pushes back toward the Forge until it is restored, and nowhere else', () => {
    const fake = host(bridgeBlock());
    const mount = mountEngineBridge(fake.value);
    const query = fake.environment.at(-1)!;
    fake.at(0, 0, -46.5); // walking into the steam: the gust ramps in over half a second
    fake.advance(1);
    expect(query.forcesAt(0, 0.5, -46.5).length).toBe(1);
    expect(query.forcesAt(0, 0.5, -46.5)[0]!.acceleration.z).toBeGreaterThan(0); // back into the Forge
    expect(query.forcesAt(0, 0.5, -30)).toEqual([]); // the Forge floor
    expect(query.forcesAt(0, 0.5, 20)).toEqual([]); // nowhere near the lava
    mount.api.setSignals(worldSignals(['FIREPEAK_HEART_FORGE_RESTORED']));
    expect(query.forcesAt(0, 0.5, -46.5)).toEqual([]);
    mount.dispose();
  });

  it('falling rocks warn at least 1.5 s before they fall, only in the gaps, and send the child to the summit foot', () => {
    const fake = host(bridgeBlock());
    const mount = mountEngineBridge(fake.value);
    mount.api.setSignals(worldSignals([KEYS.map, KEYS.emberwood, KEYS.bridge, 'FIREPEAK_HEART_FORGE_RESTORED']));
    fake.at(9, 1.5, -59.2, 'fh-summit-hop-2'); // waiting on the middle hop: always safe
    fake.advance(13);
    expect(fake.recovered).toEqual([]);
    for (const id of ['fh-summit-rocks-1', 'fh-summit-rocks-2']) {
      const mine = fake.telegraphs.filter((t) => t.hazardId === id);
      const warn = mine.find((t) => t.phase === 'WARN')!;
      const active = mine.find((t) => t.phase === 'ACTIVE' && t.at > warn.at)!;
      expect(active.at - warn.at).toBeGreaterThanOrEqual(1.5 - 1e-6);
    }
    // Never both rocks at once: whenever one is falling, the other is calm.
    const falling = new Set<string>();
    for (const t of fake.telegraphs) {
      if (t.phase === 'ACTIVE') falling.add(t.hazardId);
      else falling.delete(t.hazardId);
      expect(falling.size).toBeLessThanOrEqual(1);
    }
    // In the first gap while its rock falls (its cycle is 4 s calm, 2 s warning, 0.5 s falling:
    // 13 s in is the start of a calm, so it falls 6 to 6.5 s later): back to the summit foot.
    fake.at(9, 0.8, -57.8);
    fake.advance(5.9);
    expect(fake.recovered).toEqual([]);
    fake.advance(0.3);
    expect(fake.recovered).toEqual([{ reason: 'HAZARD', checkpointId: 'fh-cp-summit', hazardId: 'fh-summit-rocks-1' }]);
    expect(fake.teleports.at(-1)).toEqual({ x: 0, z: -51.5 });
    mount.dispose();
  });

  it('the crumbling stone holds 4 s after the child steps on, crumbles for the last 1 s, falls into the lava and comes back', () => {
    const fake = host(bridgeBlock());
    const mount = mountEngineBridge(fake.value);
    expect(mount.api.support.carryLaunch).toBe(true); // the stone carries the child (GE-066)
    mount.api.setSignals(worldSignals([KEYS.map, KEYS.emberwood]));
    fake.at(0, 0, 34.5); // the near bank: the lava's checkpoint
    fake.advance(0.2);
    fake.advance(10); // untouched, it never crumbles (STAND)
    expect(fake.platformPhases.filter((e) => e.platformId === 'fh-stone-vanish')).toEqual([]);
    fake.at(18, 0.5, 18.8, 'engine:fh-stone-vanish');
    fake.advance(2.9);
    expect(fake.recovered).toEqual([]);
    expect(fake.platformPhases.filter((e) => e.platformId === 'fh-stone-vanish')).toEqual([]);
    fake.advance(0.3); // 3.2 s: crumbling, still standing
    expect(fake.platformPhases.map((e) => e.phase)).toContain('CRUMBLING');
    expect(fake.recovered).toEqual([]);
    fake.advance(1.0); // 4.2 s: it falls; the child drops into the lava
    expect(fake.platformPhases.map((e) => e.phase)).toEqual(expect.arrayContaining(['CRUMBLING', 'FALLING']));
    fake.at(18, 0, 18.8);
    fake.advance(0.2);
    expect(fake.recovered).toEqual([{ reason: 'HAZARD', checkpointId: 'fh-cp-lava-near', hazardId: 'fh-lava-hazard' }]);
    fake.advance(4); // gone 2.5 s, then back
    expect(fake.platformPhases.at(-1)?.phase).toBe('STABLE');
    mount.dispose();
  });
});
