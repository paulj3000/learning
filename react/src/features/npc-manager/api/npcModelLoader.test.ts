import {
  AnimationClip,
  Bone,
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Skeleton,
  SkinnedMesh,
} from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { describe, expect, it, vi } from 'vitest';
import type { NpcSpawn } from '../contracts/engine';
import { NpcModelLoadError, createNpcRuntime } from '../engine/createNpcRuntime';
import { createNpcModelCache } from '../engine/npcModelCache';
import { npcModelLoaderFrom, withBundledIdFallback } from './npcModelLoader';

function gltf(): GLTF {
  const scene = new Group();
  scene.add(new Mesh());
  return { scene, animations: [new AnimationClip('Idle', 1, [])] } as unknown as GLTF;
}

describe('npc model loader', () => {
  it('asks for assetId@version and returns a clone sharing the cached geometry', async () => {
    const source = gltf();
    const loadAsset = vi.fn(async (id: string) => {
      void id;
      return source;
    });
    const load = npcModelLoaderFrom({ loadAsset });
    const first = await load({ assetId: 'npc-pip', version: 3 }, new AbortController().signal);
    const second = await load({ assetId: 'npc-pip', version: null }, new AbortController().signal);
    expect(loadAsset.mock.calls.map((c) => c[0])).toEqual(['npc-pip@3', 'npc-pip']);
    expect(first.scene).not.toBe(source.scene);
    expect(first.scene).not.toBe(second.scene);
    expect((first.scene.children[0] as Mesh).geometry).toBe(
      (source.scene.children[0] as Mesh).geometry,
    );
    expect(first.animations[0].name).toBe('Idle');
  });

  it('reports a failed load as model_unavailable', async () => {
    const load = npcModelLoaderFrom({ loadAsset: () => Promise.reject(new Error('404')) });
    await expect(
      load({ assetId: 'gone', version: null }, new AbortController().signal),
    ).rejects.toMatchObject({ reason: 'model_unavailable' });
  });

  it('stops waiting when aborted', async () => {
    const load = npcModelLoaderFrom({ loadAsset: () => new Promise<GLTF>(() => undefined) });
    const abort = new AbortController();
    const pending = load({ assetId: 'slow', version: null }, abort.signal);
    abort.abort();
    await expect(pending).rejects.toBeInstanceOf(NpcModelLoadError);
    await expect(pending).rejects.toMatchObject({ reason: 'aborted' });
  });
});

function skinnedGltf() {
  const bone = new Bone();
  const skeleton = new Skeleton([bone]);
  const geometry = new BoxGeometry();
  const mesh = new SkinnedMesh(geometry, new MeshStandardMaterial());
  mesh.add(bone);
  mesh.bind(skeleton);
  const scene = new Group();
  scene.add(mesh);
  return { gltf: { scene, animations: [] } as unknown as GLTF, skeleton, geometry };
}

function spawnOf(key: string, assetId: string, version: number | null = 1): NpcSpawn {
  return {
    placement: {
      placementKey: key,
      npcId: 'pip',
      variant: 'classic',
      behavior: null,
      position: { x: 0, y: 0, z: 0 },
      rotationY: 0,
      scale: 1,
      interactionRadius: 2,
    },
    character: {
      npcId: 'pip',
      displayName: 'Pip',
      role: 'QUEST_GIVER',
      ageBands: [],
      personality: {},
      dialogueMode: 'AUTHORED',
      voiceProfile: null,
      defaultVariant: 'classic',
      variants: [
        {
          variantKey: 'classic',
          displayName: 'Classic',
          model: { assetId, version },
          portrait: null,
          scale: 1,
          rotationOffsetY: 0,
          positionOffsetY: 0,
          animationMap: {},
          extras: [],
        },
      ],
    },
  } as NpcSpawn;
}

