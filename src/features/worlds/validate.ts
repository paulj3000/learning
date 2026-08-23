/**
 * Content pack validation (docs/ROADMAP.md Phase 29; explorable-world
 * roadmap section 22: "content should be validated during
 * development/build time before it can become playable").
 *
 * Pure, and registry-agnostic: the caller passes the registries in, so this
 * module imports no content and can be pointed at a fixture in a test as
 * easily as at the real island.
 *
 * What it is for: a world is a claim about ownership, and an unchecked claim
 * rots. Content authored without a world lands nowhere, content claimed
 * twice is ambiguous, and a location claimed by a world it is not marked as
 * belonging to is a straight contradiction. Each of those is silent at
 * runtime and each one produces a child-visible dead end eventually.
 */
import type { WorldContentPack, WorldContentRegistries, WorldPackIssue } from './types';

function unknownIds(
  claimed: readonly string[],
  known: ReadonlySet<string>,
  worldSlug: string,
  kind: WorldPackIssue['kind'],
  noun: string,
): WorldPackIssue[] {
  return claimed
    .filter((id) => !known.has(id))
    .map((id) => ({
      worldSlug,
      kind,
      id,
      detail: `Pack for "${worldSlug}" claims ${noun} "${id}", which is not authored anywhere.`,
    }));
}

/** Everything wrong with one pack. An empty array means the pack is sound. */
export function validateWorldContentPack(
  pack: WorldContentPack,
  registries: WorldContentRegistries,
): WorldPackIssue[] {
  const locationsBySlug = new Map(registries.locations.map((entry) => [entry.slug, entry]));
  const adventuresBySlug = new Map(registries.adventures.map((entry) => [entry.slug, entry]));

  const issues: WorldPackIssue[] = [
    ...unknownIds(
      pack.locationSlugs,
      new Set(locationsBySlug.keys()),
      pack.worldSlug,
      'UNKNOWN_LOCATION',
      'location',
    ),
    ...unknownIds(
      pack.adventureSlugs,
      new Set(adventuresBySlug.keys()),
      pack.worldSlug,
      'UNKNOWN_ADVENTURE',
      'adventure',
    ),
    ...unknownIds(
      pack.questIds,
      new Set(registries.quests.map((entry) => entry.id)),
      pack.worldSlug,
      'UNKNOWN_QUEST',
      'quest',
    ),
    ...unknownIds(
      pack.itemIds,
      new Set(registries.items.map((entry) => entry.id)),
      pack.worldSlug,
      'UNKNOWN_ITEM',
      'item',
    ),
    ...unknownIds(
      pack.collectibleSetIds,
      new Set(registries.collectibleSets.map((entry) => entry.id)),
      pack.worldSlug,
      'UNKNOWN_SET',
      'collectible set',
    ),
    ...unknownIds(
      pack.npcIds,
      new Set(registries.npcs.map((entry) => entry.id)),
      pack.worldSlug,
      'UNKNOWN_NPC',
      'NPC',
    ),
    ...unknownIds(
      pack.discoveryIds,
      new Set(registries.discoveries.map((entry) => entry.id)),
      pack.worldSlug,
      'UNKNOWN_DISCOVERY',
      'discovery',
    ),
    ...unknownIds(
      pack.storySlugs,
      new Set(registries.stories.map((entry) => entry.slug)),
      pack.worldSlug,
      'UNKNOWN_STORY',
      'story',
    ),
  ];

  for (const slug of pack.locationSlugs) {
    const location = locationsBySlug.get(slug);
    if (location && location.worldSlug !== pack.worldSlug) {
      issues.push({
        worldSlug: pack.worldSlug,
        kind: 'LOCATION_IN_WRONG_WORLD',
        id: slug,
        detail: `Pack for "${pack.worldSlug}" claims location "${slug}", which is marked as belonging to "${location.worldSlug}".`,
      });
    }
  }

  const packLocations = new Set(pack.locationSlugs);
  for (const slug of pack.adventureSlugs) {
    const adventure = adventuresBySlug.get(slug);
    if (!adventure) continue;
    // A story-only pseudo-location (Phase 15's arc challenges) is on no map,
    // so it cannot be expected to sit inside the pack's own locations.
    const isRealPlace = locationsBySlug.has(adventure.locationSlug);
    if (isRealPlace && !packLocations.has(adventure.locationSlug)) {
      issues.push({
        worldSlug: pack.worldSlug,
        kind: 'ADVENTURE_OUTSIDE_PACK_LOCATIONS',
        id: slug,
        detail: `Pack for "${pack.worldSlug}" claims adventure "${slug}", which is played at "${adventure.locationSlug}", a place this pack does not own.`,
      });
    }
  }

  return issues;
}

/** Ids claimed by more than one pack, per content kind. Empty means clean. */
export function findDoubleClaimedIds(packs: readonly WorldContentPack[]): string[] {
  const keys = [
    'locationSlugs',
    'adventureSlugs',
    'questIds',
    'itemIds',
    'collectibleSetIds',
    'npcIds',
    'discoveryIds',
    'storySlugs',
  ] as const;

  const doubled: string[] = [];
  for (const key of keys) {
    const seen = new Set<string>();
    for (const pack of packs) {
      for (const id of pack[key]) {
        if (seen.has(id)) doubled.push(`${key}:${id}`);
        seen.add(id);
      }
    }
  }
  return doubled;
}

/**
 * Authored ids no pack claims, per content kind.
 *
 * The complement of `findDoubleClaimedIds`, and the more important half:
 * content belonging to no world is content that has quietly opted out of
 * every rule a world imposes, including which children can reach it.
 */
export function findUnclaimedIds(
  packs: readonly WorldContentPack[],
  registries: WorldContentRegistries,
): string[] {
  const claimed = (key: keyof WorldContentPack): Set<string> =>
    new Set(packs.flatMap((pack) => pack[key] as readonly string[]));

  const unclaimed: string[] = [];
  const check = (label: string, authored: readonly string[], key: keyof WorldContentPack) => {
    const owned = claimed(key);
    for (const id of authored) {
      if (!owned.has(id)) unclaimed.push(`${label}:${id}`);
    }
  };

  check(
    'locationSlugs',
    registries.locations.map((entry) => entry.slug),
    'locationSlugs',
  );
  check(
    'adventureSlugs',
    registries.adventures.map((entry) => entry.slug),
    'adventureSlugs',
  );
  check(
    'questIds',
    registries.quests.map((entry) => entry.id),
    'questIds',
  );
  check(
    'itemIds',
    registries.items.map((entry) => entry.id),
    'itemIds',
  );
  check(
    'collectibleSetIds',
    registries.collectibleSets.map((entry) => entry.id),
    'collectibleSetIds',
  );
  check(
    'npcIds',
    registries.npcs.map((entry) => entry.id),
    'npcIds',
  );
  check(
    'discoveryIds',
    registries.discoveries.map((entry) => entry.id),
    'discoveryIds',
  );
  check(
    'storySlugs',
    registries.stories.map((entry) => entry.slug),
    'storySlugs',
  );

  return unclaimed;
}
