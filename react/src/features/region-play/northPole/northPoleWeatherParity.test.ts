import { Points, Scene } from 'three';
import { describe, expect, it } from 'vitest';
import { read } from '../../../api/parse';
import * as parse from '../../../api/play/parse';
import { northPoleBootstrapJson } from '../../../test/northPoleFixtures';
import type { BridgePlayerState, LocationBridgeHost } from '../../game-engine/bridge/bridgeHost';
import {
  ENGINE_BRIDGE_EXTENSION_ID,
  mountEngineBridge,
} from '../../game-engine/bridge/engineBridge';
import type { JsonValue, PrecipitationSpec } from '../../island-map/three/runtime/locationManifest';
import { createPrecipitation } from '../../island-map/three/runtime/visual/atmosphere';
import { WorldEngineEventBus } from '../../island-map/three/worldEngineEvents';
import { buildRegionManifest } from '../regionManifest';
import { toRegionSceneModel } from '../sceneModel';

/**
 * GE-074 (layout 5): the North Pole's falling snow moved from the Area atmosphere
 * (`runtime/visual/atmosphere.ts`, which drew `{ kind: 'SNOW', density: 0.6 }`) to the engine's
 * `environment.weather`, drawn by the bridge. This is the parity proof, on the real seed:
 *
 * - snow wherever the child is, village to mountain (`area.mode: FOLLOW_PLAYER`);
 * - the Area's own linear night fog unchanged (the engine kind has no fog);
 * - per render tier: the atmosphere's counts (LOW none, MEDIUM 360, HIGH 720; `budgetShare` 0.6);
 * - reduced motion calms it (fewer flakes);
 * - one snowfall: the atmosphere no longer snows.
 */

/** What the atmosphere drew before layout 5, for the side-by-side counts. */
const OLD_ATMOSPHERE_SNOW: PrecipitationSpec = { kind: 'SNOW', density: 0.6 };
const MOUNTAIN = { x: -34, z: -84 }; // Snowflake Mountain, the far end of the Area

function sceneData() {
  const data = read(northPoleBootstrapJson(), parse.regionBootstrap);
  const { manifest } = buildRegionManifest(toRegionSceneModel(data), {
    worldSlug: 'learning-adventure-island',
  });
  const binding = manifest.extensions.find((e) => e.extensionId === ENGINE_BRIDGE_EXTENSION_ID)!;
  return { data, manifest, config: binding.config as { [key: string]: JsonValue } };
}

interface HostOptions {
  quality?: 'LOW' | 'MEDIUM' | 'HIGH';
  reducedMotion?: boolean;
}

function liveHost(
  config: { [key: string]: JsonValue },
  scene: Scene,
  start: { x: number; z: number },
  options: HostOptions = {},
) {
  const frames = new Set<(dt: number) => void>();
  const player: BridgePlayerState = {
    position: { x: start.x, y: 0, z: start.z },
    yaw: 0,
    velocity: { x: 0, y: 0, z: 0 },
    grounded: true,
    supportId: null,
  };
  const value: LocationBridgeHost = {
    bus: new WorldEngineEventBus(),
    config,
    reducedMotion: options.reducedMotion ?? false,
    scene,
    ...(options.quality ? { quality: options.quality } : {}),
    addCollider: (_box, opts = {}) => opts.id ?? 'engine:generated',
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
      for (let t = 0; t < seconds - 1e-9; t += 1 / 60)
        for (const frame of [...frames]) frame(1 / 60);
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

/** Settled flake count at a render tier (snow lives 15 s; 20 s lets it settle). */
function settledFlakes(options: HostOptions): number {
  const { data, config } = sceneData();
  const scene = new Scene();
  const fake = liveHost(config, scene, { x: data.spawn!.x, z: data.spawn!.z }, options);
  const mount = mountEngineBridge(fake.value);
  fake.advance(20);
  const n = engineSnowZ(scene).length;
  mount.dispose();
  return n;
}

describe('North Pole snow on the engine (GE-074, layout 5): parity with the Area atmosphere', () => {
  it('snows once: the engine has the snow, the atmosphere keeps only the night fog and the aurora', () => {
    const { manifest, config } = sceneData();
    expect(manifest.atmosphere?.precipitation).toBeUndefined();
    expect(manifest.atmosphere?.fog).toEqual({ color: 0x2a4470, near: 50, far: 190 });
    expect(manifest.atmosphere?.skyRibbons).toHaveLength(1);
    const ids = (config.capabilities as { id: string }[]).map((c) => c.id);
    expect(ids).toContain('environment.weather');
  });

  it('the snow goes with the child to the mountain and never adds an engine fog', () => {
    const { data, config } = sceneData();
    const scene = new Scene();
    const fake = liveHost(
      config,
      scene,
      { x: data.spawn!.x, z: data.spawn!.z },
      { quality: 'MEDIUM' },
    );
    const mount = mountEngineBridge(fake.value);
    expect(mount.api.issues).toEqual([]);
    fake.walkTo(MOUNTAIN.x, MOUNTAIN.z);
    fake.advance(4);
    const zs = engineSnowZ(scene);
    expect(zs.length).toBeGreaterThan(0);
    expect(zs.filter((z) => Math.abs(z - MOUNTAIN.z) <= 20 + 1e-6).length).toBeGreaterThan(0);
    expect(scene.fog).toBeNull(); // the region's own linear fog is applied by the location, untouched here
    mount.dispose();
  });

  it('matches the atmosphere on every render tier: LOW none, MEDIUM 360, HIGH 720', () => {
    expect(createPrecipitation(OLD_ATMOSPHERE_SNOW, 'LOW', false)).toBeNull();
    expect(settledFlakes({ quality: 'LOW' })).toBe(0);
    const oldMedium = createPrecipitation(OLD_ATMOSPHERE_SNOW, 'MEDIUM', false)!;
    const oldHigh = createPrecipitation(OLD_ATMOSPHERE_SNOW, 'HIGH', false)!;
    // The snow takes 0.6 of the tier budget (`budgetShare`), as the atmosphere's density did.
    expect(settledFlakes({ quality: 'MEDIUM' })).toBe(oldMedium.count);
    expect(settledFlakes({ quality: 'HIGH' })).toBe(oldHigh.count);
    expect([oldMedium.count, oldHigh.count]).toEqual([360, 720]);
    oldMedium.dispose();
    oldHigh.dispose();
  });

  it('reduced motion calms the snow, as it did on the atmosphere', () => {
    const old = createPrecipitation(OLD_ATMOSPHERE_SNOW, 'HIGH', false)!;
    const oldCalm = createPrecipitation(OLD_ATMOSPHERE_SNOW, 'HIGH', true)!;
    expect(oldCalm.count).toBeLessThan(old.count);
    old.dispose();
    oldCalm.dispose();
    expect(settledFlakes({ quality: 'HIGH', reducedMotion: true })).toBeLessThan(
      settledFlakes({ quality: 'HIGH' }),
    );
  });
});
