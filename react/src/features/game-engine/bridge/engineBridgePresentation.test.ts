import { Box3, Scene, type Object3D } from 'three';
import type { JsonValue } from '../../island-map/three/runtime/locationManifest';
import { WorldEngineEventBus } from '../../island-map/three/worldEngineEvents';
import type { BridgePlayerState, LocationBridgeHost } from './bridgeHost';
import { mountEngineBridge } from './engineBridge';

/** GE-066: scene presentation, live carry and launch, against a fake host (no WebGL). */
function fakeHost(config: { [key: string]: JsonValue }, extras: Partial<LocationBridgeHost> & { reducedMotion?: boolean } = {}) {
  const bus = new WorldEngineEventBus();
  const frames = new Set<(dt: number) => void>();
  const colliders = new Map<string, Box3>();
  const carries: [number, number, number][] = [];
  const launches: number[] = [];
  const player: BridgePlayerState = { position: { x: 0, y: 1.4, z: 0 }, yaw: 0, velocity: { x: 0, y: 0, z: 0 }, grounded: true, supportId: null };
  const host: LocationBridgeHost = {
    bus,
    config,
    reducedMotion: extras.reducedMotion ?? false,
    addCollider(box, options = {}) {
      const id = options.id ?? `x:${colliders.size}`;
      colliders.set(id, box);
      return id;
    },
    removeCollider: (id) => colliders.delete(id),
    playerPosition: () => ({ x: player.position.x, z: player.position.z }),
    teleportPlayer() {},
    onFrame(callback) {
      frames.add(callback);
      return () => frames.delete(callback);
    },
    playerState: () => ({ ...player, position: { ...player.position } }),
    ...extras,
  };
  return {
    host,
    player,
    carries,
    launches,
    carryMembers: { carryPlayer: (dx: number, dy: number, dz: number) => void carries.push([dx, dy, dz]), launchPlayer: (h: number) => void launches.push(h) },
    advance(seconds: number) {
      for (let t = 0; t < seconds - 1e-9; t += 1 / 60) for (const frame of [...frames]) frame(1 / 60);
    },
  };
}

const count = (scene: Scene) => {
  let n = 0;
  scene.traverse((o: Object3D) => {
    if (o !== scene) n += 1;
  });
  return n;
};
const named = (scene: Scene, prefix: string) => {
  const out: Object3D[] = [];
  scene.traverse((o) => {
    if (o.name.startsWith(prefix)) out.push(o);
  });
  return out;
};

const lift = {
  id: 'lift',
  position: { x: 0, y: 1, z: 0 },
  size: { x: 3, y: 0.4, z: 3 },
  route: 'OPTIONAL',
  moving: { path: [{ x: 4, y: 0, z: 0 }], mode: 'PING_PONG', speed: 2, pauseSeconds: 0 },
};
const crumble = {
  id: 'crumble',
  position: { x: 10, y: 1, z: 0 },
  size: { x: 3, y: 0.4, z: 3 },
  route: 'OPTIONAL',
  falling: { mode: 'TIMED', visibleSeconds: 3, hiddenSeconds: 2, warningSeconds: 1 },
};
const bounce = { id: 'pad', position: { x: 20, y: 1, z: 0 }, size: { x: 3, y: 0.4, z: 3 }, bounceHeight: 2 };
const platformsCap = (...platforms: JsonValue[]): JsonValue => ({ id: 'gameplay.platforms', config: { platforms } });
const checkpoints = { id: 'gameplay.checkpoints', config: { checkpoints: [{ id: 'cp', courseId: 'c', position: { x: 5, y: 0, z: 0 }, label: 'here' }] } };
const rock = {
  id: 'rock',
  kind: 'FALLING_ROCK',
  rect: { minX: -1, maxX: 1, minZ: -1, maxZ: 1 },
  route: 'OPTIONAL',
  checkpointId: 'cp',
  messageKey: 'hazard.rock.kind',
  telegraphSeconds: 2,
  activeSeconds: 0.5,
  restSeconds: 3,
  offsetSeconds: 0,
};

