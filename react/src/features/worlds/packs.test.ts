import { describe, expect, it } from 'vitest';
import {
  loadAllWorldContentPacks,
  loadWorldContentPack,
  resetWorldContentPackCache,
  WORLD_PACK_LOADERS,
} from './packs';
import { findDoubleClaimedIds, findUnclaimedIds, validateWorldContentPack } from './validate';
import { WORLD_DEFINITIONS } from './worlds';
import { CREATURE_CARE_COVE_SLUG, HOME_WORLD_SLUG } from './slugs';
import { ISLAND_LOCATIONS } from '../island/locations';
import { ADVENTURE_TEMPLATES } from '../adventures/content';
import { QUEST_DEFINITIONS } from '../quests/content';
import { ALL_COLLECTIBLE_SETS, ALL_ITEMS } from '../rewards/content';
import { ISLAND_NPCS } from '../npc/content';
import { ISLAND_DISCOVERIES } from '../discovery/content';
import { STORY_DEFINITIONS } from '../story/content';
import type { WorldContentPack, WorldContentRegistries } from './types';

/** Every authored registry, in the shape the validator reads. */
const registries: WorldContentRegistries = {
  locations: ISLAND_LOCATIONS.map((location) => ({
    slug: location.slug,
    worldSlug: location.worldSlug,
  })),
  adventures: ADVENTURE_TEMPLATES.map((template) => ({
    slug: template.slug,
    locationSlug: template.locationSlug,
  })),
  quests: QUEST_DEFINITIONS.map((quest) => ({ id: quest.id })),
  items: ALL_ITEMS.map((item) => ({ id: item.id })),
  collectibleSets: ALL_COLLECTIBLE_SETS.map((set) => ({ id: set.id })),
  npcs: ISLAND_NPCS.map((npc) => ({ id: npc.id })),
  discoveries: ISLAND_DISCOVERIES.map((discovery) => ({ id: discovery.id })),
  stories: STORY_DEFINITIONS.map((story) => ({ slug: story.slug })),
};

describe('every authored content pack', () => {
  it('names only content that exists, in a world that owns it', async () => {
    const packs = await loadAllWorldContentPacks();
    for (const pack of packs) {
      expect(validateWorldContentPack(pack, registries), pack.worldSlug).toEqual([]);
    }
  });

  it('registers a pack for every world, and a world for every pack', async () => {
    const packs = await loadAllWorldContentPacks();
    expect(packs.map((pack) => pack.worldSlug).sort()).toEqual(
      WORLD_DEFINITIONS.map((world) => world.slug).sort(),
    );
    expect(Object.keys(WORLD_PACK_LOADERS).sort()).toEqual(
      WORLD_DEFINITIONS.map((world) => world.slug).sort(),
    );
  });

  it('never claims the same content for two worlds', async () => {
    expect(findDoubleClaimedIds(await loadAllWorldContentPacks())).toEqual([]);
  });

  /**
   * The invariant that makes packaging real rather than decorative. Content
   * belonging to no world has quietly opted out of every rule a world
   * imposes, starting with which children can reach it, and nothing else in
   * the codebase would notice.
   */
  it('leaves no authored content unclaimed by any world', async () => {
    expect(findUnclaimedIds(await loadAllWorldContentPacks(), registries)).toEqual([]);
  });
});

describe('validateWorldContentPack', () => {
  const base: WorldContentPack = {
    worldSlug: HOME_WORLD_SLUG,
    version: 1,
    locationSlugs: [],
    adventureSlugs: [],
    questIds: [],
    itemIds: [],
    collectibleSetIds: [],
    npcIds: [],
    discoveryIds: [],
    storySlugs: [],
  };

  it('reports content that does not exist', () => {
    const issues = validateWorldContentPack({ ...base, questIds: ['no-such-quest'] }, registries);

    expect(issues.map((issue) => issue.kind)).toEqual(['UNKNOWN_QUEST']);
    expect(issues[0]?.id).toBe('no-such-quest');
  });

  it('reports a location claimed by a world it does not belong to', () => {
    const issues = validateWorldContentPack(
      { ...base, worldSlug: CREATURE_CARE_COVE_SLUG, locationSlugs: ['pirate-builder-bay'] },
      registries,
    );

    expect(issues.map((issue) => issue.kind)).toEqual(['LOCATION_IN_WRONG_WORLD']);
  });

  it('reports an adventure played somewhere the pack does not own', () => {
    const issues = validateWorldContentPack(
      { ...base, adventureSlugs: ['repair-the-moonlight-bridge'] },
      registries,
    );

    expect(issues.map((issue) => issue.kind)).toEqual(['ADVENTURE_OUTSIDE_PACK_LOCATIONS']);
  });

  it('accepts an adventure at a story-only pseudo-location, which is on no map', () => {
    const issues = validateWorldContentPack(
      { ...base, adventureSlugs: ['dragon-chapter-1-broken-path'] },
      registries,
    );

    expect(issues).toEqual([]);
  });
});

describe('loadWorldContentPack', () => {
  it('loads a pack lazily and caches it, so a world is parsed once per session', async () => {
    resetWorldContentPackCache();
    const first = await loadWorldContentPack(HOME_WORLD_SLUG);
    const second = await loadWorldContentPack(HOME_WORLD_SLUG);

    expect(first.worldSlug).toBe(HOME_WORLD_SLUG);
    expect(second).toBe(first);
  });

  /**
   * An empty pack for a typo in a route parameter would render as a world
   * with nothing in it, which reads as broken content rather than a bad URL.
   */
  it('rejects an unknown world rather than resolving to an empty pack', async () => {
    await expect(loadWorldContentPack('no-such-world')).rejects.toThrow('no-such-world');
  });
});
