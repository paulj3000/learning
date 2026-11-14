import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeDjangoClient, type FakeDjangoClient } from '../../test/fakeDjangoClient';

const holder = vi.hoisted(() => ({ client: null as FakeDjangoClient | null }));
vi.mock('../../api/djangoClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/djangoClient')>()),
  djangoClient: () => holder.client,
}));

import { EMPTY_CATALOG, isAdventureAvailable, isIslandAvailable } from './availability';
import { loadCatalogSnapshot } from './availabilityApi';

const AVAILABILITY = 'children/child-1/availability/';
let api: FakeDjangoClient;

beforeEach(() => {
  api = fakeDjangoClient();
  holder.client = api;
});

describe('loadCatalogSnapshot on Django (AMP-03)', () => {
  it('maps places and adventures onto the availability rule', async () => {
    api.on('GET', AVAILABILITY, {
      places: [
        { slug: 'pirate-builder-bay', active: true },
        { slug: 'wonderwild-forest', active: false },
      ],
      adventures: [
        { slug: 'repair-bridge', placeSlug: 'pirate-builder-bay', active: false },
        { slug: 'bee-dance', placeSlug: 'wonderwild-forest', active: true },
      ],
    });
    const catalog = await loadCatalogSnapshot('child-1');
    expect(isIslandAvailable(catalog, 'pirate-builder-bay')).toBe(true);
    expect(isIslandAvailable(catalog, 'wonderwild-forest')).toBe(false);
    expect(isAdventureAvailable(catalog, 'repair-bridge', 'pirate-builder-bay')).toBe(false);
    // An active adventure on a place out of play is out of play too.
    expect(isAdventureAvailable(catalog, 'bee-dance', 'wonderwild-forest')).toBe(false);
    expect(isAdventureAvailable(catalog, 'not-in-catalog', undefined)).toBe(true);
  });

  it('fails open to the empty catalog on any failure', async () => {
    expect(await loadCatalogSnapshot('child-1')).toBe(EMPTY_CATALOG);
    api.on('GET', AVAILABILITY, { places: 'nope' });
    expect(await loadCatalogSnapshot('child-1')).toBe(EMPTY_CATALOG);
  });
});
