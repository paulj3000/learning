import { Group } from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createAssetLoader,
  type AssetLoadEvent,
  type ByteProgressCallback,
  type GltfFetcher,
} from './assetLoader';
import type { AssetResolver } from './assetResolver';

/**
 * LAI-2106: the loader's cache and progress contract, driven through
 * `createAssetLoader` with an injected fetcher so every load can be held
 * open, failed, or fed byte counts on demand.
 */

const resolver: AssetResolver = {
  resolve: (id) => Promise.resolve({ id, url: `/test/${id}.glb`, source: 'BUNDLED' }),
};

function fakeGltf(name: string): GLTF {
  const scene = new Group();
  scene.name = name;
  return { scene, animations: [] } as unknown as GLTF;
}

interface HeldFetch {
  url: string;
  onBytes: ByteProgressCallback | undefined;
  succeed(gltf?: GLTF): void;
  fail(error?: unknown): void;
}

/** A fetcher whose every call stays pending until the test settles it. */
function heldFetcher() {
  const calls: HeldFetch[] = [];
  const fetchGltf = vi.fn<GltfFetcher>(
    (url, onBytes) =>
      new Promise<GLTF>((resolve, reject) => {
        calls.push({
          url,
          onBytes,
          succeed: (gltf = fakeGltf(url)) => resolve(gltf),
          fail: (error = new Error(`could not fetch ${url}`)) => reject(error),
        });
      }),
  );
  return { fetchGltf, calls };
}

/** Lets the resolver's and loader's promise chains reach the fetcher. */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  warn.mockRestore();
});

describe('asset cache: success and sharing', () => {
  it('caches a successful load: later requests get the same result without fetching again', async () => {
    const { fetchGltf, calls } = heldFetcher();
    const loader = createAssetLoader(resolver, fetchGltf);
    const first = loader.loadAsset('rock');
    await flush();
    calls[0]!.succeed();

    const gltf = await first;
    expect(await loader.loadAsset('rock')).toBe(gltf);
    expect(fetchGltf).toHaveBeenCalledTimes(1);
  });

  it('shares one in-flight load between concurrent requests', async () => {
    const { fetchGltf, calls } = heldFetcher();
    const loader = createAssetLoader(resolver, fetchGltf);
    const requests = [
      loader.loadAsset('rock'),
      loader.loadAsset('rock'),
      loader.instantiateAsset('rock'),
    ];
    await flush();
    expect(fetchGltf).toHaveBeenCalledTimes(1);

    calls[0]!.succeed();
    const [a, b, instance] = await Promise.all(requests);
    expect(b).toBe(a);
    expect(instance).not.toBe((a as GLTF).scene);
  });
});

