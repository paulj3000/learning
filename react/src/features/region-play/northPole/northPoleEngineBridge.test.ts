import { describe, expect, it } from 'vitest';
import { read } from '../../../api/parse';
import * as parse from '../../../api/play/parse';
import { northPoleBootstrapJson } from '../../../test/northPoleFixtures';
import type { BridgePlayerState, LocationBridgeHost } from '../../game-engine/bridge/bridgeHost';
import { ENGINE_BRIDGE_EXTENSION_ID, mountEngineBridge } from '../../game-engine/bridge/engineBridge';
import type { JsonValue } from '../../island-map/three/runtime/locationManifest';
import { WorldEngineEventBus } from '../../island-map/three/worldEngineEvents';
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
    expect(ids).toEqual(['environment.volumes']);
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
    expect(query.surfaceAt(-43.5, 0, 10).id).toBe('ground');
    expect(query.surfaceAt(-58, 0, 12).id).toBe('ground');
    expect(query.surfaceAt(0, 0, 60).id).toBe('ground');
    mount.dispose();
    expect(fake.environment.at(-1)).toBeNull();
  });
});
