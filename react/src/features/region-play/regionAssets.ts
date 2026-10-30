import { djangoAssetResolverFor } from '../../api/assets/djangoAssetResolver';
import { DJANGO_API_CONFIG, type DjangoApiConfig } from '../../api/config';
import { createAssetLoader, type AssetLoader } from '../island-map/three/assets/assetLoader';
import type { AssetResolver } from '../island-map/three/assets/assetResolver';
import {
  DEFAULT_LOCATION_ENGINE_DEPS,
  type LocationEngineAssets,
} from '../island-map/three/runtime/createLocationEngine';
import type { LocationManifestRepository } from '../island-map/three/runtime/locationManifestRepository';

/**
 * Where a region's 3D models come from (TR-10, docs/ASSET_MANAGER.md section 15).
 *
 * A region the play API serves (Treasure Cove) loads every model through the
 * Django asset manager: the scene names a stable asset id, Django answers
 * with the published version's URL, and the shared loader fetches it. What an
 * administrator publishes and makes the default is what the child sees on
 * the next visit, with no new React build. Ids with nothing published fall
 * back to the bundled files, and a model neither can supply draws the
 * runtime's placeholder (TR-7a).
 *
 * Source-controlled regions, and every build without the Django API
 * (`VITE_BACKEND` unset), keep the bundled loader exactly as before.
 *
 * Call it once per visit: each visit gets its own resolver and loader, so it
 * asks Django again and a newly published default is picked up on re-entry.
 * Within a visit, parsed models are cached by id as usual.
 */
export function regionAssetsFor(
  childId: string,
  regionId: string,
  source: LocationManifestRepository,
  config: DjangoApiConfig = DJANGO_API_CONFIG,
  resolverFor: (childId: string, config: DjangoApiConfig) => AssetResolver = djangoAssetResolverFor,
): LocationEngineAssets {
  if (!config.enabled || source.listRegionIds().includes(regionId)) {
    return DEFAULT_LOCATION_ENGINE_DEPS.assets;
  }
  return engineAssetsFrom(createAssetLoader(resolverFor(childId, config)));
}

/** The engine's view of one loader. */
export function engineAssetsFrom(loader: AssetLoader): LocationEngineAssets {
  return {
    loadModel: (assetId) => loader.loadAsset(assetId),
    instanced: (assetId, placements) => loader.createInstancedMeshFromAsset(assetId, placements),
    withLod: (assetId) => loader.instantiateWithLod(assetId),
  };
}
