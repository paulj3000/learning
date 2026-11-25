import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { Group, LOD, type Object3D } from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { ApiClient } from '../client';
import { createAssetLoader } from '../../features/island-map/three/assets/assetLoader';
import {
  ASSET_MANIFEST,
  getAssetManifestEntry,
} from '../../features/island-map/three/assets/manifest';
import { DEFAULT_GROUND_ASSET_ID } from '../../features/region-play/regionManifest';
import { createDjangoAssetResolver } from './djangoAssetResolver';

/**
 * The engine's asset-resolution contract, end to end through the Django resolver and the shared
 * loader (Trello #247 and #244, GE-247 engine follow-ups). What happens to a retired, unpublished
 * or unknown id; the low-detail twin and the default ground; identity across URL refreshes; and
 * the one asset-id shape every realm uses.
 */

const NOW = Date.parse('2026-11-25T12:00:00Z');
const HOUR = 60 * 60 * 1000;

type Answer = Record<string, unknown>;

/** A Django that answers each id from `answers` (default: unavailable), with a fresh URL each call. */
function django(answers: Record<string, 'resolved' | 'retired' | 'unavailable'>, now = () => NOW) {
  let calls = 0;
  const request = vi.fn(async (_method: string, path: string) => {
    calls += 1;
    const ids = decodeURIComponent(path.split('?ids=')[1] ?? '').split(',');
    const assets: Answer[] = ids.map((ref) => {
      const status = answers[ref] ?? 'unavailable';
      if (status !== 'resolved') return { ref, id: ref, status };
      return {
        ref,
        id: ref,
        status,
        // A signed token that changes on every request, like TimestampSigner tokens did.
        url: `/api/v1/asset-files/token-${ref}-${calls}/model.glb`,
        urlExpiresAt: new Date(now() + HOUR).toISOString(),
        cache: { key: `${ref}@version-1`, immutable: true },
      };
    });
    return { status: 200, data: { assets } };
  });
  const resolver = createDjangoAssetResolver({
    client: { request } as unknown as ApiClient,
    childId: 'child-1',
    now,
    onIssue: () => undefined,
  });
  return { resolver, request };
}

function fakeGltf(): GLTF {
  return { scene: new Group(), animations: [] } as unknown as GLTF;
}

describe('missing and retired assets', () => {
  it('a retired asset the app ships loads its bundled file', async () => {
    const { resolver } = django({ rock: 'retired' });
    const resolved = await resolver.resolve('rock');
    expect(resolved).toMatchObject({ source: 'BUNDLED', url: getAssetManifestEntry('rock').url });
  });

  it('an unpublished asset the app ships loads its bundled file', async () => {
    const { resolver } = django({});
    expect(await resolver.resolve('crate')).toMatchObject({
      source: 'BUNDLED',
      url: getAssetManifestEntry('crate').url,
    });
  });

  it('a retired or unknown asset the app does not ship fails the load, so the placeholder draws', async () => {
    const fetchGltf = vi.fn(async () => fakeGltf());
    const { resolver } = django({ 'library-only-statue': 'retired' });
    const loader = createAssetLoader(resolver, fetchGltf);
    await expect(loader.loadAsset('library-only-statue')).rejects.toThrow(/unknown asset id/);
    await expect(loader.loadAsset('nobody-knows-this')).rejects.toThrow(/unknown asset id/);
    expect(fetchGltf).not.toHaveBeenCalled();
  });

  it('a published asset loads the library file, not the bundled one', async () => {
    const fetchGltf = vi.fn(async () => fakeGltf());
    const { resolver } = django({ rock: 'resolved' });
    await createAssetLoader(resolver, fetchGltf).loadAsset('rock');
    expect(fetchGltf).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/asset-files/token-rock-'),
      expect.anything(),
    );
  });
});

describe('the low-detail twin', () => {
  it('a retired twin falls back to its bundled file and the LOD keeps both levels', async () => {
    const fetchGltf = vi.fn(async (_url: string) => fakeGltf());
    const { resolver } = django({ 'foliage-tree': 'resolved', 'foliage-tree-lod1': 'retired' });
    const lod: Object3D = await createAssetLoader(resolver, fetchGltf).instantiateWithLod(
      'foliage-tree',
    );
    expect(lod).toBeInstanceOf(LOD);
    expect((lod as LOD).levels.map((level) => level.distance)).toEqual([0, 14]);
    const urls = fetchGltf.mock.calls.map(([url]) => url as string);
    expect(urls).toContain(getAssetManifestEntry('foliage-tree-lod1').url);
    expect(urls.some((url) => url.includes('token-foliage-tree-'))).toBe(true);
  });

  it('the pairing comes from the bundled manifest only: a twin is always a shipped file', () => {
    for (const entry of ASSET_MANIFEST) {
      if (entry.lod) expect(() => getAssetManifestEntry(entry.lod!.lowDetailId)).not.toThrow();
    }
  });
});

describe('the default ground', () => {
  it('is a shipped model, so retiring it in the library still draws the same file', async () => {
    expect(DEFAULT_GROUND_ASSET_ID).toBe('ground-tile');
    const { resolver } = django({ [DEFAULT_GROUND_ASSET_ID]: 'retired' });
    expect(await resolver.resolve(DEFAULT_GROUND_ASSET_ID)).toMatchObject({
      source: 'BUNDLED',
      url: getAssetManifestEntry(DEFAULT_GROUND_ASSET_ID).url,
    });
  });
});

