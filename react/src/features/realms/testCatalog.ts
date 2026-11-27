import type { IslandSummary, IslandsView, PlaceSummary } from '../../api/play/islandsApi';

/**
 * Test fixtures shaped like `GET /children/<id>/islands/` for the content published today:
 * the home Realm with Pirate Builder Bay (its 3D Area is Treasure Cove), Storykeeper Castle and
 * Firepeak Volcano (Django-only, 3D Area only), and the locked Creature Care Cove.
 */
export function testPlace(placeId: string, overrides: Partial<PlaceSummary> = {}): PlaceSummary {
  return {
    placeId,
    title: placeId,
    tagline: `${placeId} tagline`,
    description: '',
    skills: [],
    subjectAreas: [],
    thumbnailAssetId: null,
    adventureCount: 1,
    explored: false,
    seasonal: null,
    questCount: 0,
    questsCompleted: 0,
    questsInProgress: 0,
    completed: false,
    area: null,
    ...overrides,
  };
}

export function testArea(regionId: string, title: string, resumeSessionId: string | null = null) {
  return {
    regionId,
    title,
    available: true,
    status: resumeSessionId ? ('IN_PROGRESS' as const) : ('NOT_STARTED' as const),
    resumeSessionId,
  };
}

export function testIsland(
  islandId: string,
  overrides: Partial<IslandSummary> = {},
): IslandSummary {
  return {
    islandId,
    title: islandId,
    tagline: `${islandId} tagline`,
    description: '',
    isHome: false,
    ageBands: ['SPROUT', 'PATHFINDER', 'EXPLORER'],
    subjects: [],
    subjectAreas: [],
    thumbnailAssetId: null,
    unlocked: true,
    lockedHint: null,
    progress: null,
    places: [],
    ...overrides,
  };
}

export function testCatalog(
  options: { resume?: boolean; coveUnlocked?: boolean } = {},
): IslandsView {
  return {
    autoSelectIslandId: null,
    islands: [
      testIsland('creature-care-cove', {
        title: 'Creature Care Cove',
        subjectAreas: ['MATH', 'READING', 'SCIENCE'],
        ageBands: ['PATHFINDER', 'EXPLORER'],
        unlocked: options.coveUnlocked ?? false,
        lockedHint: 'Help Pip at Pirate Builder Bay first.',
        progress: { placesExplored: 0, placesTotal: 1 },
        places: [testPlace('cove-care-beach', { title: 'The Care Beach' })],
      }),
      testIsland('learning-adventure-island', {
        title: 'Learning Adventure Island',
        description: 'The island where you started.',
        isHome: true,
        subjectAreas: ['MATH', 'READING', 'SCIENCE', 'CREATIVITY'],
        progress: { placesExplored: 1, placesTotal: 3 },
        places: [
          testPlace('pirate-builder-bay', {
            title: 'Pirate Builder Bay',
            subjectAreas: ['MATH'],
            explored: true,
            area: testArea('treasure-rush-cove', 'Treasure Cove', options.resume ? 's-1' : null),
          }),
          testPlace('storykeeper-castle', {
            title: 'Storykeeper Castle',
            subjectAreas: ['READING', 'CREATIVITY'],
          }),
          testPlace('firepeak-volcano', {
            title: 'Firepeak Volcano',
            subjectAreas: ['SCIENCE'],
            adventureCount: 0,
            area: testArea('firepeak-volcano', 'Firepeak Volcano'),
          }),
          // A Django-only Place without a 3D Area has nothing to open yet.
          testPlace('django-only-meadow', { adventureCount: 0 }),
        ],
      }),
    ],
  };
}

/**
 * #98: North Pole as Django serves it. A seasonal Realm the client registers no hub for
 * (`WORLD_DEFINITIONS` has none), with North Pole Village's 3D Area. `available: false` is what
 * Django sends when nothing in the Area is published for the child's age band.
 */
export function northPoleTestIsland(
  options: { available?: boolean; resume?: boolean } = {},
): IslandSummary {
  const area = testArea('north-pole-village', 'North Pole Village', options.resume ? 's-np' : null);
  return testIsland('north-pole', {
    title: 'North Pole',
    description: 'A snowy village where the Christmas Star has gone out.',
    subjectAreas: ['MATH', 'SCIENCE'],
    progress: { placesExplored: 0, placesTotal: 1 },
    places: [
      testPlace('north-pole-village', {
        title: 'North Pole Village',
        adventureCount: 0,
        questCount: 9,
        area: { ...area, available: options.available ?? true },
      }),
    ],
  });
}

/** #100: the home Realm's Firepeak Places as Django serves them once their puzzles count. */
export function firepeakTestPlaces(): PlaceSummary[] {
  return [
    testPlace('firepeak-volcano', {
      title: 'Firepeak Volcano',
      subjectAreas: ['SCIENCE'],
      adventureCount: 0,
      area: testArea('firepeak-volcano', 'Firepeak Volcano'),
    }),
    testPlace('firepeak-heart', {
      title: 'Heart of Firepeak',
      subjectAreas: ['MATH', 'SCIENCE'],
      adventureCount: 0,
      questCount: 1,
      area: testArea('firepeak-heart', 'Heart of Firepeak'),
    }),
  ];
}
