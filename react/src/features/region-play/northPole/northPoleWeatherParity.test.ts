import { Points, Scene, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { read } from '../../../api/parse';
import * as parse from '../../../api/play/parse';
import { northPoleBootstrapJson } from '../../../test/northPoleFixtures';
import type { BridgePlayerState, LocationBridgeHost } from '../../game-engine/bridge/bridgeHost';
import { ENGINE_BRIDGE_EXTENSION_ID, mountEngineBridge } from '../../game-engine/bridge/engineBridge';
import type { JsonValue } from '../../island-map/three/runtime/locationManifest';
import { createPrecipitation } from '../../island-map/three/runtime/visual/atmosphere';
import { WorldEngineEventBus } from '../../island-map/three/worldEngineEvents';
import { buildRegionManifest } from '../regionManifest';
import { toRegionSceneModel } from '../sceneModel';

/**
 * GE-073F / GE-074: may the North Pole's falling snow move from the Area atmosphere
 * (`runtime/visual/atmosphere.ts`, `scene.atmosphere.precipitation`) to the engine's
 * `environment.weather`, drawn by the bridge (GE-066 part 2)? Only at parity, so this test sets
 * the two side by side on the real North Pole scene. Where they differ, the atmosphere stays.
 *
 * Parity criteria for this Area: snow wherever the child is (village to mountain), the Area's own
 * linear night fog unchanged, and reduced motion still calming the snow.
 */

function sceneData() {
  const data = read(northPoleBootstrapJson(), parse.regionBootstrap);
  const { manifest } = buildRegionManifest(toRegionSceneModel(data), { worldSlug: 'learning-adventure-island' });
  return { data, manifest };
}

/** The real North Pole bridge block plus an engine snow kind matched to the Area (no engine fog). */
function withEngineSnow(config: { [key: string]: JsonValue }): { [key: string]: JsonValue } {
  const capabilities = (config.capabilities as JsonValue[]).concat([
    {
      id: 'environment.weather',
      config: {
        initial: 'NP_SNOW',
        kinds: [
          {
            id: 'NP_SNOW',
            precipitation: { motion: 'DRIFT', ratePerSecond: 300, fallSpeed: 1.6, drift: 0.4, size: 0.14, color: 0xffffff },
            fogDensity: 0,
          },
        ],
      },
    },
  ]);
  return { ...config, capabilities };
}

function liveHost(config: { [key: string]: JsonValue }, scene: Scene, start: { x: number; z: number }) {
  const frames = new Set<(dt: number) => void>();
  const player: BridgePlayerState = { position: { x: start.x, y: 0, z: start.z }, yaw: 0, velocity: { x: 0, y: 0, z: 0 }, grounded: true, supportId: null };
  const value: LocationBridgeHost = {
    bus: new WorldEngineEventBus(),
    config,
    reducedMotion: false,
    scene,
    addCollider: (_box, options = {}) => options.id ?? 'engine:generated',
    removeCollider: () => true,
    playerPosition: () => ({ x: player.position.x, z: player.position.z }),
    teleportPlayer: () => undefined,
    onFrame(callback) {
      frames.add(callback);
      return () => frames.delete(callback);
    },
    playerState: () => ({ ...player, position: { ...player.position } }),
    setEnvironment: () => undefined,
    carryPlayer: () => undefined,
    launchPlayer: () => undefined,
  };
  return {
    value,
    walkTo(x: number, z: number) {
      player.position = { x, y: 0, z };
    },
    advance(seconds: number) {
      for (let t = 0; t < seconds - 1e-9; t += 1 / 60) for (const frame of [...frames]) frame(1 / 60);
    },
  };
}

/** World z of every live engine snow particle. */
function engineSnowZ(scene: Scene): number[] {
  const out: number[] = [];
  scene.traverse((object) => {
    if (!(object instanceof Points) || !object.name.startsWith('engine.weather.')) return;
    const positions = object.geometry.getAttribute('position');
    for (let i = 0; i < object.geometry.drawRange.count && i < positions.count; i += 1) {
      const z = positions.getZ(i) + object.position.z;
      if (Number.isFinite(z)) out.push(z);
    }
  });
  return out;
}

describe('North Pole snow: Area atmosphere versus engine weather (parity)', () => {
  const { data, manifest } = sceneData();
  const start = data.spawn ? { x: data.spawn.x, z: data.spawn.z } : { x: 0, z: 92 };
  const MOUNTAIN = { x: -34, z: -84 }; // Snowflake Mountain, the far end of the Area

  it('the Area atmosphere snows where the child is, on the mountain too, under the linear night fog', () => {
    const atmosphere = manifest.atmosphere!;
    expect(atmosphere.precipitation?.kind).toBe('SNOW');
    expect(atmosphere.fog).toEqual({ color: 0x2a4470, near: 50, far: 190 });
    const snow = createPrecipitation(atmosphere.precipitation!, 'MEDIUM', false)!;
    snow.update(1 / 60, new Vector3(MOUNTAIN.x, 0, MOUNTAIN.z));
    expect(snow.points.position.z).toBe(MOUNTAIN.z); // the box follows the camera
    const calm = createPrecipitation(atmosphere.precipitation!, 'MEDIUM', true)!;
    expect(calm.count).toBeLessThan(snow.count); // reduced motion: fewer, slower flakes
    snow.dispose();
    calm.dispose();
  });

  it('engine weather keeps the night fog when its kind has no fog, but snows only around the start: not at parity yet', () => {
    const binding = manifest.extensions.find((e) => e.extensionId === ENGINE_BRIDGE_EXTENSION_ID)!;
    const scene = new Scene();
    const fake = liveHost(withEngineSnow(binding.config as { [key: string]: JsonValue }), scene, start);
    const mount = mountEngineBridge(fake.value);
    expect(mount.api.issues).toEqual([]);
    fake.advance(3);
    const nearStart = engineSnowZ(scene);
    expect(nearStart.length).toBeGreaterThan(0);
    // GE-L14: the engine's snow falls in a fixed 25 m half-extent box around the start.
    expect(Math.max(...nearStart.map((z) => Math.abs(z - start.z)))).toBeLessThanOrEqual(25 + 1e-6);
    // The child walks to the mountain: the engine snow stays behind at the landing.
    fake.walkTo(MOUNTAIN.x, MOUNTAIN.z);
    fake.advance(3);
    const atMountain = engineSnowZ(scene).filter((z) => Math.abs(z - MOUNTAIN.z) <= 25);
    expect(atMountain).toEqual([]);
    // With no engine fog the Area fog is left as it was (null here: the view never adds one).
    expect(scene.fog).toBeNull();
    mount.dispose();
  });

  it('so the North Pole seed asks the engine for no weather: the Area atmosphere stays the snow', () => {
    const binding = manifest.extensions.find((e) => e.extensionId === ENGINE_BRIDGE_EXTENSION_ID)!;
    const ids = ((binding.config as { capabilities: { id: string }[] }).capabilities).map((c) => c.id);
    expect(ids).not.toContain('environment.weather');
    expect(manifest.atmosphere?.precipitation).toEqual({ kind: 'SNOW', density: 0.6 });
  });
});
