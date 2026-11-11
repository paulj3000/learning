import {
  Bone,
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Skeleton,
  SkinnedMesh,
  Texture,
} from 'three';
import { describe, expect, it, vi } from 'vitest';
import { createNpcModelCache, disposeObjectResources, ownedSkeletons } from './npcModelCache';

function source() {
  const scene = new Group();
  const geometry = new BoxGeometry();
  const texture = new Texture();
  const material = new MeshStandardMaterial({ map: texture });
  // Two meshes share one geometry and material: still disposed once each.
  scene.add(new Mesh(geometry, material), new Mesh(geometry, material));
  return {
    model: { scene, animations: [] },
    spies: {
      geometry: vi.spyOn(geometry, 'dispose'),
      material: vi.spyOn(material, 'dispose'),
      texture: vi.spyOn(texture, 'dispose'),
    },
  };
}

async function flush() {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

describe('npc model cache', () => {
  it('loads each key once for every lease, loading or loaded', async () => {
    const cache = createNpcModelCache();
    const load = vi.fn(async () => source().model);
    const leases = Array.from({ length: 20 }, () => cache.acquire('npc-pip@3', load));
    const models = await Promise.all(leases.map((lease) => lease.promise));
    expect(load).toHaveBeenCalledTimes(1);
    expect(new Set(models).size).toBe(1);
    await cache.acquire('npc-pip@3', load).promise;
    expect(load).toHaveBeenCalledTimes(1);
    expect(cache.stats()).toMatchObject({ loads: 1, hits: 20, entries: 1, inUse: 1 });
  });

  it('keeps released sources warm up to capacity, then evicts the least recently used', async () => {
    const cache = createNpcModelCache({ capacity: 1, ownsSources: true });
    const a = source();
    const b = source();
    const leaseA = cache.acquire('a', async () => a.model);
    const leaseB = cache.acquire('b', async () => b.model);
    await Promise.all([leaseA.promise, leaseB.promise]);
    leaseA.release();
    leaseA.release(); // idempotent
    expect(cache.stats()).toMatchObject({ entries: 2, evictions: 0 });
    leaseB.release();
    // Two idle, capacity one: the older (a) goes and is disposed exactly once.
    expect(cache.stats()).toMatchObject({ entries: 1, evictions: 1, inUse: 0 });
    expect(a.spies.geometry).toHaveBeenCalledTimes(1);
    expect(a.spies.material).toHaveBeenCalledTimes(1);
    expect(a.spies.texture).toHaveBeenCalledTimes(1);
    expect(b.spies.geometry).not.toHaveBeenCalled();
    // b is still warm: no new load.
    const load = vi.fn(async () => source().model);
    await cache.acquire('b', load).promise;
    expect(load).not.toHaveBeenCalled();
  });

  it('never evicts or disposes a source in use', async () => {
    const cache = createNpcModelCache({ capacity: 0, ownsSources: true });
    const a = source();
    const lease = cache.acquire('a', async () => a.model);
    await lease.promise;
    cache.trimIdle();
    expect(cache.stats()).toMatchObject({ entries: 1, inUse: 1 });
    expect(a.spies.geometry).not.toHaveBeenCalled();
    lease.release();
    expect(cache.stats().entries).toBe(0);
    expect(a.spies.geometry).toHaveBeenCalledTimes(1);
  });

  it('does not dispose sources it does not own', async () => {
    const cache = createNpcModelCache({ capacity: 0 });
    const a = source();
    const lease = cache.acquire('a', async () => a.model);
    await lease.promise;
    lease.release();
    expect(cache.stats()).toMatchObject({ entries: 0, evictions: 1 });
    expect(a.spies.geometry).not.toHaveBeenCalled();
  });

  it('a load released before it settles goes idle once it arrives', async () => {
    const cache = createNpcModelCache({ capacity: 0, ownsSources: true });
    const a = source();
    let resolve!: (value: typeof a.model) => void;
    const lease = cache.acquire('a', () => new Promise((r) => (resolve = r)));
    lease.release();
    expect(cache.stats().entries).toBe(1);
    await flush();
    resolve(a.model);
    await flush();
    expect(cache.stats().entries).toBe(0);
    expect(a.spies.geometry).toHaveBeenCalledTimes(1);
  });

  it('forgets a failed load so the next acquire retries', async () => {
    const cache = createNpcModelCache();
    const fail = vi.fn(() => Promise.reject(new Error('404')));
    await expect(cache.acquire('a', fail).promise).rejects.toThrow('404');
    const ok = vi.fn(async () => source().model);
    await cache.acquire('a', ok).promise;
    expect(ok).toHaveBeenCalledTimes(1);
    expect(cache.stats().loads).toBe(2);
  });
});

describe('resource helpers', () => {
  function skinned() {
    const bone = new Bone();
    const skeleton = new Skeleton([bone]);
    const mesh = new SkinnedMesh(new BoxGeometry(), new MeshStandardMaterial());
    mesh.add(bone);
    mesh.bind(skeleton);
    const root = new Group();
    root.add(mesh);
    return { root, skeleton };
  }

  it('finds the skeletons a clone owns and not the shared ones', () => {
    const a = skinned();
    const b = skinned();
    const clone = new Group();
    clone.add(b.root, new SkinnedMesh(new BoxGeometry(), new MeshStandardMaterial()));
    (clone.children[1] as SkinnedMesh).bind(a.skeleton);
    expect(ownedSkeletons(clone, a.root)).toEqual([b.skeleton]);
  });

  it('disposes a skeleton with the rest of an owned source', () => {
    const { root, skeleton } = skinned();
    const dispose = vi.spyOn(skeleton, 'dispose');
    disposeObjectResources(root);
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
