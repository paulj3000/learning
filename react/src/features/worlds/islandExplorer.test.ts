import { describe, expect, it } from 'vitest';
import { listLocationsInWorld } from '../island/locations';
import {
  buildIslandExplorer,
  buildIslandExplorerFromServer,
  DEFAULT_LOCKED_HINT,
} from './islandExplorer';
import type { IslandsView } from '../../api/play/islandsApi';
import { listTravelDestinations } from './travel';
import { getHomeWorld, getWorld } from './worlds';
import { CREATURE_CARE_COVE_SLUG } from './slugs';
import type { AgeBandValue } from '../child-profile/constants';
import type { TravelDestination } from './types';

const CHILD = 'child-1';
const homeLocations = listLocationsInWorld(getHomeWorld().slug);

function explore(
  worldChangeKeys: string[] = [],
  ageBand: AgeBandValue = 'PATHFINDER',
  hiddenLocationSlugs: string[] = [],
) {
  return buildIslandExplorer({
    childId: CHILD,
    destinations: listTravelDestinations({ worldChangeKeys, ageBand }),
    currentIslandLocations: homeLocations,
    worldChangeKeys,
    hiddenLocationSlugs,
  });
}

describe('buildIslandExplorer (LAI-0808)', () => {
  it('puts the island the child is on first, with its places as links', () => {
    const [here] = explore();
    expect(here.slug).toBe(getHomeWorld().slug);
    expect(here.status).toBe('HERE');
    expect(here.href).toBeUndefined();
    expect(here.places.map((place) => place.slug)).toEqual(
      expect.arrayContaining(['pirate-builder-bay', 'wonderwild-forest', 'storykeeper-castle']),
    );
    expect(here.places[0].href).toBe(`/island/${CHILD}/locations/${here.places[0].slug}`);
  });

  it('shows a locked island with its authored hint and no link', () => {
    const cove = explore().find((island) => island.slug === CREATURE_CARE_COVE_SLUG);
    expect(cove?.status).toBe('LOCKED');
    expect(cove?.href).toBeUndefined();
    expect(cove?.lockedHint).toBe(getWorld(CREATURE_CARE_COVE_SLUG)?.travelRequirement?.lockedHint);
    expect(cove?.places).toEqual([]);
  });

  it.each([
    ['PATHFINDER', 'BRIDGE_REPAIRED'],
    ['SPROUT', 'BRIDGE_REPAIRED'],
    ['EXPLORER', 'TIDE_GATE_SET'],
  ] as const)('opens the cove for a %s after %s, linking to its hub', (band, key) => {
    const cove = explore([key], band).find((island) => island.slug === CREATURE_CARE_COVE_SLUG);
    expect(cove?.status).toBe('OPEN');
    expect(cove?.href).toBe(`/island/${CHILD}/worlds/${CREATURE_CARE_COVE_SLUG}`);
    expect(cove?.lockedHint).toBeUndefined();
  });

  it('keeps secret places hidden until their change key is recorded', () => {
    const before = explore()[0].places.map((place) => place.slug);
    expect(before).not.toContain('dragons-sanctuary');
    const after = explore(['DRAGON_OF_EMBER_MOUNTAIN_COMPLETE'])[0].places.map((p) => p.slug);
    expect(after).toContain('dragons-sanctuary');
  });

  it('never shows a place an admin has switched off', () => {
    const slugs = explore([], 'PATHFINDER', ['wonderwild-forest'])[0].places.map((p) => p.slug);
    expect(slugs).not.toContain('wonderwild-forest');
    expect(slugs).toContain('pirate-builder-bay');
  });

  it('never lists another island’s places on the home island', () => {
    const slugs = explore()[0].places.map((place) => place.slug);
    expect(slugs).not.toContain('cove-care-beach');
  });

  it('orders here, then open, then locked, keeping authored order within a status', () => {
    const home = getHomeWorld();
    const make = (slug: string, isUnlocked: boolean, isCurrent = false): TravelDestination => ({
      world: { ...home, slug, title: slug, isHome: false },
      isUnlocked,
      isCurrent,
      lockedHint: isUnlocked ? undefined : `hint ${slug}`,
    });
    const islands = buildIslandExplorer({
      childId: CHILD,
      destinations: [
        make('locked-a', false),
        make('open-a', true),
        make('home', true, true),
        make('locked-b', false),
        make('open-b', true),
      ],
      currentIslandLocations: [],
      worldChangeKeys: [],
      hiddenLocationSlugs: [],
    });
    expect(islands.map((island) => island.slug)).toEqual([
      'home',
      'open-a',
      'open-b',
      'locked-a',
      'locked-b',
    ]);
  });

  it('lists Django-served places on the home island after its source places (ADR-047)', () => {
    const firepeak = {
      slug: 'firepeak-volcano',
      title: 'Firepeak Volcano',
      tagline: 'A warm mountain',
      href: `/island/${CHILD}/world/firepeak-volcano`,
    };
    const [here, ...others] = buildIslandExplorer({
      childId: CHILD,
      destinations: listTravelDestinations({ worldChangeKeys: [], ageBand: 'PATHFINDER' }),
      currentIslandLocations: homeLocations,
      worldChangeKeys: [],
      hiddenLocationSlugs: [],
      servedPlaces: [firepeak, { ...firepeak, slug: 'pirate-builder-bay', href: '/dup' }],
    });
    expect(here.places.at(-1)).toEqual(firepeak);
    expect(here.places.filter((place) => place.slug === 'pirate-builder-bay')).toHaveLength(1);
    expect(here.places.find((place) => place.slug === 'pirate-builder-bay')?.href).not.toBe('/dup');
    expect(others.every((island) => island.places.length === 0)).toBe(true);
  });

  it('gives a locked world with no authored hint a calm fallback line', () => {
    const home = getHomeWorld();
    const [island] = buildIslandExplorer({
      childId: CHILD,
      destinations: [{ world: { ...home, slug: 'quiet' }, isUnlocked: false, isCurrent: false }],
      currentIslandLocations: [],
      worldChangeKeys: [],
      hiddenLocationSlugs: [],
    });
    expect(island.lockedHint).toBe(DEFAULT_LOCKED_HINT);
    expect(DEFAULT_LOCKED_HINT).not.toMatch(/—/);
  });
});

