import { describe, expect, it } from 'vitest';
import { read } from '../../../api/parse';
import * as parse from '../../../api/play/parse';
import { northPoleBootstrapJson } from '../../../test/northPoleFixtures';
import type { BridgePlayerState, LocationBridgeHost } from '../../game-engine/bridge/bridgeHost';
import { ENGINE_BRIDGE_EXTENSION_ID, mountEngineBridge } from '../../game-engine/bridge/engineBridge';
import type { JsonValue } from '../../island-map/three/runtime/locationManifest';
import { WorldEngineEventBus, type WorldEngineEventMap } from '../../island-map/three/worldEngineEvents';
import { earnedBridgeCheckpoints, worldSignals } from '../engineBridgeProgress';
import { NP_SOUND, regionAudioFor, NORTH_POLE_REGION_ID } from '../audio/regionAudio';
import { listenFootsteps } from '../audio/surfaceFootsteps';

const NORTH_POLE_AUDIO_FOOTSTEPS = regionAudioFor(NORTH_POLE_REGION_ID).footstepCues ?? {};
import type { EnvironmentQuery } from '@lai/game-engine';
import { buildRegionManifest } from '../regionManifest';
import { toRegionSceneModel } from '../sceneModel';

/**
 * GE-074: the Frozen Lake ice reaches the live controller through the engine bridge. The seed's
 * `scene.engineBridge` (lai/apps/regions/north_pole_layout.py) becomes the bridge's config, and the
 * environment query it hands the controller says ice on the east bank, ground everywhere else,
 * and ground right beside the open water.
 */

function bridgeConfig() {
  const data = read(northPoleBootstrapJson(), parse.regionBootstrap);
  const { manifest } = buildRegionManifest(toRegionSceneModel(data), { worldSlug: 'learning-adventure-island' });
  const binding = manifest.extensions.find((e) => e.extensionId === ENGINE_BRIDGE_EXTENSION_ID);
  return binding?.config as { [key: string]: JsonValue } | undefined;
}

/** The GE-070 host members the bridge needs, with nothing else running. */
function host(config: { [key: string]: JsonValue }) {
  const environment: (EnvironmentQuery | null)[] = [];
  const player: BridgePlayerState = { position: { x: 0, y: 0, z: 0 }, yaw: 0, velocity: { x: 0, y: 0, z: 0 }, grounded: true, supportId: null };
  const value: LocationBridgeHost = {
    bus: new WorldEngineEventBus(),
    config,
    reducedMotion: false,
    addCollider: (_box, options = {}) => options.id ?? 'engine:generated',
    removeCollider: () => true,
    playerPosition: () => ({ x: player.position.x, z: player.position.z }),
    teleportPlayer: () => undefined,
    onFrame: () => () => undefined,
    playerState: () => player,
    setEnvironment: (query) => environment.push(query),
  };
  return { value, environment };
}

describe('North Pole engine bridge (GE-074)', () => {
  it('the region manifest carries the seed engineBridge block as the bridge config', () => {
    const config = bridgeConfig();
    expect(config).toBeDefined();
    const ids = (config!.capabilities as { id: string }[]).map((c) => c.id);
    expect(ids).toEqual(['gameplay.checkpoints', 'gameplay.hazards', 'environment.volumes']);
  });

  it('mounts with no refused capability and gives the controller ice only on the east bank', () => {
    const fake = host(bridgeConfig()!);
    const mount = mountEngineBridge(fake.value);
    expect(mount.api.issues).toEqual([]);
    expect(mount.api.support).toEqual({ playerState: true, setEnvironment: true });
    const query = fake.environment.at(-1)!;
    // Frosty's skating bank, where the floe puzzles are.
    const ice = query.surfaceAt(-35, 0, 10);
    expect(ice.id).toBe('ice');
    expect(ice.friction).toBeCloseTo(0.3);
    expect(ice.speedMultiplier).toBe(1);
    // Beside the open water, the island, and the village: normal ground.
    expect(query.surfaceAt(-43.5, 0, 10).id).toBe('snow'); // beside the water: not ice
    expect(query.surfaceAt(-58, 0, 12).id).toBe('snow');
    expect(query.surfaceAt(0, 0, 60).id).toBe('snow'); // the village: snow, normal grip
    expect(query.surfaceAt(0, 0, 60).friction).toBe(1);
    mount.dispose();
    expect(fake.environment.at(-1)).toBeNull();
  });
});

