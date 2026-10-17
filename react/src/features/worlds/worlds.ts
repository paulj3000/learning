/**
 * The world registry (docs/ROADMAP.md Phase 29, "world/region registry").
 *
 * Source-controlled content, like `ISLAND_LOCATIONS` and
 * `LEARNING_OBJECTIVES` - `docs/DATA_MODEL.md` calls this "content-managed
 * reference data" for an admin/content-designer role that does not exist
 * yet, so there is no backend model behind it and Phase 29 adds none. A
 * world is authored, reviewed, and shipped; it is never created at runtime.
 */
import { CREATURE_CARE_COVE_SLUG, HOME_WORLD_SLUG } from './slugs';
import type { WorldDefinition } from './types';

export const WORLD_DEFINITIONS: WorldDefinition[] = [
  {
    slug: HOME_WORLD_SLUG,
    title: 'Learning Adventure Island',
    tagline: 'Your home island, with the harbor, the bay, the forest, and the castle.',
    description:
      'The island where you started. Pip is building in the bay, Quill is writing in the castle, and the forest is full of questions.',
    isHome: true,
    supportedAgeBands: ['SPROUT', 'PATHFINDER', 'EXPLORER'],
    // No `arrival`: Welcome Harbor has been the home hub since Phase 2, and
    // a child does not arrive where they already live.
  },
  {
    slug: CREATURE_CARE_COVE_SLUG,
    title: 'Creature Care Cove',
    tagline: 'A small island where rescued sea creatures rest before they go home.',
    description:
      'A curved beach with shallow pools and a row of care pens. Nella the cove keeper looks after sea creatures here until they are strong enough to swim home again.',
    supportedAgeBands: ['SPROUT', 'PATHFINDER', 'EXPLORER'],
    arrival: {
      locationSlug: 'cove-care-beach',
      text: 'The boat slides onto pale sand. Along the beach, someone is counting buckets out loud.',
      changeKey: 'ARRIVED_AT_CREATURE_CARE_COVE',
    },
    /**
     * Opened by helping Pip at the bay, in either of the two ways the bay is
     * authored: Sprouts and Pathfinders repair the bridge, Explorers set the
     * tide gate. Gating on one key would have shut Explorers out of the whole
     * world.
     */
    travelRequirement: {
      anyOfChangeKeys: ['BRIDGE_REPAIRED', 'TIDE_GATE_SET'],
      lockedHint:
        'The little boat at the end of the dock is not ready yet. Help Pip at Pirate Builder Bay, and he will get it sailing.',
    },
  },
];

export function getWorld(slug: string): WorldDefinition | undefined {
  return WORLD_DEFINITIONS.find((world) => world.slug === slug);
}

/** The world every child starts in. Authored, so this never returns undefined in practice. */
export function getHomeWorld(): WorldDefinition {
  const home = WORLD_DEFINITIONS.find((world) => world.isHome);
  if (!home) {
    throw new Error('No home world is registered.');
  }
  return home;
}
