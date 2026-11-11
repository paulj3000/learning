import { describe, expect, it } from 'vitest';
import { listLocationsInWorld } from '../island/locations';
import { buildIslandExplorer, DEFAULT_LOCKED_HINT } from './islandExplorer';
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
