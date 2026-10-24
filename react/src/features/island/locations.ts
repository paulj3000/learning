import { CREATURE_CARE_COVE_SLUG, HOME_WORLD_SLUG } from '../worlds/slugs';

export interface IslandLocation {
  slug: string;
  /**
   * The world this place belongs to (docs/ROADMAP.md Phase 29). Required
   * rather than defaulted, so a new location cannot quietly land on the home
   * island because nobody said where it was; `packs.test.ts` asserts every
   * location is claimed by exactly one world's content pack.
   */
  worldSlug: string;
  title: string;
  tagline: string;
  description: string;
  skills: string[];
  /** What the island currently looks like here, before any adventure runs. */
  decoration: string;
  /**
   * Present only for a secret/gated location (docs/ROADMAP.md Phase 16,
   * "location unlocking"). Absent means always visible, matching every MVP
   * location's existing behavior. `changeKey` is checked against the
   * child's full `WorldChange` history, not just this location's own
   * changes, since the unlocking event (e.g. finishing a story) usually
   * happened somewhere else.
   */
  unlockRequirement?: { changeKey: string };
}

/** Whether `location` should currently be visible/reachable for this child. */
export function isLocationUnlocked(
  location: Pick<IslandLocation, 'unlockRequirement'>,
  worldChangeKeys: readonly string[],
): boolean {
  return (
    !location.unlockRequirement || worldChangeKeys.includes(location.unlockRequirement.changeKey)
  );
}

/**
 * Static content for now (docs/DATA_MODEL.md calls this "content-managed
 * reference data" for an admin/content-designer role that does not exist
 * yet). Adventures themselves arrive in Phase 3 (docs/ROADMAP.md); these are
 * visitable, described, but not yet playable.
 */
