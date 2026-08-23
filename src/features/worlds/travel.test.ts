import { describe, expect, it } from 'vitest';
import {
  canTravelTo,
  filterToReachableWorlds,
  isWorldForAgeBand,
  isWorldUnlocked,
  listTravelDestinations,
  reachableWorldSlugs,
} from './travel';
import { CREATURE_CARE_COVE_SLUG, HOME_WORLD_SLUG } from './slugs';

describe('isWorldUnlocked', () => {
  it('is always open when there is no travel requirement', () => {
    expect(isWorldUnlocked({ travelRequirement: undefined }, [])).toBe(true);
  });

  it('is closed until one of the named changes is recorded', () => {
    const world = {
      travelRequirement: { anyOfChangeKeys: ['A', 'B'], lockedHint: 'not yet' },
    };
    expect(isWorldUnlocked(world, [])).toBe(false);
    expect(isWorldUnlocked(world, ['SOMETHING_ELSE'])).toBe(false);
    expect(isWorldUnlocked(world, ['B'])).toBe(true);
  });
});

describe('the cove route', () => {
  /**
   * The reason `anyOfChangeKeys` exists. Sprouts and Pathfinders repair the
   * bridge; Explorers at the same place set the tide gate instead. A
   * single-key requirement would have locked every seven and eight year old
   * out of the second world entirely, which is the same age-band gap the
   * post-Phase-27 fix was written to close.
   */
  it('opens for a Pathfinder who repaired the bridge', () => {
    expect(canTravelTo(CREATURE_CARE_COVE_SLUG, ['BRIDGE_REPAIRED'], 'PATHFINDER')).toBe(true);
  });

  it('opens for an Explorer who set the tide gate instead', () => {
    expect(canTravelTo(CREATURE_CARE_COVE_SLUG, ['TIDE_GATE_SET'], 'EXPLORER')).toBe(true);
  });

  it('opens for a Sprout who repaired the bridge at their own band', () => {
    expect(canTravelTo(CREATURE_CARE_COVE_SLUG, ['BRIDGE_REPAIRED'], 'SPROUT')).toBe(true);
  });

  it('stays closed for a child who has done neither', () => {
    expect(canTravelTo(CREATURE_CARE_COVE_SLUG, [], 'PATHFINDER')).toBe(false);
  });
});

describe('the home world', () => {
  it('is reachable by every band with no world changes at all', () => {
    for (const band of ['SPROUT', 'PATHFINDER', 'EXPLORER'] as const) {
      expect(reachableWorldSlugs([], band)).toContain(HOME_WORLD_SLUG);
    }
  });
});

describe('isWorldForAgeBand', () => {
  it('excludes a world authored for other bands', () => {
    expect(isWorldForAgeBand({ supportedAgeBands: ['EXPLORER'] }, 'SPROUT')).toBe(false);
    expect(isWorldForAgeBand({ supportedAgeBands: ['EXPLORER'] }, 'EXPLORER')).toBe(true);
  });
});

describe('listTravelDestinations', () => {
  it('lists a closed world with its hint rather than hiding it', () => {
    const deck = listTravelDestinations({ worldChangeKeys: [], ageBand: 'PATHFINDER' });
    const cove = deck.find((entry) => entry.world.slug === CREATURE_CARE_COVE_SLUG);

    expect(cove).toBeDefined();
    expect(cove?.isUnlocked).toBe(false);
    expect(cove?.lockedHint).toBeTruthy();
  });

  it('drops the hint once the route opens', () => {
    const deck = listTravelDestinations({
      worldChangeKeys: ['BRIDGE_REPAIRED'],
      ageBand: 'PATHFINDER',
    });
    const cove = deck.find((entry) => entry.world.slug === CREATURE_CARE_COVE_SLUG);

    expect(cove?.isUnlocked).toBe(true);
    expect(cove?.lockedHint).toBeUndefined();
  });

  it('marks where the child is standing, defaulting to home', () => {
    const fromHome = listTravelDestinations({ worldChangeKeys: [], ageBand: 'PATHFINDER' });
    expect(fromHome.find((entry) => entry.isCurrent)?.world.slug).toBe(HOME_WORLD_SLUG);

    const fromCove = listTravelDestinations({
      fromWorldSlug: CREATURE_CARE_COVE_SLUG,
      worldChangeKeys: ['BRIDGE_REPAIRED'],
      ageBand: 'PATHFINDER',
    });
    expect(fromCove.find((entry) => entry.isCurrent)?.world.slug).toBe(CREATURE_CARE_COVE_SLUG);
  });
});

describe('filterToReachableWorlds', () => {
  const worldOf = (slug: string) =>
    ({ 'cove-care-beach': CREATURE_CARE_COVE_SLUG, 'pirate-builder-bay': HOME_WORLD_SLUG })[slug];

  it('drops content in a world the child cannot sail to', () => {
    const items = [{ at: 'pirate-builder-bay' }, { at: 'cove-care-beach' }];
    const kept = filterToReachableWorlds(items, (item) => item.at, worldOf, [HOME_WORLD_SLUG]);

    expect(kept).toEqual([{ at: 'pirate-builder-bay' }]);
  });

  /**
   * Phase 15's arc challenges sit at story-only pseudo-locations that are on
   * no map at all. They are reached by reading a story, not by sailing, so
   * filtering them out would hide most of the adventure library.
   */
  it('keeps content at a story-only pseudo-location', () => {
    const items = [{ at: 'ember-mountain' }];
    const kept = filterToReachableWorlds(items, (item) => item.at, worldOf, [HOME_WORLD_SLUG]);

    expect(kept).toEqual(items);
  });
});