describe('asset cache: failure recovery', () => {
  it('rejects a failed load with the fetcher’s error', async () => {
    const { fetchGltf, calls } = heldFetcher();
    const loader = createAssetLoader(resolver, fetchGltf);
    const pending = loader.loadAsset('rock');
    await flush();
    calls[0]!.fail(new Error('404 rock'));

    await expect(pending).rejects.toThrow('404 rock');
  });

  it('wraps a non-Error rejection in an Error rather than swallowing it', async () => {
    const { fetchGltf, calls } = heldFetcher();
    const loader = createAssetLoader(resolver, fetchGltf);
    const pending = loader.loadAsset('rock');
    await flush();
    calls[0]!.fail('network down');

    await expect(pending).rejects.toThrow('network down');
  });

  it('evicts a failed load, so the next request fetches again and can succeed', async () => {
    const { fetchGltf, calls } = heldFetcher();
    const loader = createAssetLoader(resolver, fetchGltf);
    const failed = loader.loadAsset('rock');
    await flush();
    calls[0]!.fail();
    await expect(failed).rejects.toThrow();

    const retry = loader.loadAsset('rock');
    await flush();
    expect(fetchGltf).toHaveBeenCalledTimes(2);
    const recovered = fakeGltf('recovered');
    calls[1]!.succeed(recovered);
    expect(await retry).toBe(recovered);
    expect(await loader.loadAsset('rock')).toBe(recovered);
    expect(fetchGltf).toHaveBeenCalledTimes(2);
  });

  it('evicts an id the resolver refuses, so a later request asks the resolver again', async () => {
    const resolve = vi.fn<AssetResolver['resolve']>(() =>
      Promise.reject(new Error('unknown asset id')),
    );
    const loader = createAssetLoader({ resolve }, vi.fn<GltfFetcher>());
    await expect(loader.loadAsset('nope')).rejects.toThrow('unknown asset id');
    await expect(loader.loadAsset('nope')).rejects.toThrow('unknown asset id');
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it('keeps unrelated cached assets when another asset fails', async () => {
    const { fetchGltf, calls } = heldFetcher();
    const loader = createAssetLoader(resolver, fetchGltf);
    const rock = loader.loadAsset('rock');
    const wall = loader.loadAsset('wall');
    await flush();
    calls[0]!.succeed();
    calls[1]!.fail();
    const rockGltf = await rock;
    await expect(wall).rejects.toThrow();

    expect(await loader.loadAsset('rock')).toBe(rockGltf);
    expect(fetchGltf).toHaveBeenCalledTimes(2);
  });

  it('never lets a stale failure evict the newer load a retrying caller started', async () => {
    const { fetchGltf, calls } = heldFetcher();
    const loader = createAssetLoader(resolver, fetchGltf);
    let retry: Promise<GLTF> | undefined;
    // Both callers share the failing load. The first retries from inside its
    // own rejection handler; the second only observes the failure later.
    const eager = loader.loadAsset('rock').catch(() => {
      retry = loader.loadAsset('rock');
    });
    const late = loader.loadAsset('rock').catch(async () => {
      await flush();
    });
    await flush();
    calls[0]!.fail();
    await Promise.all([eager, late]);

    await flush();
    const newer = fakeGltf('newer');
    calls[1]!.succeed(newer);
    expect(await retry).toBe(newer);
    expect(await loader.loadAsset('rock')).toBe(newer);
    expect(fetchGltf).toHaveBeenCalledTimes(2);
  });
});

describe('asset load events', () => {
  it('reports progress for the asset id with a valid fraction when the total is known', async () => {
    const { fetchGltf, calls } = heldFetcher();
    const loader = createAssetLoader(resolver, fetchGltf);
    const events: AssetLoadEvent[] = [];
    const pending = loader.loadAsset('rock', { onEvent: (event) => events.push(event) });
    await flush();
    calls[0]!.onBytes!(250, 1000);
    calls[0]!.onBytes!(1000, 1000);
    calls[0]!.succeed();
    await pending;

    expect(events).toEqual([
      { type: 'progress', assetId: 'rock', loadedBytes: 250, totalBytes: 1000, fraction: 0.25 },
      { type: 'progress', assetId: 'rock', loadedBytes: 1000, totalBytes: 1000, fraction: 1 },
      { type: 'complete', assetId: 'rock', fromCache: false },
    ]);
  });

  it('reports an unknown total as null, never a NaN or Infinity percentage', async () => {
    const { fetchGltf, calls } = heldFetcher();
    const loader = createAssetLoader(resolver, fetchGltf);
    const events: AssetLoadEvent[] = [];
    const pending = loader.loadAsset('rock', { onEvent: (event) => events.push(event) });
    await flush();
    calls[0]!.onBytes!(512, null);
    calls[0]!.onBytes!(600, 0);
    calls[0]!.succeed();
    await pending;

    const progress = events.filter((event) => event.type === 'progress');
    expect(progress).toEqual([
      { type: 'progress', assetId: 'rock', loadedBytes: 512, totalBytes: null, fraction: null },
      { type: 'progress', assetId: 'rock', loadedBytes: 600, totalBytes: null, fraction: null },
    ]);
  });

  it('clamps the fraction when more bytes arrive than the declared total', async () => {
    const { fetchGltf, calls } = heldFetcher();
    const loader = createAssetLoader(resolver, fetchGltf);
    const events: AssetLoadEvent[] = [];
    const pending = loader.loadAsset('rock', { onEvent: (event) => events.push(event) });
    await flush();
    calls[0]!.onBytes!(1500, 1000);
    calls[0]!.succeed();
    await pending;
    expect(events[0]).toMatchObject({ type: 'progress', fraction: 1 });
  });

  it('reports failure with the error the request rejects with, once', async () => {
    const { fetchGltf, calls } = heldFetcher();
    const loader = createAssetLoader(resolver, fetchGltf);
    const events: AssetLoadEvent[] = [];
    const pending = loader.loadAsset('rock', { onEvent: (event) => events.push(event) });
    await flush();
    const error = new Error('404 rock');
    calls[0]!.fail(error);

    await expect(pending).rejects.toBe(error);
    expect(events).toEqual([{ type: 'error', assetId: 'rock', error }]);
  });

  it('reports completion from cache for a request made after the load finished', async () => {
    const { fetchGltf, calls } = heldFetcher();
    const loader = createAssetLoader(resolver, fetchGltf);
    const first = loader.loadAsset('rock');
    await flush();
    calls[0]!.succeed();
    await first;

    const events: AssetLoadEvent[] = [];
    await loader.loadAsset('rock', { onEvent: (event) => events.push(event) });
    expect(events).toEqual([{ type: 'complete', assetId: 'rock', fromCache: true }]);
  });

  it('gives every concurrent caller the shared progress and its own single completion', async () => {
    const { fetchGltf, calls } = heldFetcher();
    const loader = createAssetLoader(resolver, fetchGltf);
    const early: AssetLoadEvent[] = [];
    const joiner: AssetLoadEvent[] = [];
    const a = loader.loadAsset('rock', { onEvent: (event) => early.push(event) });
    await flush();
    calls[0]!.onBytes!(100, 400);
    const b = loader.loadAsset('rock', { onEvent: (event) => joiner.push(event) });
    calls[0]!.onBytes!(400, 400);
    calls[0]!.succeed();
    await Promise.all([a, b]);

    expect(early.map((event) => event.type)).toEqual(['progress', 'progress', 'complete']);
    // Joined mid-load: sees only what happened after it joined, and is not "from cache".
    expect(joiner).toEqual([
      { type: 'progress', assetId: 'rock', loadedBytes: 400, totalBytes: 400, fraction: 1 },
      { type: 'complete', assetId: 'rock', fromCache: false },
    ]);
    expect(fetchGltf).toHaveBeenCalledTimes(1);
  });

  it('gives every concurrent caller its own failure event', async () => {
    const { fetchGltf, calls } = heldFetcher();
    const loader = createAssetLoader(resolver, fetchGltf);
    const seen: string[] = [];
    const a = loader.loadAsset('rock', { onEvent: (event) => seen.push(`a:${event.type}`) });
    const b = loader.loadAsset('rock', { onEvent: (event) => seen.push(`b:${event.type}`) });
    await flush();
    calls[0]!.fail();
    await Promise.allSettled([a, b]);
    expect(seen.sort()).toEqual(['a:error', 'b:error']);
  });

  it('stops sending progress to a request once its load has settled', async () => {
    const { fetchGltf, calls } = heldFetcher();
    const loader = createAssetLoader(resolver, fetchGltf);
    const events: AssetLoadEvent[] = [];
    const pending = loader.loadAsset('rock', { onEvent: (event) => events.push(event) });
    await flush();
    calls[0]!.succeed();
    await pending;
    calls[0]!.onBytes!(10, 10);
    expect(events.map((event) => event.type)).toEqual(['complete']);
  });

  it('survives an observer that throws: the load and the other observers carry on', async () => {
    const { fetchGltf, calls } = heldFetcher();
    const loader = createAssetLoader(resolver, fetchGltf);
    const steady: string[] = [];
    const broken = loader.loadAsset('rock', {
      onEvent: () => {
        throw new Error('observer bug');
      },
    });
    const fine = loader.loadAsset('rock', { onEvent: (event) => steady.push(event.type) });
    await flush();
    calls[0]!.onBytes!(1, 2);
    calls[0]!.succeed();

    await expect(broken).resolves.toBeDefined();
    await expect(fine).resolves.toBeDefined();
    expect(steady).toEqual(['progress', 'complete']);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('asset load observer failed for "rock"'),
      expect.any(Error),
    );
  });

  it('works unchanged for callers that pass no observer, with a fetcher that reports nothing', async () => {
    const legacyFetcher = vi.fn((url: string) => Promise.resolve(fakeGltf(url)));
    const loader = createAssetLoader(resolver, legacyFetcher);
    const gltf = await loader.loadAsset('rock');
    expect(await loader.loadAsset('rock')).toBe(gltf);
    await expect(loader.instantiateAsset('rock')).resolves.toBeDefined();
    expect(legacyFetcher).toHaveBeenCalledTimes(1);
  });
});
