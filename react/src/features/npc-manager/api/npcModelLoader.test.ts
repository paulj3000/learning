import { AnimationClip, Group, Mesh } from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { describe, expect, it, vi } from 'vitest';
import { NpcModelLoadError } from '../engine/createNpcRuntime';
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