describe('bridge scene presentation', () => {
  it('without a scene it warns HOST_SCENE_MISSING and draws nothing', () => {
    const fake = fakeHost({ allowEnginePlatforms: true, capabilities: [platformsCap(lift)] });
    const mount = mountEngineBridge(fake.host);
    const codes = mount.api.runtime!.diagnostics.snapshot().warnings.map((w) => w.code);
    expect(codes).toContain('HOST_SCENE_MISSING');
    expect(mount.api.support.scene).toBe(false);
    mount.dispose();
  });

  it('draws a platform that follows its collider, and removes it on dispose', () => {
    const scene = new Scene();
    const fake = fakeHost({ allowEnginePlatforms: true, capabilities: [platformsCap(lift)] }, { scene });
    const mount = mountEngineBridge(fake.host);
    fake.advance(0.1);
    const [mesh] = named(scene, 'engine.platform.lift');
    expect(mesh).toBeDefined();
    expect(mesh!.visible).toBe(true);
    fake.advance(1);
    expect(mesh!.position.x).toBeCloseTo(2.2, 0);
    expect(mesh!.position.y).toBeCloseTo(1.2, 5);
    mount.dispose();
    expect(count(scene)).toBe(0);
  });

  it('blinks the crumble warning, holds it steady dim under reduced motion, and hides the platform while gone', () => {
    const run = (reducedMotion: boolean) => {
      const scene = new Scene();
      const fake = fakeHost({ allowEnginePlatforms: true, capabilities: [platformsCap(crumble)] }, { scene, reducedMotion });
      const mount = mountEngineBridge(fake.host);
      const mesh = named(scene, 'engine.platform.crumble')[0] as unknown as { visible: boolean; material: { opacity: number } };
      const opacities = new Set<number>();
      let sawHidden = false;
      for (let i = 0; i < 6 * 60; i += 1) {
        fake.advance(1 / 60);
        if (!mesh.visible) sawHidden = true;
        else if (mesh.material.opacity < 1) opacities.add(Number(mesh.material.opacity.toFixed(2)));
      }
      mount.dispose();
      return { opacities, sawHidden };
    };
    const normal = run(false);
    expect(normal.sawHidden).toBe(true);
    expect(normal.opacities.size).toBeGreaterThan(0);
    const steady = run(true);
    expect(steady.sawHidden).toBe(true);
    expect([...steady.opacities]).toEqual([0.5]);
  });

  it('draws a telegraph that fills over the warning, shows the object while ACTIVE, and is steady under reduced motion', () => {
    const run = (reducedMotion: boolean) => {
      const scene = new Scene();
      const fake = fakeHost({ capabilities: [checkpoints, { id: 'gameplay.hazards', config: { telegraphed: [rock] } }] }, { scene, reducedMotion });
      fake.player.position = { x: 30, y: 0, z: 30 };
      const mount = mountEngineBridge(fake.host);
      const fill = named(scene, 'engine.hazard.rock.fill')[0]!;
      const object = named(scene, 'engine.hazard.rock.object')[0]!;
      const scales: number[] = [];
      let objectShown = false;
      fake.advance(0.1);
      expect(fill.visible).toBe(false); // REST: nothing drawn
      for (let i = 0; i < 6 * 60; i += 1) {
        fake.advance(1 / 60);
        if (fill.visible && !object.visible) scales.push(fill.scale.x);
        if (object.visible) objectShown = true;
      }
      mount.dispose();
      expect(count(scene)).toBe(0);
      return { scales, objectShown };
    };
    const normal = run(false);
    expect(normal.objectShown).toBe(true);
    expect(normal.scales[0]!).toBeLessThan(normal.scales[normal.scales.length - 1]!);
    const steady = run(true);
    expect(new Set(steady.scales)).toEqual(new Set([1]));
  });

  it('draws weather, lighting and particle views and removes every object on dispose', () => {
    const scene = new Scene();
    const fake = fakeHost(
      {
        capabilities: [
          { id: 'environment.lighting', config: {} },
          { id: 'environment.weather', config: { initial: 'RAIN' } },
          {
            id: 'environment.particles',
            config: {
              tier: 'LOW',
              emitters: [{ id: 'embers', motion: 'RISE', maxParticles: 50, ratePerSecond: 20, lifetime: 2, speed: 1, size: 0.1, color: 0xff6600, origin: { x: 0, y: 0, z: 0 }, halfX: 1, halfZ: 1, height: 2, stillWhenReduced: false }],
            },
          },
        ],
      },
      { scene },
    );
    const mount = mountEngineBridge(fake.host);
    expect(mount.api.issues).toEqual([]);
    fake.advance(0.5);
    expect(named(scene, 'engine.sun')).toHaveLength(1);
    expect(named(scene, 'engine.ambient')).toHaveLength(1);
    expect(named(scene, 'engine.weather.').length).toBeGreaterThan(0);
    expect(named(scene, 'engine.particles.embers')).toHaveLength(1);
    mount.dispose();
    expect(count(scene)).toBe(0);
  });
});

