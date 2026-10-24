import type { LocationManifestRepository } from '../island-map/three/runtime/locationManifestRepository';
import { sourceLocationManifestRepository } from '../island-map/three/runtime/manifests';
import { MULTIPLAYER_CONFIG } from './config';

/** Matches `MULTIPLAYER_PRESENCE_EXTENSION_ID`; repeated to keep this module free of React. */
const PRESENCE_EXTENSION_ID = 'multiplayer-presence';

/**
 * Development only: lets `VITE_MULTIPLAYER_DEV_REGIONS` try presence in a
 * region whose manifest does not opt in, by appending the binding at read
 * time. Shipped manifests are untouched, and `readMultiplayerConfig`
 * ignores the variable outside `vite dev`, so a production build always
 * gets the base repository.
 */
export function withDevMultiplayerPresence(
  base: LocationManifestRepository,
  devRegionIds: readonly string[],
): LocationManifestRepository {
  if (devRegionIds.length === 0) return base;
  return {
    listRegionIds: () => base.listRegionIds(),
    async getPublished(regionId) {
      const manifest = await base.getPublished(regionId);
      if (
        !devRegionIds.includes(regionId) ||
        manifest.extensions.some((binding) => binding.extensionId === PRESENCE_EXTENSION_ID)
      ) {
        return manifest;
      }
      return {
        ...manifest,
        extensions: [...manifest.extensions, { extensionId: PRESENCE_EXTENSION_ID, config: {} }],
      };
    },
  };
}

/** The repository the location route uses in this build. */
export const locationRepositoryForThisBuild: LocationManifestRepository = MULTIPLAYER_CONFIG.enabled
  ? withDevMultiplayerPresence(sourceLocationManifestRepository, MULTIPLAYER_CONFIG.devRegionIds)
  : sourceLocationManifestRepository;
