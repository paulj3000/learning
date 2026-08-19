export interface IslandLocation {
  slug: string;
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
    title: 'Pirate Builder Bay',
    tagline: 'Counting, measuring, and building with Pirate Pip.',
    description:
      'A busy shipyard where crews count, measure, and build to keep the bay running. Great for counting, measurement, ordering, and following instructions.',
    skills: ['Counting', 'Measurement', 'Ordering', 'Instructions'],
    decoration: 'The bridge into the bay is still broken. A repair quest is coming soon.',
  },
  {
    slug: 'wonderwild-forest',
    title: 'Wonderwild Forest',
    tagline: 'Curious questions become nature adventures.',
    description:
      'A forest full of safe, curious questions waiting to be explored, like why bees dance or how seeds travel. Great for observation and early science reasoning.',
    skills: ['Observation', 'Curiosity', 'Cause and effect'],
    decoration: "The Wonder Wall's questions are still waiting for their first answer.",
  },
  {
    slug: 'storykeeper-castle',
    title: 'Storykeeper Castle',
    tagline: 'Collaborative stories, one choice at a time.',
    description:
      'A castle library where children help tell the story: predicting what happens next, sequencing events, and building vocabulary along the way.',
    skills: ['Prediction', 'Sequencing', 'Vocabulary'],
    decoration: 'The storybooks on the shelf are still blank. The first tale is coming soon.',
  },
  {
    slug: 'dragons-sanctuary',
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
    title: 'The Writing Room',
    tagline: 'A secret spot, discovered by solving the castle mystery.',
    description:
      'A small round room behind the last bookshelf: a desk, a window, and shelves of empty books, left ready for whoever solved the door.',
    skills: ['Curiosity', 'Creative writing'],
    decoration: 'Shelves of empty books wait for their first stories.',
    unlockRequirement: { changeKey: 'THE_CASTLES_SECRET_DOOR_COMPLETE' },
  },
];

export function getIslandLocation(slug: string): IslandLocation | undefined {
  return ISLAND_LOCATIONS.find((location) => location.slug === slug);
}
