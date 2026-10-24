import { describe, expect, it } from 'vitest';
import { locationAssetIds } from './locationAssetUsage';
import { SOURCE_LOCATION_MANIFESTS } from './manifests';
import { SOURCE_ASSET_USAGE_SOURCES } from './sourceLocationAssetUsage';

/**
 * LAI-0304: which shared assets each shipped location's scene uses, as asset ids only (no
 * positions, rotations or any other spatial data; that is LAI-0805).
 *
 * The content export cannot compute this itself: the location manifests reach Three.js and
 * React (scene constants, extension registries), and the export is guarded against both. So
 * the engine side, where those modules load, writes the index as plain JSON with a Vitest
 * file snapshot, and `content-export/build.ts` reads only that file. A changed manifest makes
 * this test fail; refresh with
 *
 *   npx vitest run -u src/features/island-map/three/runtime/sceneAssetIndex.test.ts
 *
 * then `npm run content:export` and `npm run golden:generate`.
 */

const INDEX_PATH = '../../../../../../content/derived/scene-asset-index.json';

function sceneAssetIndex() {
  const regions = SOURCE_LOCATION_MANIFESTS.map((manifest) => ({
    // A location's slug where it has one; otherwise the region id (the Welcome Harbor hub).
    regionSlug: manifest.locationSlug ?? manifest.regionId,
    assetIds: locationAssetIds(manifest, SOURCE_ASSET_USAGE_SOURCES),
  })).sort((a, b) => (a.regionSlug < b.regionSlug ? -1 : a.regionSlug > b.regionSlug ? 1 : 0));
  return {
    generatedBy: 'react/src/features/island-map/three/runtime/sceneAssetIndex.test.ts',
    regions,
  };
}

describe('scene asset index', () => {
  it('lists every shipped location once, with asset ids in first-use order', () => {
    const { regions } = sceneAssetIndex();
    expect(new Set(regions.map((region) => region.regionSlug)).size).toBe(regions.length);
    for (const region of regions) {
      expect(region.assetIds.length, region.regionSlug).toBeGreaterThan(0);
      expect(new Set(region.assetIds).size, region.regionSlug).toBe(region.assetIds.length);
    }
  });

  it('matches the committed index the content export reads', async () => {
    await expect(`${JSON.stringify(sceneAssetIndex(), null, 2)}\n`).toMatchFileSnapshot(INDEX_PATH);
  });
});
