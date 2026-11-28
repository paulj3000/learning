import { SOURCE_LOCATION_MANIFESTS } from './manifests';
import { HUB_REGION_ID, threeNavigationHref, threeRegionForNavigation } from './navigationTarget';

/**
 * GE-077: a NAVIGATE taken inside a Three.js world stays in Three.js whenever the place it names
 * has a 3D location. Only Phaser worlds with no 3D region yet may still be reached from 3D, and
 * that list may only shrink.
 */
const PHASER_ONLY_DESTINATIONS: Readonly<Record<string, string>> = {
  // Empty: no 3D exit names a Phaser-only world. The harbor's Fossil Ridge and Bolt's Workshop
  // paths open their location cards. Add an entry (with its ticket) only if one must.
};

describe('threeNavigationHref (GE-077)', () => {
  it('sends the Phaser harbor to the 3D Welcome Harbor hub', () => {
    expect(threeRegionForNavigation('world')).toBe(HUB_REGION_ID);
    expect(threeNavigationHref('child-1', 'world')).toBe('/island/child-1/explore/welcome-harbor');
  });

  it('sends a Phaser world with a 3D region to that region', () => {
    expect(threeNavigationHref('child-1', 'world/storykeeper-castle')).toBe(
      '/island/child-1/explore/storykeeper-castle',
    );
    expect(threeNavigationHref('child-1', 'world/pirate-builder-bay')).toBe(
      '/island/child-1/explore/pirate-builder-bay',
    );
  });

  it('leaves location cards, story pages and Phaser-only worlds alone', () => {
    expect(threeNavigationHref('child-1', 'locations/pirate-builder-bay')).toBe(
      '/island/child-1/locations/pirate-builder-bay',
    );
    expect(threeNavigationHref('child-1', 'world/fossil-ridge-camp')).toBe(
      '/island/child-1/world/fossil-ridge-camp',
    );
    expect(threeNavigationHref('child-1', '')).toBe('/island/child-1/');
    // A prefix that only looks like a Phaser world is not one.
    expect(threeRegionForNavigation('worldly')).toBeNull();
  });

  it('falls back to the Phaser harbor only if the 3D hub does not exist', () => {
    expect(threeNavigationHref('child-1', 'world', new Set(['storykeeper-castle']))).toBe(
      '/island/child-1/world',
    );
  });

  it('keeps every exit of every 3D location in Three.js, except listed Phaser-only worlds', () => {
    const leaks: string[] = [];
    const used = new Set<string>();
    for (const manifest of SOURCE_LOCATION_MANIFESTS) {
      for (const interaction of manifest.interactions) {
        if (interaction.action.kind !== 'NAVIGATE') continue;
        const { to } = interaction.action;
        const href = threeNavigationHref('c', to);
        if (!href.startsWith('/island/c/world')) continue;
        if (to in PHASER_ONLY_DESTINATIONS) used.add(to);
        else leaks.push(`${manifest.regionId}/${interaction.id} -> ${href}`);
      }
    }
    expect(leaks, '3D exits that land in a Phaser world').toEqual([]);
    // Shrink-only: a Phaser-only destination no 3D exit uses any more must be removed.
    expect(Object.keys(PHASER_ONLY_DESTINATIONS).filter((to) => !used.has(to))).toEqual([]);
  });
});