/** A host whose frames run, so engine checkpoints and hazards see the child move. */
function liveHost(config: { [key: string]: JsonValue }) {
  const bus = new WorldEngineEventBus();
  const frames = new Set<(dt: number) => void>();
  const teleports: { x: number; z: number }[] = [];
  const recovered: WorldEngineEventMap['PlayerRecovered'][] = [];
  bus.on('PlayerRecovered', (event) => recovered.push(event));
  const player: BridgePlayerState = { position: { x: 0, y: 0, z: 92 }, yaw: 0, velocity: { x: 0, y: 0, z: 0 }, grounded: true, supportId: null };
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
    setEnvironment: () => undefined,
  };
  return {
    value,
    teleports,
    recovered,
    at(x: number, y: number, z: number) {
      player.position = { x, y, z };
    },
    advance(seconds: number) {
      for (let t = 0; t < seconds - 1e-9; t += 1 / 60) for (const frame of [...frames]) frame(1 / 60);
    },
  };
}

describe('North Pole checkpoints and the lake water on the bridge (GE-074)', () => {
  const LAKE_OPEN = ['NORTH_POLE_WELCOME_LOOKED', 'NORTH_POLE_WORKSHOP_RESTORED', 'NORTH_POLE_FOREST_DONE'];

  it('resumes at the Frozen Lake zone checkpoint, not a bank', () => {
    const fake = liveHost(bridgeConfig()!);
    const mount = mountEngineBridge(fake.value);
    mount.api.setSignals(worldSignals(LAKE_OPEN));
    expect(mount.api.resume(earnedBridgeCheckpoints(bridgeConfig(), LAKE_OPEN)).placedAt).toBe('np-cp-lake');
    mount.dispose();
  });

  it('the open water returns the child to the bank they last touched; the ice bridge is safe', () => {
    const fake = liveHost(bridgeConfig()!);
    const mount = mountEngineBridge(fake.value);
    mount.api.setSignals(worldSignals([...LAKE_OPEN, 'NORTH_POLE_LAKE_BRIDGE']));
    fake.at(-42, 0, 8); // the east bank
    fake.advance(0.2);
    fake.at(-47, 0.2, 12.6); // on the ice bridge over the water
    fake.advance(0.5);
    expect(fake.recovered).toEqual([]);
    fake.at(-47, 0, 20); // in the open water
    fake.advance(0.2);
    expect(fake.recovered).toEqual([{ reason: 'HAZARD', checkpointId: 'np-course-cp-lake-east', hazardId: 'np-hazard-lake-water' }]);
    expect(fake.teleports.at(-1)).toEqual({ x: -42, z: 8 });
    mount.dispose();
  });
});

describe('North Pole footsteps through the bridge (GE-074)', () => {
  it('a step on the lake bank sounds like ice, a step in the village like snow', async () => {
    const fake = liveHost(bridgeConfig()!);
    const mount = mountEngineBridge(fake.value);
    const played: string[] = [];
    const off = listenFootsteps(fake.value.bus, (cue) => played.push(cue), 'default', NORTH_POLE_AUDIO_FOOTSTEPS);
    fake.at(-35, 0, 10);
    fake.advance(1 / 60); // the bridge reads where the child stands once per frame
    fake.value.bus.emit('PlayerFootstep', { gait: 'walk' });
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    fake.at(0, 0, 60);
    fake.advance(1 / 60);
    fake.value.bus.emit('PlayerFootstep', { gait: 'walk' });
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(played).toEqual([NP_SOUND.iceStep, NP_SOUND.snowStep]);
    off();
    mount.dispose();
  });
});
