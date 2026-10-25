import { DJANGO_API_CONFIG, type DjangoApiConfig } from '../../api/config';
import { playApiFor } from '../../api/play/playApi';
import type { LocationManifestRepository } from '../island-map/three/runtime/locationManifestRepository';
import { SOURCE_MANIFEST_REGISTRIES } from '../island-map/three/runtime/sourceManifestRegistries';
import { ISLAND_LOCATIONS } from '../island/locations';
import { createRegionManifestRepository } from './regionManifestRepository';

/**
 * The manifest repository `LocationWorldPage` uses for one child (TR-7).
 * Without the Django API (`VITE_BACKEND` unset) it is `source` itself, so a
 * build that has not opted in behaves exactly as before. With it, source
 * regions still come from `source` and any other region id is read from
 * the play API.
 */
export function regionRepositoryForChild(
  childId: string,
  source: LocationManifestRepository,
  config: DjangoApiConfig = DJANGO_API_CONFIG,
): LocationManifestRepository {
  if (!config.enabled) return source;
  return createRegionManifestRepository({
    source,
    api: playApiFor(childId, config),
    registries: SOURCE_MANIFEST_REGISTRIES,
    worldSlugFor: (locationSlug) =>
      ISLAND_LOCATIONS.find((location) => location.slug === locationSlug)?.worldSlug,
  });
}
