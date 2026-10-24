import type { ExtensionBinding, ThreeLocationManifest } from './locationManifest';

/**
 * Which assets each location uses, read from the manifests themselves
 * (`docs/engine/06_ASSET_SYSTEM.md` "Admin Asset Usage", engine Phase 10).
 *
 * This replaces a hand-written per-location list that a test had to keep
 * honest by grepping scene files for string literals. A manifest is the
 * whole truth about what a location places, and an extension says what it
 * loads through `WorldExtension.assetIds`, which the runtime enforces, so
 * the index cannot drift from what a child's scene really fetches.
 *
 * Pure: the catalogue's LOD pairs and the extensions' declarations are
 * passed in, so `sourceLocationAssetUsage.ts` can supply the shipped ones
 * and a test can supply a fixture.
 */

export interface AssetUsageSources {
  /** What an extension binding loads (`WorldExtension.assetIds`). */
  extensionAssetIds(binding: ExtensionBinding): readonly string[];
  /** The lower-detail id an asset swaps to at distance, if its catalogue entry declares one. */
  lowDetailIdOf(assetId: string): string | undefined;
}

/** Every asset id a location's scene can load, each once, in first-use order. */
export function locationAssetIds(
  manifest: ThreeLocationManifest,
  sources: AssetUsageSources,
): string[] {
  const ids = new Set<string>();
  const add = (assetId: string | undefined) => {
    if (assetId !== undefined) ids.add(assetId);
  };

  for (const building of manifest.buildings) {
    add(building.wallAssetId);
    add(building.roofAssetId);
    add(building.doorAssetId);
  }
  for (const item of manifest.scenery) {
    switch (item.kind) {
      case 'FLAT_PLANE':
      case 'BOX':
        break;
      case 'LOD_PLACEMENTS':
        add(item.assetId);
        add(sources.lowDetailIdOf(item.assetId));
        break;
      default:
        add(item.assetId);
    }
  }
  for (const npc of manifest.npcs) add(npc.assetId);
  for (const prop of manifest.props) add(prop.assetId);
  for (const collectible of manifest.collectibles) add(collectible.assetId);
  for (const ambient of manifest.ambient) {
    if ('assetId' in ambient.appearance) add(ambient.appearance.assetId);
  }
  for (const binding of manifest.extensions) {
    for (const assetId of sources.extensionAssetIds(binding)) add(assetId);
  }
  return [...ids];
}

/** For each asset id, the `regionId`s of every location that uses it. */
export function assetUsageByRegion(
  manifests: readonly ThreeLocationManifest[],
  sources: AssetUsageSources,
): Map<string, string[]> {
  const usage = new Map<string, string[]>();
  for (const manifest of manifests) {
    for (const assetId of locationAssetIds(manifest, sources)) {
      usage.set(assetId, [...(usage.get(assetId) ?? []), manifest.regionId]);
    }
  }
  return usage;
}
