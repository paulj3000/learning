import type { ThreeLocationManifest } from '../locationManifest';
import { createSourceManifestRepository } from '../locationManifestRepository';
import { SOURCE_MANIFEST_REGISTRIES } from '../sourceManifestRegistries';
import { WELCOME_HARBOR_MANIFEST } from './welcomeHarbor';
import { PIRATE_BUILDER_BAY_MANIFEST } from './pirateBuilderBay';

/**
 * Every source-controlled location manifest. Adding an ordinary location
 * is adding its manifest here; nothing else in the runtime changes.
 */
export const SOURCE_LOCATION_MANIFESTS: readonly ThreeLocationManifest[] = [
  WELCOME_HARBOR_MANIFEST,
  PIRATE_BUILDER_BAY_MANIFEST,
];

/** The repository the app uses today. */
export const sourceLocationManifestRepository = createSourceManifestRepository(
  SOURCE_LOCATION_MANIFESTS,
  SOURCE_MANIFEST_REGISTRIES,
);
