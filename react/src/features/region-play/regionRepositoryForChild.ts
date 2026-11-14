import { DJANGO_API_CONFIG, type DjangoApiConfig } from '../../api/config';
import { playApiFor } from '../../api/play/playApi';
import type { LocationManifestRepository } from '../island-map/three/runtime/locationManifestRepository';
import { SOURCE_MANIFEST_REGISTRIES } from '../island-map/three/runtime/sourceManifestRegistries';
import { ISLAND_LOCATIONS } from '../island/locations';
import { createRegionManifestRepository } from './regionManifestRepository';

/**
 * The manifest repository `LocationWorldPage` uses for one child (TR-7).
 * Source regions still come from `source`; any other region id is read from the Django play
 * API.
 */
export function regionRepositoryForChild(
  childId: string,
  source: LocationManifestRepository,
  config: DjangoApiConfig = DJANGO_API_CONFIG,
): LocationManifestRepository {
  return createRegionManifestRepository({
    source,
    api: playApiFor(childId, config),
    registries: SOURCE_MANIFEST_REGISTRIES,
    worldSlugFor: (locationSlug) =>
      ISLAND_LOCATIONS.find((location) => location.slug === locationSlug)?.worldSlug,
  });
}