describe('identity is the asset id and version, never the delivery URL', () => {
  it('a refreshed URL for the same version never reloads a model in the same visit', async () => {
    let now = NOW;
    const fetchGltf = vi.fn(async () => fakeGltf());
    const { resolver, request } = django({ rock: 'resolved' }, () => now);
    const loader = createAssetLoader(resolver, fetchGltf);
    await loader.loadAsset('rock');
    now += 2 * HOUR; // the first URL has expired; Django signs a new one
    await resolver.resolve('rock');
    expect(request).toHaveBeenCalledTimes(2);
    await loader.loadAsset('rock');
    await loader.instantiateAsset('rock');
    expect(fetchGltf).toHaveBeenCalledTimes(1);
  });

  it('two scenes placing the same id share one load (one identity per asset per visit)', async () => {
    const fetchGltf = vi.fn(async () => fakeGltf());
    const { resolver, request } = django({ rock: 'resolved' });
    const loader = createAssetLoader(resolver, fetchGltf);
    await Promise.all([loader.loadAsset('rock'), loader.instantiateAsset('rock')]);
    expect(request).toHaveBeenCalledTimes(1);
    expect(fetchGltf).toHaveBeenCalledTimes(1);
  });
});

/**
 * One asset id shape in every realm: the server's `ASSET_ID` (`lai/apps/assets/formats.py`),
 * which rejects version suffixes, dots and capitals. Read from the Python source, so the two
 * cannot drift.
 */
describe('canonical asset ids across realms', () => {
  const root = resolve(process.cwd(), '..');
  const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
  const pattern = (() => {
    const match = /^ASSET_ID = re\.compile\(r"(.+)"\)$/m.exec(read('lai/apps/assets/formats.py'));
    if (!match) throw new Error('formats.py no longer declares ASSET_ID');
    return new RegExp(match[1]!);
  })();

  /** Every asset id a Django scene names (the regions dependency provider's keys). */
  function sceneIds(node: unknown, out: Set<string>): Set<string> {
    if (Array.isArray(node)) node.forEach((item) => sceneIds(item, out));
    else if (node && typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) {
        if ((key === 'assetId' || key.endsWith('AssetId')) && typeof value === 'string' && value)
          out.add(value);
        else if ((key === 'assetIds' || key.endsWith('AssetIds')) && Array.isArray(value))
          value.forEach((id) => typeof id === 'string' && id && out.add(id));
        else sceneIds(value, out);
      }
    }
    return out;
  }

  const realms: Record<string, string[]> = (() => {
    const json = (path: string) => JSON.parse(read(path)) as Record<string, unknown>;
    const index = json('content/derived/scene-asset-index.json') as {
      regions: { regionSlug: string; assetIds: string[] }[];
    };
    const placed = (data: Record<string, unknown>) =>
      ((data.placements as { asset?: string }[] | undefined) ?? [])
        .map((placement) => placement.asset)
        .filter((id): id is string => !!id);
    const firepeak = json('lai/apps/regions/firepeak_heart_scene.json');
    const northPole = json('lai/apps/regions/north_pole_scene.json');
    return {
      'bundled catalogue': ASSET_MANIFEST.map((entry) => entry.id),
      ...Object.fromEntries(index.regions.map((r) => [`shipped ${r.regionSlug}`, r.assetIds])),
      'Treasure Rush (Treasure Cove)': [
        ...sceneIds(json('lai/apps/regions/treasure_cove_layout.json'), new Set()),
      ],
      Firepeak: [
        ...sceneIds(firepeak, new Set()),
        ...placed(firepeak),
        ...(firepeak.assets as { assetId: string }[]).map((asset) => asset.assetId),
      ],
      'North Pole': [...sceneIds(northPole, new Set()), ...placed(northPole)],
      "Pirate's Leap": [
        ...sceneIds(json('lai/apps/regions/pirates_leap_course.json'), new Set()),
        ...sceneIds(json('lai/apps/regions/pirates_leap_bridge.json'), new Set()),
      ],
    };
  })();

  it.each(Object.entries(realms))('%s: every id is a canonical asset id', (_, ids) => {
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.filter((id) => !pattern.test(id))).toEqual([]);
  });

  it('Storykeeper Castle, Treasure Rush, Firepeak and North Pole are all covered', () => {
    const names = Object.keys(realms).join(' ');
    for (const realm of ['storykeeper-castle', 'Treasure Rush', 'Firepeak', 'North Pole'])
      expect(names).toContain(realm);
  });

  it('a Django realm declares an id the app ships with the same kind the app gives it', () => {
    const firepeak = JSON.parse(read('lai/apps/regions/firepeak_heart_scene.json')) as {
      assets: { assetId: string; kind: string }[];
    };
    const shipped = new Map(ASSET_MANIFEST.map((entry) => [entry.id, entry.kind]));
    const clashes = firepeak.assets.filter(
      (asset) => shipped.has(asset.assetId) && shipped.get(asset.assetId) !== asset.kind,
    );
    expect(clashes).toEqual([]);
  });
});
