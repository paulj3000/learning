import { ASSET_MANIFEST } from '../assets/manifest';
import { ALL_NPCS } from '../../../npc/content';
import { ALL_CHECKPOINTS } from '../../../discovery/checkpoints';
import { ISLAND_DISCOVERIES } from '../../../discovery/content';
import { WORLD_DEFINITIONS } from '../../../worlds/worlds';
import { ISLAND_LOCATIONS } from '../../../island/locations';
import { ADVENTURE_TEMPLATES } from '../../../adventures/content';
import { STORY_DEFINITIONS } from '../../../story/content';
import { SOURCE_WORLD_EXTENSIONS } from './extensionRegistry';
import type { LocationManifestRegistries } from './validateLocationManifest';

/**
 * The source-controlled registries a `ThreeLocationManifest` is validated
 * against today. A future Admin publish step swaps this for the published
 * catalog (`docs/engine/02_CONTENT_MODEL_STRATEGY.md`); the validator itself
 * does not change.
 *
 * `extensionIds` comes from the shipped extension registry, which is empty
 * until the first bespoke mechanic moves behind it
 * (`docs/engine/10_IMPLEMENTATION_PHASES.md` Phase 7), so any manifest
 * declaring an extension fails validation until then, as it should.
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
  extensionIds: SOURCE_WORLD_EXTENSIONS.ids(),
};
