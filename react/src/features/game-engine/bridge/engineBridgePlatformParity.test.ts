import { Box3, BoxGeometry, Group, Mesh, MeshStandardMaterial, Scene, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import type { JsonValue } from '../../island-map/three/runtime/locationManifest';
import { WorldEngineEventBus } from '../../island-map/three/worldEngineEvents';
import type { LocationBridgeHost } from './bridgeHost';
import { bridgeCapabilityRequests, mountEngineBridge } from './engineBridge';

/** GE-068: staff tuning, look, safe ground and inspection for engine platforms, against a fake host. */
function fakeHost(config: { [key: string]: JsonValue }, extras: Partial<LocationBridgeHost> = {}) {
  const frames = new Set<(dt: number) => void>();
  const host: LocationBridgeHost = {
    bus: new WorldEngineEventBus(),
    config,
    reducedMotion: false,
    addCollider: (_box: Box3, options = {}) => options.id ?? 'x',
    removeCollider: () => true,
    playerPosition: () => ({ x: 0, z: 0 }),
    teleportPlayer() {},
    onFrame(callback) {
      frames.add(callback);
      return () => frames.delete(callback);
    },
    ...extras,
  };
  return {
    host,
    advance(seconds: number) {
      for (let t = 0; t < seconds - 1e-9; t += 1 / 60) for (const frame of [...frames]) frame(1 / 60);
    },
  };
}

const size = { x: 3, y: 0.4, z: 3 };
const lift = { id: 'lift', position: { x: 0, y: 1, z: 0 }, size, route: 'OPTIONAL', moving: { path: [{ x: 4, y: 0, z: 0 }], mode: 'PING_PONG', speed: 1, pauseSeconds: 0 } };
const crumble = { id: 'crumble', position: { x: 10, y: 1, z: 0 }, size, route: 'OPTIONAL', falling: { mode: 'TIMED', visibleSeconds: 3, hiddenSeconds: 2, warningSeconds: 1 } };
const pad = { id: 'pad', position: { x: 20, y: 1, z: 0 }, size, bounceHeight: 2 };
const dock = { id: 'dock', position: { x: 30, y: 1, z: 0 }, size };
const turntable = { id: 'turn', position: { x: 40, y: 1, z: 0 }, size, spinDegreesPerSecond: 20 };
const cap = (...platforms: JsonValue[]): JsonValue => ({ id: 'gameplay.platforms', config: { platforms } });
const base = { allowEnginePlatforms: true };

describe('bridge staff tuning for engine platforms', () => {
  it('hands scene tuning to the platforms capability, which applies it', () => {
    const slow = fakeHost({ ...base, capabilities: [cap(lift)] });
    const tuned = fakeHost({ ...base, capabilities: [cap(lift)], platformTuning: { lift: { speed: 4 } } });
    const a = mountEngineBridge(slow.host);
    const b = mountEngineBridge(tuned.host);
    slow.advance(0.5);
    tuned.advance(0.5);
    const x = (m: typeof a) => m.api.platforms().find((p) => p.id === 'lift')!.position.x;
    expect(x(a)).toBeCloseTo(0.5, 1);
    expect(x(b)).toBeCloseTo(2, 1);
    a.dispose();
    b.dispose();
  });

  it('leaves out a disabled platform, and keeps existing data without tuning unchanged', () => {
    const fake = fakeHost({ ...base, capabilities: [cap(lift, dock)], platformTuning: { lift: { enabled: false } } });
    const mount = mountEngineBridge(fake.host);
    expect(mount.api.platforms().map((p) => p.id)).toEqual(['dock']);
    mount.dispose();
    const plain = mountEngineBridge(fakeHost({ ...base, capabilities: [cap(lift, dock)] }).host);
    expect(plain.api.platforms().map((p) => p.id)).toEqual(['lift', 'dock']);
    plain.dispose();
  });

  it('ignores invalid tuning (as authored) and tuning for unknown ids', () => {
    const fake = fakeHost({ ...base, capabilities: [cap(lift)], platformTuning: { lift: { speed: 99 }, ghost: { speed: 2 } } });
    const mount = mountEngineBridge(fake.host);
    fake.advance(0.5);
    expect(mount.api.issues).toEqual([]);
    expect(mount.api.platforms()[0]!.position.x).toBeCloseTo(0.5, 1);
    mount.dispose();
  });

  it('only adds platformTuning to the platforms request, and the platforms own config wins', () => {
    const tuning = { lift: { speed: 3 } };
    const out = bridgeCapabilityRequests({ capabilities: [cap(lift), { id: 'gameplay.checkpoints', config: {} }], platformTuning: tuning }, true);
    expect(out.requests[0]).toEqual({ id: 'gameplay.platforms', config: { platformTuning: tuning, platforms: [lift] } });
    expect(out.requests[1]).toEqual({ id: 'gameplay.checkpoints', config: {} });
    const own = bridgeCapabilityRequests({ capabilities: [{ id: 'gameplay.platforms', config: { platforms: [lift], platformTuning: { lift: { speed: 1 } } } }], platformTuning: tuning }, true);
    expect(own.requests[0]!.config).toMatchObject({ platformTuning: { lift: { speed: 1 } } });
  });
});

describe('bridge api.platforms and api.isSafeGround', () => {
  it('lists every engine platform with phase, current top position, size and kind', () => {
    const fake = fakeHost({ ...base, capabilities: [cap(lift, crumble, pad, dock, turntable)] });
    const mount = mountEngineBridge(fake.host);
    const list = mount.api.platforms();
    expect(list.map((p) => [p.id, p.kind])).toEqual([
      ['lift', 'moving'],
      ['crumble', 'falling'],
      ['pad', 'bounce'],
      ['dock', 'static'],
      ['turn', 'rotating'],
    ]);
    expect(list[3]).toEqual({ id: 'dock', phase: 'STABLE', position: { x: 30, y: 1.4, z: 0 }, size, kind: 'static' });
    fake.advance(2.5);
    expect(mount.api.platforms()[1]!.phase).toBe('CRUMBLING');
    mount.dispose();
  });

  it('is false on moving, rotating, falling and bounce tops, true elsewhere', () => {
    const fake = fakeHost({ ...base, capabilities: [cap(lift, crumble, pad, dock, turntable)] });
    const mount = mountEngineBridge(fake.host);
    for (const x of [0, 10, 20, 40]) expect(mount.api.isSafeGround(x, 1.4, 0)).toBe(false);
    expect(mount.api.isSafeGround(30, 1.4, 0)).toBe(true);
    expect(mount.api.isSafeGround(0, 4, 0)).toBe(true);
    mount.dispose();
  });

  it('is all true and empty with no engine platforms, and on a refused bridge', () => {
    const none = mountEngineBridge(fakeHost({ capabilities: [] }).host);
    expect(none.api.isSafeGround(0, 0, 0)).toBe(true);
    expect(none.api.platforms()).toEqual([]);
    none.dispose();
    const refused = mountEngineBridge(fakeHost({ capabilities: [cap(lift)] }).host);
    expect(refused.api.issues.length).toBeGreaterThan(0);
    expect(refused.api.isSafeGround(0, 1.4, 0)).toBe(true);
    expect(refused.api.platforms()).toEqual([]);
    refused.dispose();
  });
});

describe('bridge platform look', () => {
  const platformMesh = (scene: Scene, id: string) => scene.getObjectByName(`engine.platform.${id}`) as Mesh;
  const model = (): { scene: Object3D } => {
    const group = new Group();
    group.add(new Mesh(new BoxGeometry(2, 1, 4), new MeshStandardMaterial({ color: 0x336699 })));
    return { scene: group };
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('colours the box from color, else the default', () => {
    const scene = new Scene();
    const fake = fakeHost({ ...base, capabilities: [cap({ ...dock, color: 0x112233 }, { ...pad, id: 'plain' })] }, { scene });
    const mount = mountEngineBridge(fake.host);
    expect((platformMesh(scene, 'dock').material as MeshStandardMaterial).color.getHex()).toBe(0x112233);
    expect((platformMesh(scene, 'plain').material as MeshStandardMaterial).color.getHex()).toBe(0xc9a46a);
    mount.dispose();
  });

  it('rejects a bad color or asset id through validation', () => {
    const mount = mountEngineBridge(fakeHost({ ...base, capabilities: [cap({ ...dock, color: -5 })] }).host);
    expect(mount.api.issues.length).toBeGreaterThan(0);
    mount.dispose();
  });

  it('shows the coloured box while the model loads, then the model fitted to the box', async () => {
    const scene = new Scene();
    let resolve!: (m: { scene: Object3D }) => void;
    const loadModel = () => new Promise<{ scene: Object3D }>((r) => (resolve = r));
    const fake = fakeHost({ ...base, capabilities: [cap({ ...dock, assetId: 'plank' })] }, { scene, loadModel });
    const mount = mountEngineBridge(fake.host);
    fake.advance(0.1);
    const mesh = platformMesh(scene, 'dock');
    expect(mesh.visible).toBe(true);
    expect((mesh.material as MeshStandardMaterial).visible).toBe(true);
    expect(mesh.children).toHaveLength(0);
    resolve(model());
    await settle();
    expect(mesh.children).toHaveLength(1);
    expect((mesh.material as MeshStandardMaterial).visible).toBe(false);
    const fitted = new Box3().setFromObject(mesh.children[0]!);
    expect(fitted.max.x - fitted.min.x).toBeCloseTo(3, 5);
    expect(fitted.max.y - fitted.min.y).toBeCloseTo(0.4, 5);
    expect(fitted.max.z - fitted.min.z).toBeCloseTo(3, 5);
    mount.dispose();
    expect(scene.children).toHaveLength(0);
  });

  it('keeps the coloured box when the model fails to load, and warns', async () => {
    const scene = new Scene();
    const fake = fakeHost({ ...base, capabilities: [cap({ ...dock, assetId: 'plank', color: 0x445566 })] }, { scene, loadModel: () => Promise.reject(new Error('404')) });
    const mount = mountEngineBridge(fake.host);
    await settle();
    fake.advance(0.1);
    const mesh = platformMesh(scene, 'dock');
    expect(mesh.children).toHaveLength(0);
    expect((mesh.material as MeshStandardMaterial).visible).toBe(true);
    expect((mesh.material as MeshStandardMaterial).color.getHex()).toBe(0x445566);
    expect(mount.api.runtime!.diagnostics.snapshot().warnings.map((w) => w.code)).toContain('PLATFORM_ASSET_FAILED');
    mount.dispose();
  });

  it('ignores a model that arrives after disposal, and never touches the shared asset', async () => {
    const scene = new Scene();
    const shared = model();
    const sharedMaterial = ((shared.scene as Group).children[0] as Mesh).material as MeshStandardMaterial;
    let resolve!: (m: { scene: Object3D }) => void;
    const fake = fakeHost({ ...base, capabilities: [cap({ ...dock, assetId: 'plank' }, { ...crumble, assetId: 'plank' })] }, { scene, loadModel: () => new Promise((r) => (resolve = r)) });
    const mount = mountEngineBridge(fake.host);
    mount.dispose();
    resolve(shared);
    await settle();
    expect(scene.children).toHaveLength(0);
    expect(sharedMaterial.opacity).toBe(1);
  });

  it('the model blinks with the crumble warning (own materials) and holds dim under reduced motion', async () => {
    const run = async (reducedMotion: boolean) => {
      const scene = new Scene();
      const shared = model();
      const fake = fakeHost({ ...base, capabilities: [cap({ ...crumble, assetId: 'plank' })] }, { scene, reducedMotion, loadModel: async () => shared });
      const mount = mountEngineBridge(fake.host);
      await settle();
      let inner!: Mesh;
      platformMesh(scene, 'crumble').children[0]!.traverse((o) => {
        if ((o as Mesh).isMesh) inner = o as Mesh;
      });
      const seen = new Set<number>();
      for (let i = 0; i < 4 * 60; i += 1) {
        fake.advance(1 / 60);
        seen.add(Number((inner.material as MeshStandardMaterial).opacity.toFixed(2)));
      }
      mount.dispose();
      expect(((shared.scene as Group).children[0] as Mesh).material).not.toBe(inner.material);
      return seen;
    };
    const blink = await run(false);
    expect(blink.has(1) && blink.has(0.5)).toBe(true);
    const steady = await run(true);
    expect(steady.has(0.5)).toBe(true);
    expect([...steady].every((o) => o === 1 || o === 0.5)).toBe(true);
  });
});
