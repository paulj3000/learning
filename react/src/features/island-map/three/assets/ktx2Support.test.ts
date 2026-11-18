import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { engineAssetsFrom } from '../../../region-play/regionAssets';
import { createAssetLoader, createGltfFetcher, enableKtx2Textures } from './assetLoader';
import { resolveBundledAsset, type AssetResolver } from './assetResolver';
import {
  attachKtx2Renderer,
  beginParse,
  currentKtx2Loader,
  ktx2Status,
  resetKtx2ForTests,
} from './ktx2Support';

/**
 * The app-wide KTX2 loader (ADR-070 review fix): one, renderer-bound, reference counted, used
 * by every game `GLTFLoader`, and never disposed while a parse is in flight.
 */

function fakeKtx2(): KTX2Loader & { dispose: ReturnType<typeof vi.fn> } {
  return { dispose: vi.fn() } as unknown as KTX2Loader & { dispose: ReturnType<typeof vi.fn> };
}

let created: ReturnType<typeof fakeKtx2>[];

beforeEach(() => {
  created = [];
  resetKtx2ForTests(() => {
    const loader = fakeKtx2();
    created.push(loader);
    return loader;
  });
});

afterEach(() => {
  resetKtx2ForTests();
  vi.restoreAllMocks();
});

/** A "published" resolver: a Django-style URL for every id (here a blob of a real GLB). */
function publishedResolver(): AssetResolver {
  // A real model file the test fetch polyfill serves, presented as a Django resolution.
  const url = resolveBundledAsset('wall').url;
  return { resolve: async (id) => ({ id, url, source: 'DJANGO' }) as never };
}

describe('the shared KTX2 loader', () => {
  it('is created once for the first renderer and counted for the next ones', () => {
    const one = attachKtx2Renderer({});
    const two = attachKtx2Renderer({});
    expect(created).toHaveLength(1);
    expect(ktx2Status()).toMatchObject({ attached: true, refs: 2 });
    one();
    one(); // idempotent
    expect(ktx2Status()).toMatchObject({ attached: true, refs: 1 });
    expect(created[0]!.dispose).not.toHaveBeenCalled();
    two();
    expect(currentKtx2Loader()).toBeNull();
    expect(created[0]!.dispose).toHaveBeenCalledTimes(1);
  });

  it('is never disposed while a parse is in flight', () => {
    const detach = attachKtx2Renderer({});
    const endParse = beginParse();
    detach();
    expect(currentKtx2Loader()).toBeNull(); // no new load gets it
    expect(created[0]!.dispose).not.toHaveBeenCalled(); // the running parse keeps its workers
    expect(ktx2Status()).toMatchObject({ inFlight: 1, retiring: 1 });
    endParse();
    endParse(); // idempotent
    expect(created[0]!.dispose).toHaveBeenCalledTimes(1);
    expect(ktx2Status()).toMatchObject({ inFlight: 0, retiring: 0 });
  });

  it('a new attachment after the last detach creates a fresh loader', () => {
    attachKtx2Renderer({})();
    attachKtx2Renderer({});
    expect(created).toHaveLength(2);
    expect(currentKtx2Loader()).toBe(created[1]);
  });
});

describe('every game loader gets it', () => {
  it('a published-resolver load (region play) registers the shared KTX2 loader', async () => {
    const set = vi.spyOn(GLTFLoader.prototype, 'setKTX2Loader');
    const assets = engineAssetsFrom(createAssetLoader(publishedResolver()));
    const detach = assets.attachRenderer!({});
    await assets.loadModel('pirate-captain');
    expect(set).toHaveBeenCalledWith(created[0]);
    detach();
  });

  it('a single-use loader (the NPC loader path) created after the attachment gets it too', async () => {
    const detach = enableKtx2Textures({});
    const set = vi.spyOn(GLTFLoader.prototype, 'setKTX2Loader');
    await createAssetLoader(publishedResolver()).loadAsset('npc-pip');
    expect(set).toHaveBeenLastCalledWith(created[0]);
    detach();
  });

  it('with no renderer attached, loaders get no KTX2 loader', async () => {
    const set = vi.spyOn(GLTFLoader.prototype, 'setKTX2Loader');
    await createAssetLoader(publishedResolver()).loadAsset('npc-pip');
    expect(set).toHaveBeenLastCalledWith(null);
  });

  it('a successful load ends its parse, so a pending disposal runs', async () => {
    const detach = attachKtx2Renderer({});
    const loading = createAssetLoader(publishedResolver()).loadAsset('npc-pip');
    detach();
    await loading;
    expect(ktx2Status().inFlight).toBe(0);
    expect(created[0]!.dispose).toHaveBeenCalledTimes(1);
  });
});

describe('never-settling loads', () => {
  it('time out, are evicted from the cache and can be retried', async () => {
    const loader = new GLTFLoader();
    const load = vi.spyOn(loader, 'load').mockImplementation(() => undefined); // never settles
    const assets = createAssetLoader(
      publishedResolver(),
      createGltfFetcher(loader, { timeoutMs: 10 }),
    );
    await expect(assets.loadAsset('stuck')).rejects.toThrow(/did not finish within 10 ms/);
    await expect(assets.loadAsset('stuck')).rejects.toThrow(/did not finish/);
    expect(load).toHaveBeenCalledTimes(2); // evicted, then fetched again
  });

  it('keeps the parse counted until the underlying load really settles', async () => {
    const loader = new GLTFLoader();
    let finish: ((gltf: GLTF) => void) | undefined;
    vi.spyOn(loader, 'load').mockImplementation((_url, onLoad) => {
      finish = onLoad;
    });
    const detach = attachKtx2Renderer({});
    const fetchGltf = createGltfFetcher(loader, { timeoutMs: 10 });
    await expect(fetchGltf('blob:x')).rejects.toThrow(/did not finish/);
    detach();
    expect(created[0]!.dispose).not.toHaveBeenCalled(); // the parse may still use the workers
    finish!({} as GLTF);
    expect(created[0]!.dispose).toHaveBeenCalledTimes(1);
  });
});