async function flush() {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

describe('shared model cache (LAI-NPC-037)', () => {
  it('loads each asset version once across 20 NPCs, remounts and new runtimes', async () => {
    const loadAsset = vi.fn(async (id: string) => {
      void id;
      return gltf();
    });
    const cache = createNpcModelCache<GLTF>({ capacity: 4, ownsSources: true });
    const load = npcModelLoaderFrom({ loadAsset }, { cache, scope: 'child-1' });
    const spawns = Array.from({ length: 20 }, (_, i) =>
      spawnOf(`npc-${i}`, i % 2 === 0 ? 'npc-pip' : 'npc-gull'),
    );
    const first = createNpcRuntime({
      parent: new Group(),
      loadModel: load,
      reducedMotion: () => false,
    });
    first.mount(spawns);
    await flush();
    first.mount(spawns); // unchanged: nothing rebuilt or reloaded
    first.mount([...spawns, spawnOf('npc-20', 'npc-pip', 2)]);
    await flush();
    first.dispose();
    const second = createNpcRuntime({
      parent: new Group(),
      loadModel: load,
      reducedMotion: () => false,
    });
    second.mount(spawns);
    await flush();
    expect(loadAsset.mock.calls.map((c) => c[0]).sort()).toEqual([
      'npc-gull@1',
      'npc-pip@1',
      'npc-pip@2',
    ]);
    expect(cache.stats()).toMatchObject({ loads: 3, inUse: 2 });
    second.dispose();
    expect(cache.stats().inUse).toBe(0);
  });

  it('keeps different scopes apart', async () => {
    const loadAsset = vi.fn(async () => gltf());
    const cache = createNpcModelCache<GLTF>();
    const signal = new AbortController().signal;
    const ref = { assetId: 'npc-pip', version: 1 };
    await npcModelLoaderFrom({ loadAsset }, { cache, scope: 'child-1' })(ref, signal);
    await npcModelLoaderFrom({ loadAsset }, { cache, scope: 'child-2' })(ref, signal);
    expect(loadAsset).toHaveBeenCalledTimes(2);
  });

  it('release disposes the clone-owned skeleton once and never the shared source', async () => {
    const source = skinnedGltf();
    const sourceSkeleton = vi.spyOn(source.skeleton, 'dispose');
    const geometry = vi.spyOn(source.geometry, 'dispose');
    const cache = createNpcModelCache<GLTF>({ capacity: 1, ownsSources: true });
    const load = npcModelLoaderFrom({ loadAsset: async () => source.gltf }, { cache });
    const model = await load({ assetId: 'rigged', version: 1 }, new AbortController().signal);
    const owned = (model.scene.children[0] as SkinnedMesh).skeleton;
    expect(owned).not.toBe(source.skeleton);
    const ownedDispose = vi.spyOn(owned, 'dispose');
    model.release?.();
    model.release?.();
    expect(ownedDispose).toHaveBeenCalledTimes(1);
    expect(sourceSkeleton).not.toHaveBeenCalled();
    expect(geometry).not.toHaveBeenCalled(); // idle but within capacity: still cached
    expect(cache.stats()).toMatchObject({ entries: 1, inUse: 0 });
  });

  it('an abandoned wait returns its lease', async () => {
    const cache = createNpcModelCache<GLTF>();
    const load = npcModelLoaderFrom(
      { loadAsset: () => new Promise<GLTF>(() => undefined) },
      { cache },
    );
    const abort = new AbortController();
    const pending = load({ assetId: 'slow', version: 1 }, abort.signal);
    await flush();
    expect(cache.stats().inUse).toBe(1);
    abort.abort();
    await expect(pending).rejects.toMatchObject({ reason: 'aborted' });
    expect(cache.stats().inUse).toBe(0);
  });
});

describe('bundled id fallback', () => {
  const asset = (id: string) => ({ id, url: `/models/${id}.glb`, source: 'BUNDLED' as const });

  it('uses the primary answer when there is one', async () => {
    const primary = {
      resolve: vi.fn(async (id: string) => ({ ...asset(id), url: 'https://x/a' })),
    };
    const bundled = { resolve: vi.fn(async (id: string) => asset(id)) };
    const resolved = await withBundledIdFallback(primary, bundled).resolve('npc-pip@3');
    expect(resolved.url).toBe('https://x/a');
    expect(bundled.resolve).not.toHaveBeenCalled();
  });

  it('retries a pinned ref as its bare id through the bundled catalogue', async () => {
    const primary = { resolve: vi.fn(() => Promise.reject(new Error('unknown npc-pip@3'))) };
    const bundled = { resolve: vi.fn(async (id: string) => asset(id)) };
    const resolved = await withBundledIdFallback(primary, bundled).resolve('npc-pip@3', 'model');
    expect(bundled.resolve).toHaveBeenCalledWith('npc-pip', 'model');
    expect(resolved.url).toBe('/models/npc-pip.glb');
  });

  it('keeps the failure for a bare id', async () => {
    const primary = { resolve: () => Promise.reject(new Error('unknown')) };
    const bundled = { resolve: vi.fn(async (id: string) => asset(id)) };
    await expect(withBundledIdFallback(primary, bundled).resolve('npc-pip')).rejects.toThrow(
      'unknown',
    );
    expect(bundled.resolve).not.toHaveBeenCalled();
  });
});
