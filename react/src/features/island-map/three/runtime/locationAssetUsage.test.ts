import { describe, expect, it } from 'vitest';
import { ASSET_MANIFEST } from '../assets/manifest';
import { assetUsageByRegion, locationAssetIds, type AssetUsageSources } from './locationAssetUsage';
import type { ThreeLocationManifest } from './locationManifest';
import { SOURCE_LOCATION_MANIFESTS } from './manifests';
import { WELCOME_HARBOR_MANIFEST } from './manifests/welcomeHarbor';
import {
  getLocationAssets,
  getSourceAssetUsage,
  SOURCE_ASSET_USAGE_SOURCES,
} from './sourceLocationAssetUsage';

/** Engine Phase 10: "where is this asset used", read from the manifests. */

const NO_EXTRAS: AssetUsageSources = {
  extensionAssetIds: () => [],
  lowDetailIdOf: () => undefined,
};

function fixture(overrides: Partial<ThreeLocationManifest>): ThreeLocationManifest {
  return {
    ...WELCOME_HARBOR_MANIFEST,
    buildings: [],
    scenery: [],
    npcs: [],
    props: [],
    collectibles: [],
    ambient: [],
    extensions: [],
    ...overrides,
  };
}

describe('locationAssetIds', () => {
  it('collects every kind of asset reference a manifest can make, each once', () => {
    const [building] = WELCOME_HARBOR_MANIFEST.buildings;
    const manifest = fixture({
      buildings: [{ ...building!, wallAssetId: 'wall', roofAssetId: 'roof', doorAssetId: 'door' }],
      scenery: [
        {
          id: 'sea',
          kind: 'FLAT_PLANE',
          color: 0,
          y: 0,
          area: { id: 'a', minX: 0, maxX: 1, minZ: 0, maxZ: 1 },
        },
        { id: 'trees', kind: 'LOD_PLACEMENTS', assetId: 'foliage-tree', positions: [] },
        { id: 'rocks', kind: 'CLUSTER', assetId: 'rock', positions: [] },
        { id: 'more-rocks', kind: 'CLUSTER', assetId: 'rock', positions: [] },
      ],
      npcs: [{ ...WELCOME_HARBOR_MANIFEST.npcs[0]!, assetId: 'npc-pip' }],
      props: [
        { entityId: 'drawn-by-extension', position: { x: 0, z: 0 }, label: 'Lamp' },
        { entityId: 'chest', assetId: 'treasure-chest', position: { x: 0, z: 0 }, label: 'Chest' },
      ],
      collectibles: [
        { entityId: 'gem', assetId: 'collectible-gem', position: { x: 0, z: 0 }, label: 'Gem' },
      ],
      ambient: [
        {
          kind: 'SPLINE_LOOP',
          id: 'gull',
          path: [],
          loopsPerSecond: 1,
          appearance: { assetId: 'companion-chatty' },
        },
        {
          kind: 'SPLINE_LOOP',
          id: 'cone',
          path: [],
          loopsPerSecond: 1,
          appearance: { primitive: 'CONE', color: 0 },
        },
      ],
      extensions: [{ extensionId: 'lamps', config: {} }],
    });

    expect(
      locationAssetIds(manifest, {
        extensionAssetIds: (binding) =>
          binding.extensionId === 'lamps' ? ['wall-sconce-lit'] : [],
        lowDetailIdOf: (id) => (id === 'foliage-tree' ? 'foliage-tree-lod1' : undefined),
      }),
    ).toEqual([
      'wall',
      'roof',
      'door',
      'foliage-tree',
      'foliage-tree-lod1',
      'rock',
      'npc-pip',
      'treasure-chest',
      'collectible-gem',
      'companion-chatty',
      'wall-sconce-lit',
    ]);
  });

  it('is empty for a manifest that places only primitives', () => {
    expect(locationAssetIds(fixture({}), NO_EXTRAS)).toEqual([]);
  });
});

describe('assetUsageByRegion', () => {
  it('names every region that uses an asset', () => {
    const a = fixture({
      regionId: 'a',
      npcs: [{ ...WELCOME_HARBOR_MANIFEST.npcs[0]!, assetId: 'npc-pip' }],
    });
    const b = fixture({
      regionId: 'b',
      npcs: [{ ...WELCOME_HARBOR_MANIFEST.npcs[0]!, assetId: 'npc-pip' }],
    });
    expect(assetUsageByRegion([a, b], NO_EXTRAS).get('npc-pip')).toEqual(['a', 'b']);
  });
});

describe('the shipped manifests', () => {
  it('reference only assets the catalogue knows', () => {
    const known = new Set(ASSET_MANIFEST.map((entry) => entry.id));
    for (const manifest of SOURCE_LOCATION_MANIFESTS) {
      const unknown = locationAssetIds(manifest, SOURCE_ASSET_USAGE_SOURCES).filter(
        (id) => !known.has(id),
      );
      expect(unknown, manifest.regionId).toEqual([]);
    }
  });

  it('count what an extension declares as part of its location', () => {
    expect(getLocationAssets('storykeeper-castle')?.map((entry) => entry.id)).toEqual(
      expect.arrayContaining(['hearth-lit', 'portrait-fox-lit', 'canvas-hero-dragon']),
    );
    expect(getSourceAssetUsage().get('hearth-lit')).toEqual([
      SOURCE_LOCATION_MANIFESTS.find((m) => m.locationSlug === 'storykeeper-castle')!.regionId,
    ]);
  });

  it('find a location by region id when it is not an island location (the hub)', () => {
    expect(getLocationAssets(WELCOME_HARBOR_MANIFEST.regionId)?.length).toBeGreaterThan(0);
    expect(getLocationAssets('no-such-place')).toBeUndefined();
  });
});
