import { getAssetManifestEntry, type AssetManifestEntry } from './manifest';

/**
 * Which manifest models each island location's 3D scene loads, keyed by
 * `IslandLocation` slug. The admin Island page reads this so an admin can
 * see a location's art without opening the scene code.
 *
 * Written out by hand and checked by `sceneAssets.test.ts`, which fails if
 * the scene file starts or stops naming a manifest id this list disagrees
 * with. Only scenes that name every asset id as a string literal can be
 * checked that way, so a location is added here once its scene is.
 */
export const SCENE_ASSET_IDS: Readonly<Record<string, readonly string[]>> = {
  'pirate-builder-bay': [
    'bridge-plank',
    'bridge-plank-repaired',
    'path',
    'rock',
    'foliage-tree',
    'crate',
    'barrel',
    'mooring-post',
    'shipwreck',
    'rope-coil',
    'toolbox',
    'treasure-chest',
    'signpost',
    'npc-pip',
  ],
};

/** The manifest entries a location's scene loads, or `undefined` if its scene is not catalogued. */
export function getSceneAssets(locationSlug: string): AssetManifestEntry[] | undefined {
  const ids = SCENE_ASSET_IDS[locationSlug];
  return ids?.map((id) => getAssetManifestEntry(id));
}
