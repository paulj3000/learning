import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCKED_HINT, buildRealms, type Realm } from './realmCatalog';
import { testCatalog, testIsland, testPlace } from './testCatalog';

const CHILD = 'child-1';

function bySlug(realms: Realm[], slug: string): Realm {
  const realm = realms.find((candidate) => candidate.slug === slug);
  if (!realm) throw new Error(`no realm ${slug}`);
  return realm;
}

describe('buildRealms (AP-03)', () => {
  it('lists the home Realm first, then open Realms, then locked ones', () => {
    const realms = buildRealms(CHILD, testCatalog());
    expect(realms.map((realm) => [realm.slug, realm.state])).toEqual([
      ['learning-adventure-island', 'AVAILABLE'],
      ['creature-care-cove', 'LOCKED'],
    ]);
  });

  it('keeps the catalog’s subjects, ages, progress and picture as Django sent them', () => {
    const home = bySlug(buildRealms(CHILD, testCatalog()), 'learning-adventure-island');
    expect(home).toMatchObject({
      title: 'Learning Adventure Island',
      description: 'The island where you started.',
      subjectAreas: ['MATH', 'READING', 'SCIENCE', 'CREATIVITY'],
      ageBands: ['SPROUT', 'PATHFINDER', 'EXPLORER'],
      progress: { explored: 1, total: 3 },
      thumbnailAssetId: null,
      detailHref: '/island/child-1/realms/learning-adventure-island',
    });
  });

  it('links home Places to their page and their published 3D Area', () => {
    const home = bySlug(buildRealms(CHILD, testCatalog()), 'learning-adventure-island');
    const places = Object.fromEntries(home.places.map((place) => [place.slug, place]));
    expect(places['pirate-builder-bay']).toMatchObject({
      href: '/island/child-1/locations/pirate-builder-bay',
      area: { title: 'Treasure Cove', href: '/island/child-1/explore/treasure-rush-cove' },
    });
    expect(places['storykeeper-castle'].href).toBe('/island/child-1/locations/storykeeper-castle');
    // Firepeak exists only in Django: straight to its 3D Area, no source page.
    expect(places['firepeak-volcano']).toMatchObject({
      href: null,
      area: { href: '/island/child-1/explore/firepeak-volcano' },
    });
    // Nothing to open yet: left out rather than shown as a dead card.
    expect(places['django-only-meadow']).toBeUndefined();
  });

  it('starts at the first Place not yet explored, and continues an open session', () => {
    const fresh = bySlug(buildRealms(CHILD, testCatalog()), 'learning-adventure-island');
    expect(fresh.startHref).toBe('/island/child-1/locations/storykeeper-castle');
    expect(fresh.continueHref).toBeNull();

    const resumed = bySlug(
      buildRealms(CHILD, testCatalog({ resume: true })),
      'learning-adventure-island',
    );
    expect(resumed.continueHref).toBe('/island/child-1/explore/treasure-rush-cove');
    expect(resumed.places[0].area?.inProgress).toBe(true);
  });

  it('never offers a way into a locked Realm, and shows its authored hint', () => {
    const cove = bySlug(buildRealms(CHILD, testCatalog()), 'creature-care-cove');
    expect(cove).toMatchObject({
      state: 'LOCKED',
      lockedHint: 'Help Pip at Pirate Builder Bay first.',
      startHref: null,
      continueHref: null,
      places: [],
    });
  });

  it('uses a calm default when a locked Realm has no hint', () => {
    const view = {
      autoSelectIslandId: null,
      islands: [testIsland('far-isle', { unlocked: false, lockedHint: null })],
    };
    const [realm] = buildRealms(CHILD, view);
    expect(realm.lockedHint).toBe(DEFAULT_LOCKED_HINT);
    expect(DEFAULT_LOCKED_HINT).not.toMatch(/—/);
  });

  it('enters another open Realm through its hub, which records the arrival', () => {
    const cove = bySlug(
      buildRealms(CHILD, testCatalog({ coveUnlocked: true })),
      'creature-care-cove',
    );
    expect(cove.state).toBe('AVAILABLE');
    expect(cove.startHref).toBe('/island/child-1/worlds/creature-care-cove');
    // Its Places are shown for discovery but are reached from the hub.
    expect(cove.places.map((place) => [place.slug, place.href, place.area])).toEqual([
      ['cove-care-beach', null, null],
    ]);
  });

  it('calls an open Realm with nothing published for this child unavailable', () => {
    const view = {
      autoSelectIslandId: null,
      islands: [
        testIsland('empty-isle', { isHome: true, places: [testPlace('django-only-meadow')] }),
      ],
    };
    const [realm] = buildRealms(CHILD, view);
    expect(realm).toMatchObject({ state: 'UNAVAILABLE', startHref: null, continueHref: null });
  });

  it('encodes the child id in every link', () => {
    const [home] = buildRealms('a/b', testCatalog());
    expect(home.detailHref).toBe('/island/a%2Fb/realms/learning-adventure-island');
  });
});
