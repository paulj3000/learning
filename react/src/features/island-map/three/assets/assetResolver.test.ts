import { Group } from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { describe, expect, it, vi } from 'vitest';
import { createAssetLoader } from './assetLoader';
import { BUNDLED_ASSET_RESOLVER, resolveBundledAsset, type AssetResolver } from './assetResolver';
import { ASSET_MANIFEST } from './manifest';

/**
 * Engine Phase 10 (acceptance AS2): an asset id reaches a loader only
 * through an `AssetResolver`. These pin the seam itself; the real-file
 * round trips stay in `assetLoader.test.ts`.
 */

function fakeGltf(): GLTF {
  return { scene: new Group(), animations: [] } as unknown as GLTF;
}

describe('BUNDLED_ASSET_RESOLVER', () => {
  it('resolves every shipped id to its public/models file', async () => {
    for (const entry of ASSET_MANIFEST) {
      await expect(BUNDLED_ASSET_RESOLVER.resolve(entry.id)).resolves.toEqual({
        id: entry.id,
        url: entry.url,
        source: 'BUNDLED',
      });
    }
  });

  it('rejects, rather than throwing synchronously, for an id no catalogue knows', async () => {
    const pending = BUNDLED_ASSET_RESOLVER.resolve('does-not-exist');
    await expect(pending).rejects.toThrow(/unknown asset id/);
    expect(() => resolveBundledAsset('does-not-exist')).toThrow(/unknown asset id/);
  });
});

describe('createAssetLoader', () => {
  it('fetches whatever url the resolver returns, never the bundled one', async () => {
    const resolver: AssetResolver = {
      resolve: (id) =>
        Promise.resolve({ id, url: `https://cdn.example/${id}.glb`, source: 'PUBLISHED' }),
    };
    const fetchGltf = vi.fn(() => Promise.resolve(fakeGltf()));
    const loader = createAssetLoader(resolver, fetchGltf);

    await loader.loadAsset('rock');

    expect(fetchGltf).toHaveBeenCalledWith('https://cdn.example/rock.glb');
  });

  it('resolves and fetches each id once, however many times it is placed', async () => {
    const resolve = vi.fn(BUNDLED_ASSET_RESOLVER.resolve);
    const fetchGltf = vi.fn(() => Promise.resolve(fakeGltf()));
    const loader = createAssetLoader({ resolve }, fetchGltf);

    const [first, second] = await Promise.all([loader.loadAsset('rock'), loader.loadAsset('rock')]);
    await loader.instantiateAsset('rock');

    expect(second).toBe(first);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(fetchGltf).toHaveBeenCalledTimes(1);
  });

  it('rejects for an id the resolver refuses, without fetching anything', async () => {
    const fetchGltf = vi.fn(() => Promise.resolve(fakeGltf()));
    const loader = createAssetLoader(BUNDLED_ASSET_RESOLVER, fetchGltf);

    await expect(loader.loadAsset('does-not-exist')).rejects.toThrow(/unknown asset id/);
    expect(fetchGltf).not.toHaveBeenCalled();
  });

  it('loads both halves of an LOD pair through the same resolver', async () => {
    const resolve = vi.fn(BUNDLED_ASSET_RESOLVER.resolve);
    const loader = createAssetLoader({ resolve }, () => Promise.resolve(fakeGltf()));

    await loader.instantiateWithLod('foliage-tree');

    expect(resolve.mock.calls.map(([id]) => id).sort()).toEqual([
      'foliage-tree',
      'foliage-tree-lod1',
    ]);
  });
});