describe('bridge live carry and launch', () => {
  it('carries the child with an engine platform it stands on, through the host', () => {
    const fake = fakeHost({ allowEnginePlatforms: true, capabilities: [platformsCap(lift)] });
    const host: LocationBridgeHost = { ...fake.host, ...fake.carryMembers };
    const mount = mountEngineBridge(host);
    expect(mount.api.support.carryLaunch).toBe(true);
    fake.player.supportId = 'engine:lift';
    fake.advance(1);
    const dx = fake.carries.reduce((sum, c) => sum + c[0], 0);
    expect(dx).toBeGreaterThan(1.5);
    expect(dx).toBeLessThan(2.5);
    fake.carries.length = 0;
    fake.player.supportId = 'ground';
    fake.advance(0.5);
    expect(fake.carries).toEqual([]);
    mount.dispose();
  });

  it('launches through the host when the child lands on a bounce platform', () => {
    const fake = fakeHost({ allowEnginePlatforms: true, capabilities: [platformsCap(bounce)] });
    const host: LocationBridgeHost = { ...fake.host, ...fake.carryMembers };
    const mount = mountEngineBridge(host);
    fake.player.position = { x: 20, y: 1.4, z: 0 };
    fake.player.supportId = 'engine:pad';
    fake.advance(0.2);
    expect(fake.launches).toEqual([2]);
    fake.advance(0.5);
    expect(fake.launches).toEqual([2]); // one bounce per landing
    mount.dispose();
  });

  it('warns HOST_CARRY_UNSUPPORTED without the members, and still never throws', () => {
    const fake = fakeHost({ allowEnginePlatforms: true, capabilities: [platformsCap(lift, bounce)] });
    const mount = mountEngineBridge(fake.host);
    expect(mount.api.support.carryLaunch).toBe(false);
    expect(mount.api.runtime!.diagnostics.snapshot().warnings.map((w) => w.code)).toContain('HOST_CARRY_UNSUPPORTED');
    fake.player.supportId = 'engine:lift';
    expect(() => fake.advance(0.5)).not.toThrow();
    mount.dispose();
  });
});

describe('bridge weather area (GE-L14, North Pole snow parity)', () => {
  const snow = (area?: JsonValue): JsonValue => ({ id: 'environment.weather', config: { initial: 'SNOW', ...(area ? { area } : {}) } });
  const worldExtentZ = (scene: Scene) => {
    let min = Infinity;
    let max = -Infinity;
    for (const object of named(scene, 'engine.weather.')) {
      const points = object as unknown as { position: { z: number }; geometry: { drawRange: { count: number }; getAttribute(name: string): { getZ(i: number): number } } };
      const attr = points.geometry.getAttribute('position');
      for (let i = 0; i < points.geometry.drawRange.count; i += 1) {
        const z = attr.getZ(i) + points.position.z;
        min = Math.min(min, z);
        max = Math.max(max, z);
      }
    }
    expect(Number.isFinite(min)).toBe(true); // snow is actually falling
    return { min, max };
  };

  it('FOLLOW_PLAYER keeps the snow round the child across a large Area', () => {
    const scene = new Scene();
    const fake = fakeHost({ capabilities: [snow({ mode: 'FOLLOW_PLAYER', halfX: 20, halfZ: 20, height: 12 })] }, { scene });
    const mount = mountEngineBridge(fake.host);
    expect(mount.api.issues).toEqual([]);
    fake.advance(1);
    fake.player.position.z = -84; // walked to Snowflake Mountain
    fake.advance(1);
    const { min, max } = worldExtentZ(scene);
    expect(min).toBeGreaterThanOrEqual(-84 - 20 - 1);
    expect(max).toBeLessThanOrEqual(-84 + 20 + 1);
    mount.dispose();
    expect(count(scene)).toBe(0);
  });

  it('by default the snow stays in its box round the start (unchanged)', () => {
    const scene = new Scene();
    const fake = fakeHost({ capabilities: [snow()] }, { scene });
    const mount = mountEngineBridge(fake.host);
    fake.advance(1);
    fake.player.position.z = -84;
    fake.advance(1);
    const { min, max } = worldExtentZ(scene);
    expect(min).toBeGreaterThanOrEqual(-26);
    expect(max).toBeLessThanOrEqual(26);
    mount.dispose();
  });

  it('refuses a malformed area', () => {
    const fake = fakeHost({ capabilities: [snow({ mode: 'FOLLOW_PLAYER', halfX: 500 })] });
    const mount = mountEngineBridge(fake.host);
    expect(mount.api.issues.length).toBeGreaterThan(0);
    mount.dispose();
  });
});