describe('buildIslandExplorerFromServer (AP-03)', () => {
  const area = (regionId: string, available = true) => ({ regionId, title: regionId, available });
  const place = (
    placeId: string,
    options: { area?: ReturnType<typeof area> | null; explored?: boolean } = {},
  ) => ({
    placeId,
    title: placeId,
    tagline: `${placeId} tagline`,
    adventureCount: 1,
    explored: options.explored ?? false,
    area: options.area ?? null,
  });
  const island = (
    islandId: string,
    overrides: Partial<IslandsView['islands'][number]> = {},
  ): IslandsView['islands'][number] => ({
    islandId,
    title: islandId,
    tagline: `${islandId} tagline`,
    isHome: false,
    ageBands: ['SPROUT', 'PATHFINDER', 'EXPLORER'],
    subjects: ['Counting'],
    thumbnailAssetId: null,
    unlocked: true,
    lockedHint: null,
    progress: { placesExplored: 0, placesTotal: 0 },
    places: [],
    ...overrides,
  });
  const view = (...islands: IslandsView['islands']): IslandsView => ({
    islands,
    autoSelectIslandId: null,
  });

  it('links source Places to their page and offers a published 3D Area beside them', () => {
    const [here] = buildIslandExplorerFromServer(
      CHILD,
      view(
        island('learning-adventure-island', {
          isHome: true,
          places: [
            place('pirate-builder-bay', {
              area: { regionId: 'treasure-rush-cove', title: 'Treasure Cove', available: true },
              explored: true,
            }),
            place('storykeeper-castle'),
          ],
        }),
      ),
    );
    expect(here.status).toBe('HERE');
    expect(here.places).toEqual([
      {
        slug: 'pirate-builder-bay',
        title: 'pirate-builder-bay',
        tagline: 'pirate-builder-bay tagline',
        explored: true,
        href: `/island/${CHILD}/locations/pirate-builder-bay`,
        area: { title: 'Treasure Cove', href: `/island/${CHILD}/explore/treasure-rush-cove` },
      },
      {
        slug: 'storykeeper-castle',
        title: 'storykeeper-castle',
        tagline: 'storykeeper-castle tagline',
        explored: false,
        href: `/island/${CHILD}/locations/storykeeper-castle`,
        area: undefined,
      },
    ]);
  });

  it('sends a Django-only Place straight to its 3D Area and leaves out one with nowhere to go', () => {
    const [here] = buildIslandExplorerFromServer(
      CHILD,
      view(
        island('learning-adventure-island', {
          isHome: true,
          places: [
            place('firepeak-volcano', { area: area('firepeak-volcano') }),
            place('not-built-yet'),
            place('area-unavailable', { area: area('somewhere', false) }),
          ],
        }),
      ),
    );
    expect(here.places.map((p) => [p.slug, p.href])).toEqual([
      ['firepeak-volcano', `/island/${CHILD}/explore/firepeak-volcano`],
    ]);
  });

  it('shows a closed Island with its hint, or the calm default, and never a link', () => {
    const islands = buildIslandExplorerFromServer(
      CHILD,
      view(
        island('learning-adventure-island', { isHome: true }),
        island('creature-care-cove', { unlocked: false, lockedHint: 'Help Pip first.' }),
        island('quiet-isle', { unlocked: false }),
      ),
    );
    expect(islands[1]).toMatchObject({ status: 'LOCKED', lockedHint: 'Help Pip first.' });
    expect(islands[2]).toMatchObject({ status: 'LOCKED', lockedHint: DEFAULT_LOCKED_HINT });
    expect(islands[1].href).toBeUndefined();
  });

  it('links an open Island to its hub and orders here, open, locked', () => {
    const islands = buildIslandExplorerFromServer(
      CHILD,
      view(
        island('locked-isle', { unlocked: false }),
        island('creature-care-cove'),
        island('learning-adventure-island', { isHome: true }),
      ),
    );
    expect(islands.map((i) => [i.slug, i.status])).toEqual([
      ['learning-adventure-island', 'HERE'],
      ['creature-care-cove', 'OPEN'],
      ['locked-isle', 'LOCKED'],
    ]);
    expect(islands[1].href).toBe(`/island/${CHILD}/worlds/creature-care-cove`);
  });

  it('carries subjects, age bands and places explored from the server', () => {
    const [here] = buildIslandExplorerFromServer(
      CHILD,
      view(
        island('learning-adventure-island', {
          isHome: true,
          subjects: ['Counting', 'Vocabulary'],
          ageBands: ['PATHFINDER'],
          progress: { placesExplored: 2, placesTotal: 5 },
        }),
      ),
    );
    expect(here.subjects).toEqual(['Counting', 'Vocabulary']);
    expect(here.ageBands).toEqual(['PATHFINDER']);
    expect(here.progress).toEqual({ explored: 2, total: 5 });
  });
});
