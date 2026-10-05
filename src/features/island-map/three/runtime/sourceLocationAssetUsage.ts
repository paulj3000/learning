import { ASSET_MANIFEST, getAssetManifestEntry, type AssetManifestEntry } from '../assets/manifest';
import { SOURCE_WORLD_EXTENSIONS } from '../extensions';
import { SOURCE_LOCATION_MANIFESTS } from './manifests';
import { assetUsageByRegion, locationAssetIds, type AssetUsageSources } from './locationAssetUsage';

/**
 * `locationAssetUsage.ts` over what the app ships: the source-controlled
 * manifests, the registered extensions' declarations and the bundled
 * catalogue's LOD pairs. The admin Island page reads this.
 */

const lowDetailById = new Map(
  ASSET_MANIFEST.flatMap((entry) => (entry.lod ? [[entry.id, entry.lod.lowDetailId]] : [])),
);

export const SOURCE_ASSET_USAGE_SOURCES: AssetUsageSources = {
  extensionAssetIds: (binding) =>
    SOURCE_WORLD_EXTENSIONS.get(binding.extensionId)?.assetIds?.(binding.config) ?? [],
  lowDetailIdOf: (assetId) => lowDetailById.get(assetId),
};

/**
 * The catalogue entries a location's 3D scene loads, found by its
 * `IslandLocation` slug or its region id, or `undefined` if it has no
 * manifest (a location still on its 2D screen).
 */
export function getLocationAssets(slug: string): AssetManifestEntry[] | undefined {
  const manifest = SOURCE_LOCATION_MANIFESTS.find(
    (candidate) => candidate.locationSlug === slug || candidate.regionId === slug,
  );
  if (!manifest) return undefined;
  return locationAssetIds(manifest, SOURCE_ASSET_USAGE_SOURCES).map((id) =>
    getAssetManifestEntry(id),
  );
}

/** For each shipped asset id, the region ids that use it. An id absent here is used by no manifest. */
export function getSourceAssetUsage(): Map<string, string[]> {
  return assetUsageByRegion(SOURCE_LOCATION_MANIFESTS, SOURCE_ASSET_USAGE_SOURCES);
}