describe('bridge weather and particles follow the device render quality (GE-L14)', () => {
  // Heavy snow, so the tier budget (not the spawn rate) limits the flake count.
  const heavySnow = { id: 'SNOW', precipitation: { motion: 'FALL', ratePerSecond: 2000, fallSpeed: 0.5, size: 0.08 } };
  const caps = (particleTier?: string): JsonValue[] => [
    { id: 'environment.weather', config: { initial: 'SNOW', kinds: [heavySnow] } },
    {
      id: 'environment.particles',
      config: {
        ...(particleTier ? { tier: particleTier } : {}),
        emitters: [{ id: 'embers', motion: 'RISE', maxParticles: 400, ratePerSecond: 200, lifetime: 2, speed: 1, size: 0.1, color: 0xff6600, origin: { x: 0, y: 0, z: 0 }, halfX: 1, halfZ: 1, height: 2, stillWhenReduced: false }],
      },
    },
  ];
  const drawn = (scene: Scene, prefix: string) =>
    named(scene, prefix).reduce((sum, o) => sum + (o as unknown as { geometry: { drawRange: { count: number } } }).geometry.drawRange.count, 0);

  it('LOW quality draws no snow and no particles, as the Area atmosphere draws none', () => {
    const scene = new Scene();
    const fake = fakeHost({ capabilities: caps('HIGH') }, { scene, quality: 'LOW' });
    const mount = mountEngineBridge(fake.host);
    expect(mount.api.issues).toEqual([]);
    fake.advance(1);
    expect(drawn(scene, 'engine.weather.')).toBe(0);
    expect(drawn(scene, 'engine.particles.')).toBe(0);
    mount.dispose();
  });

  it('MEDIUM and HIGH draw snow; the device caps a higher seed tier but never raises a lower one', () => {
    const counts: Record<string, number> = {};
    for (const quality of ['MEDIUM', 'HIGH'] as const) {
      const scene = new Scene();
      const fake = fakeHost({ capabilities: caps('HIGH') }, { scene, quality });
      const mount = mountEngineBridge(fake.host);
      fake.advance(2);
      counts[quality] = drawn(scene, 'engine.weather.');
      mount.dispose();
    }
    expect(counts.MEDIUM).toBe(600); // the whole MEDIUM budget (GE-L14: unused kinds take none)
    expect(counts.HIGH).toBe(1200);
  });

  it('caps the particle tier in the capability request, and leaves it alone without a device quality', async () => {
    const { bridgeCapabilityRequests } = await import('./engineBridge');
    const tierOf = (deviceTier?: 'OFF' | 'MEDIUM' | 'HIGH', seed?: string) =>
      (bridgeCapabilityRequests({ capabilities: caps(seed) }, false, deviceTier).requests.find((r) => r.id === 'environment.particles')!.config as { tier?: string }).tier;
    expect(tierOf('OFF', 'HIGH')).toBe('OFF');
    expect(tierOf('MEDIUM', 'HIGH')).toBe('MEDIUM');
    expect(tierOf('HIGH', 'LOW')).toBe('LOW');
    expect(tierOf('HIGH')).toBe('MEDIUM');
    expect(tierOf(undefined, 'HIGH')).toBe('HIGH');
  });
});
