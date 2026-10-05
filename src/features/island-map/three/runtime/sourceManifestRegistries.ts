import { ASSET_MANIFEST } from '../assets/manifest';
import { ALL_NPCS } from '../../../npc/content';
import { ALL_CHECKPOINTS } from '../../../discovery/checkpoints';
import { ISLAND_DISCOVERIES } from '../../../discovery/content';
import { WORLD_DEFINITIONS } from '../../../worlds/worlds';
import { ISLAND_LOCATIONS } from '../../../island/locations';
import { ADVENTURE_TEMPLATES } from '../../../adventures/content';
import { STORY_DEFINITIONS } from '../../../story/content';
import { ALL_ITEMS } from '../../../rewards/content';
import { SOURCE_EXTENSION_IDS } from '../extensions';
import type { LocationManifestRegistries } from './validateLocationManifest';

/**
 * The source-controlled registries a `ThreeLocationManifest` is validated
 * against today. A future Admin publish step swaps this for the published
 * catalog (`docs/engine/02_CONTENT_MODEL_STRATEGY.md`); the validator itself
 * does not change.
 *
 * `extensionIds` comes from the shipped extension registries
 * (`../extensions/index.ts`), so a manifest naming an unregistered
 * mechanic fails validation.
 */
export const SOURCE_MANIFEST_REGISTRIES: LocationManifestRegistries = {
  assets: ASSET_MANIFEST,
  npcIds: ALL_NPCS.map((npc) => npc.id),
  checkpoints: ALL_CHECKPOINTS,
  worldSlugs: WORLD_DEFINITIONS.map((world) => world.slug),
  locations: ISLAND_LOCATIONS,
  adventures: ADVENTURE_TEMPLATES,
  discoveryIds: ISLAND_DISCOVERIES.map((discovery) => discovery.id),
  storySlugs: STORY_DEFINITIONS.map((story) => story.slug),
  itemIds: ALL_ITEMS.map((item) => item.id),
  extensionIds: SOURCE_EXTENSION_IDS,
};
