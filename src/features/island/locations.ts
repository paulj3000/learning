export interface IslandLocation {
  slug: string;
  title: string;
  tagline: string;
  description: string;
  skills: string[];
  /** What the island currently looks like here, before any adventure runs. */
  decoration: string;
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
    decoration: 'The Wonder Wall is quiet for now. The first curiosity adventure is coming soon.',
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
];

export function getIslandLocation(slug: string): IslandLocation | undefined {
  return ISLAND_LOCATIONS.find((location) => location.slug === slug);
}
