import { describe, expect, it } from 'vitest';
import { WORLD_DEFINITIONS, getHomeWorld, getWorld } from './worlds';
import { ISLAND_LOCATIONS, listLocationsInWorld } from '../island/locations';
import { CREATURE_CARE_COVE_SLUG, HOME_WORLD_SLUG } from './slugs';

describe('the world registry', () => {
  it('uses unique slugs', () => {
    const slugs = WORLD_DEFINITIONS.map((world) => world.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('has exactly one home world, and it is the island the product is named after', () => {
    const homes = WORLD_DEFINITIONS.filter((world) => world.isHome);
    expect(homes.map((world) => world.slug)).toEqual([HOME_WORLD_SLUG]);
    expect(getHomeWorld().slug).toBe(HOME_WORLD_SLUG);
  });

  /**
   * A world nobody can sail to and that nobody starts in is unreachable
   * content, whatever else is authored for it.
   */
  it('gives every world except home a travel requirement, and home none', () => {
    for (const world of WORLD_DEFINITIONS) {
      if (world.isHome) {
        expect(world.travelRequirement, world.slug).toBeUndefined();
      } else {
        expect(world.travelRequirement?.anyOfChangeKeys.length ?? 0, world.slug).toBeGreaterThan(0);
      }
    }
  });

  it('lands every arrival at a location that world actually owns', () => {
    for (const world of WORLD_DEFINITIONS) {
      if (!world.arrival) continue;
      const owned = listLocationsInWorld(world.slug).map((location) => location.slug);
      expect(owned, world.slug).toContain(world.arrival.locationSlug);
    }
  });

  it('gives the home world no arrival record, since a child does not arrive where they live', () => {
    expect(getHomeWorld().arrival).toBeUndefined();
  });

  it('claims every authored location for a world that exists', () => {
    for (const location of ISLAND_LOCATIONS) {
      expect(getWorld(location.worldSlug), location.slug).toBeDefined();
    }
  });

  it('supports at least one age band per world, so no world is authored for nobody', () => {
    for (const world of WORLD_DEFINITIONS) {
      expect(world.supportedAgeBands.length, world.slug).toBeGreaterThan(0);
    }
  });

  it('avoids em dashes in child-facing copy (CLAUDE.md section 13)', () => {
    for (const world of WORLD_DEFINITIONS) {
      for (const line of [
        world.title,
        world.tagline,
        world.description,
        world.arrival?.text ?? '',
        world.travelRequirement?.lockedHint ?? '',
      ]) {
        expect(line, world.slug).not.toContain('—');
      }
    }
  });

  /**
   * A locked route has to leave a thread to pull, the same rule
   * `DiscoveryDefinition.lockedMessage` follows. A hint that only says no is
   * the dark pattern CLAUDE.md pillar 7 rules out.
   */
  it('writes a locked hint that names what would open the route', () => {
    const cove = getWorld(CREATURE_CARE_COVE_SLUG);
    expect(cove?.travelRequirement?.lockedHint).toContain('Pirate Builder Bay');
  });
});
