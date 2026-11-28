import type { ThreeLocationManifest } from '../locationManifest';
import { createSourceManifestRepository } from '../locationManifestRepository';
import { SOURCE_MANIFEST_REGISTRIES } from '../sourceManifestRegistries';
import { WELCOME_HARBOR_MANIFEST } from './welcomeHarbor';
import { PIRATE_BUILDER_BAY_MANIFEST } from './pirateBuilderBay';
import { WONDERWILD_FOREST_MANIFEST } from './wonderwildForest';
import { CLOCKWORK_HARBOR_MANIFEST } from './clockworkHarbor';
import { DRAGONS_SANCTUARY_MANIFEST } from './dragonsSanctuary';
import { STORYKEEPER_CASTLE_MANIFEST } from './storykeeperCastle';
import { CASTLE_WRITING_ROOM_MANIFEST } from './castleWritingRoom';

/**
 * Every source-controlled location manifest. Adding an ordinary location
 * is adding its manifest here; nothing else in the runtime changes.
 */
/**
 * GE-077: the 3D island hub. A Phaser `NAVIGATE 'world'` (the Phaser harbor) taken inside a
 * Three.js world lands here instead (`navigationTarget.ts`).
 */
export const HUB_REGION_ID = WELCOME_HARBOR_MANIFEST.regionId;

export const SOURCE_LOCATION_MANIFESTS: readonly ThreeLocationManifest[] = [
  WELCOME_HARBOR_MANIFEST,
  PIRATE_BUILDER_BAY_MANIFEST,
  WONDERWILD_FOREST_MANIFEST,
  CLOCKWORK_HARBOR_MANIFEST,
  DRAGONS_SANCTUARY_MANIFEST,
  STORYKEEPER_CASTLE_MANIFEST,
  CASTLE_WRITING_ROOM_MANIFEST,
];

/** The repository the app uses today. */
export const sourceLocationManifestRepository = createSourceManifestRepository(
  SOURCE_LOCATION_MANIFESTS,
  SOURCE_MANIFEST_REGISTRIES,
);
