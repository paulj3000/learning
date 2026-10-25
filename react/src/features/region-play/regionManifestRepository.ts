import { isApiError } from '../../api/errors';
import type { PlayApi } from '../../api/play/playApi';
import { CheckpointPublishError, publishRegionCheckpoints } from '../discovery/checkpoints';
import {
  InvalidLocationManifestError,
  LocationManifestNotFoundError,
  type LocationManifestRepository,
} from '../island-map/three/runtime/locationManifestRepository';
import type { ThreeLocationManifest } from '../island-map/three/runtime/locationManifest';
import {
  validateLocationManifest,
  type LocationManifestRegistries,
} from '../island-map/three/runtime/validateLocationManifest';
import { buildRegionManifest, RegionBuildError } from './regionManifest';
import { toRegionSceneModel } from './sceneModel';

/**
 * The `LocationManifestRepository` for one child (TR-7, decision TR-D15).
 * Source regions come from `source`, unchanged. Any other region id is asked
 * of the Django play API: the region bootstrap becomes a scene model, then a
 * manifest, then is validated against the same registries a source manifest
 * is, before the view can render it.
 *
 * Per child, because a published region carries the child's own state (an
 * opened chest is drawn open). Not cached: every visit reads the server, so
 * a chest opened on another device is open here too.
 *
 * Errors use the repository's own types, so the view's existing calm states
 * apply: unknown, unpublished, retired, another family's, or a build without
 * the Django API are all "not open yet"; a manifest that fails validation is
 * "couldn't be loaded". Network and server failures reject with the
 * `ApiError`, which the view also shows as "couldn't be loaded".
 */

export interface RegionManifestRepositoryOptions {
  source: LocationManifestRepository;
  api: PlayApi;
  registries: LocationManifestRegistries;
  /** Which world a location slug belongs to, from the island's location registry. */
  worldSlugFor: (locationSlug: string) => string | undefined;
}

export function createRegionManifestRepository(
  options: RegionManifestRepositoryOptions,
): LocationManifestRepository {
  const { source, api, registries, worldSlugFor } = options;
  const clipsFor = (assetId: string) =>
    registries.assets.find((asset) => asset.id === assetId)?.clips ?? [];

  async function fromServer(regionId: string): Promise<ThreeLocationManifest> {
    let bootstrap;
    try {
      bootstrap = await api.getRegion(regionId);
    } catch (error) {
      if (isApiError(error) && (error.kind === 'not_found' || error.kind === 'disabled')) {
        throw new LocationManifestNotFoundError(regionId);
      }
      throw error;
    }
    const model = toRegionSceneModel(bootstrap);
    const worldSlug = worldSlugFor(model.locationSlug);
    if (!worldSlug) {
      throw new InvalidLocationManifestError(regionId, [
        { kind: 'UNKNOWN_LOCATION', path: 'locationSlug', detail: model.locationSlug },
      ]);
    }
    let built;
    try {
      built = buildRegionManifest(model, { worldSlug, assetClips: clipsFor });
      publishRegionCheckpoints(regionId, built.checkpoints);
    } catch (error) {
      if (error instanceof RegionBuildError || error instanceof CheckpointPublishError) {
        throw new InvalidLocationManifestError(regionId, [
          { kind: 'INVALID_VALUE', path: error instanceof RegionBuildError ? error.path : 'checkpoints', detail: error.message },
        ]);
      }
      throw error;
    }
    const issues = validateLocationManifest(built.manifest, registries);
    if (issues.length > 0) throw new InvalidLocationManifestError(regionId, issues);
    return built.manifest;
  }

  return {
    getPublished(regionId) {
      if (source.listRegionIds().includes(regionId)) return source.getPublished(regionId);
      return fromServer(regionId);
    },
    listRegionIds() {
      return source.listRegionIds();
    },
  };
}