export const ISLAND_LOCATIONS: IslandLocation[] = [
  {
    slug: 'pirate-builder-bay',
    worldSlug: HOME_WORLD_SLUG,
    title: 'Pirate Builder Bay',
    tagline: 'Counting, measuring, and building with Pirate Pip.',
    description:
      'A busy shipyard where crews count, measure, and build to keep the bay running. Great for counting, measurement, ordering, and following instructions.',
    skills: ['Counting', 'Measurement', 'Ordering', 'Instructions'],
    decoration: 'The bridge into the bay is still broken. A repair quest is coming soon.',
  },
  {
    slug: 'wonderwild-forest',
    worldSlug: HOME_WORLD_SLUG,
    title: 'Wonderwild Forest',
    tagline: 'Curious questions become nature adventures.',
    description:
      'A forest full of safe, curious questions waiting to be explored, like why bees dance or how seeds travel. Great for observation and early science reasoning.',
    skills: ['Observation', 'Curiosity', 'Cause and effect'],
    decoration: "The Wonder Wall's questions are still waiting for their first answer.",
  },
  {
    slug: 'storykeeper-castle',
    worldSlug: HOME_WORLD_SLUG,
    title: 'Storykeeper Castle',
    tagline: 'Collaborative stories, one choice at a time.',
    description:
      'A castle library where children help tell the story: predicting what happens next, sequencing events, and building vocabulary along the way.',
    skills: ['Prediction', 'Sequencing', 'Vocabulary'],
    decoration: 'The storybooks on the shelf are still blank. The first tale is coming soon.',
  },
  {
    slug: 'dragons-sanctuary',
    worldSlug: HOME_WORLD_SLUG,
    title: "The Dragon's Sanctuary",
    tagline: "A secret spot, discovered by finishing a dragon's story.",
    description:
      'Once smoking and mysterious, this mountain hollow is now home to a dragon who trusts you. Come visit her and her egg, safe at last.',
    skills: ['Empathy', 'Observation'],
    decoration: 'The dragon rests peacefully beside her egg.',
    unlockRequirement: { changeKey: 'DRAGON_OF_EMBER_MOUNTAIN_COMPLETE' },
  },
  {
    slug: 'fossil-ridge-camp',
    worldSlug: HOME_WORLD_SLUG,
    title: 'Fossil Ridge Camp',
    tagline: 'A secret spot, discovered by finishing a dinosaur mystery.',
    description:
      'The dig is finished, and a giant plant-eating dinosaur now stands fully assembled at camp. Come see what the evidence uncovered.',
    skills: ['Observation', 'Reasoning'],
    decoration: 'A huge assembled skeleton stands proudly at the ridge.',
    unlockRequirement: { changeKey: 'DINOSAUR_EXPEDITION_COMPLETE' },
  },
  {
    slug: 'castle-writing-room',
    worldSlug: HOME_WORLD_SLUG,
    title: 'The Writing Room',
    tagline: 'A secret spot, discovered by solving the castle mystery.',
    description:
      'A small round room behind the last bookshelf: a desk, a window, and shelves of empty books, left ready for whoever solved the door.',
    skills: ['Curiosity', 'Creative writing'],
    decoration: 'Shelves of empty books wait for their first stories.',
    unlockRequirement: { changeKey: 'THE_CASTLES_SECRET_DOOR_COMPLETE' },
  },
  {
    slug: 'bolts-workshop',
    worldSlug: HOME_WORLD_SLUG,
    title: "Bolt's Workshop",
    tagline: 'A secret spot, discovered by rescuing a harbor robot.',
    description:
      'Bolt the harbor robot is back together and rolling again. Stop by the workshop to see the repair up close.',
    skills: ['Problem-solving', 'Empathy'],
    decoration: 'Bolt rolls happily around the workshop, good as new.',
    unlockRequirement: { changeKey: 'ROBOT_RESCUE_COMPLETE' },
  },
  {
    /**
     * Clockwork Harbor (`docs/regions/clockwork.md`). A major explorable
     * region of the home island, not a second world: section 1 calls it "a
     * major explorable region within Learning Adventure Island", so it is an
     * `ISLAND_LOCATIONS` entry with its own first-person region id, the same
     * shape Storykeeper Castle already has.
     *
     * Ungated on purpose. The roadmap names a "Required progression" field in
     * section 6 but never says what would gate the harbor, and section 31's
     * definition of done opens with "enter and freely explore". Inventing an
     * `unlockRequirement` here would author a lock the roadmap did not ask
     * for; the harbor gates its own *interior* progress instead, through
     * `clockworkHarborState.ts`.
     */
    slug: 'clockwork-harbor',
    worldSlug: HOME_WORLD_SLUG,
    title: 'Clockwork Harbor',
    tagline: 'A seaside town of gears and machines that needs fixing.',
    description:
      'A colorful harbor town run by an old machine under the streets. The lighthouse has gone dark, the bridge is stuck, and something small and mechanical is taking pieces away. Great for building, measuring, patterns, and figuring things out.',
    skills: ['Building', 'Patterns', 'Measurement', 'Figuring things out'],
    decoration: 'The lighthouse is dark and the harbor gate is shut. Nobody knows why yet.',
  },
  /**
   * Creature Care Cove (docs/ROADMAP.md Phase 29). A second world, not a
   * secret corner of the first: neither location is gated by an
   * `unlockRequirement`, because the *route* is what a child earns, and
   * gating the places inside a world they have just sailed to would charge
   * them twice for the same journey.
   */
  {
    slug: 'cove-care-beach',
    worldSlug: CREATURE_CARE_COVE_SLUG,
    title: 'The Care Beach',
    tagline: 'Feeding, sorting, and looking after rescued sea creatures.',
    description:
      'A curve of pale sand lined with shallow care pens. Every creature here is waiting to get strong enough to swim home, and every one of them needs the right food, in the right amount, in the right order.',
    skills: ['Counting', 'Sorting', 'Caring routines'],
    decoration: 'The care pens are quiet. Nobody has been fed yet this morning.',
  },
  {
    slug: 'lantern-tide-pools',
    worldSlug: CREATURE_CARE_COVE_SLUG,
    title: 'The Lantern Tide Pools',
    tagline: 'A quiet place to sit and watch the water.',
    description:
      'Round pools left behind by the tide, each one holding a tiny world of its own. Nella hangs lanterns along the rocks so the pools can be visited after dark.',
    skills: ['Observation', 'Curiosity'],
    decoration: 'The lanterns along the rocks are unlit, waiting for someone to help at the cove.',
  },
];

/** Every location belonging to one world, in authored order (Phase 29). */
export function listLocationsInWorld(worldSlug: string): IslandLocation[] {
  return ISLAND_LOCATIONS.filter((location) => location.worldSlug === worldSlug);
}

/**
 * The world a location belongs to, or `undefined` for a story-only
 * pseudo-location slug (Phase 15's arc challenges carry slugs that are not
 * places on any map). Callers must treat `undefined` as "not on a map",
 * never as "the home island".
 */
export function getWorldSlugForLocation(locationSlug: string): string | undefined {
  return getIslandLocation(locationSlug)?.worldSlug;
}

export function getIslandLocation(slug: string): IslandLocation | undefined {
  return ISLAND_LOCATIONS.find((location) => location.slug === slug);
}
