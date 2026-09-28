import { describe, expect, it } from 'vitest';
import {
  EMPTY_CATALOG,
  isAdventureAvailable,
  isAdventurePlayable,
  isIslandAvailable,
  type CatalogSnapshot,
} from './availability';

function catalog(islandActive: boolean, adventureActive?: boolean): CatalogSnapshot {
  return {
    islands: [{ id: 'island-1', slug: 'pirate-builder-bay', active: islandActive }],
    adventures:
      adventureActive === undefined
        ? []
        : [{ slug: 'repair-the-moonlight-bridge', islandId: 'island-1', active: adventureActive }],
  };
}

describe('isAdventurePlayable (section 17 truth table)', () => {
  it.each([
    [true, true, true],
    [true, false, false],
    [false, true, false],
    [false, false, false],
  ])('island %s + adventure %s -> %s', (island, adventure, expected) => {
    expect(isAdventurePlayable({ active: island }, { active: adventure })).toBe(expected);
  });
});

describe('isAdventureAvailable', () => {
  it.each([
    [true, true, true],
    [true, false, false],
    [false, true, false],
    [false, false, false],
  ])('island row %s + adventure row %s -> %s', (island, adventure, expected) => {
    expect(
      isAdventureAvailable(
        catalog(island, adventure),
        'repair-the-moonlight-bridge',
        'pirate-builder-bay',
      ),
    ).toBe(expected);
  });

  it('treats content with no catalog rows at all as available', () => {
    expect(isAdventureAvailable(EMPTY_CATALOG, 'anything', 'pirate-builder-bay')).toBe(true);
    expect(isAdventureAvailable(EMPTY_CATALOG, 'anything', undefined)).toBe(true);
  });

  it("follows the code island's flag when the adventure itself has no row", () => {
    expect(
      isAdventureAvailable(catalog(false), 'repair-the-moonlight-bridge', 'pirate-builder-bay'),
    ).toBe(false);
    expect(
      isAdventureAvailable(catalog(true), 'repair-the-moonlight-bridge', 'pirate-builder-bay'),
    ).toBe(true);
  });

  it('keeps the adventure flag intact while its island is inactive', () => {
    const snapshot = catalog(false, true);
    expect(isAdventureAvailable(snapshot, 'repair-the-moonlight-bridge', undefined)).toBe(false);
    // Reactivating the island alone restores it; nothing rewrote the adventure's flag.
    const reactivated = { ...snapshot, islands: [{ ...snapshot.islands[0]!, active: true }] };
    expect(isAdventureAvailable(reactivated, 'repair-the-moonlight-bridge', undefined)).toBe(true);
  });
});

describe('isIslandAvailable', () => {
  it('hides only an island whose row is inactive', () => {
    expect(isIslandAvailable(catalog(false), 'pirate-builder-bay')).toBe(false);
    expect(isIslandAvailable(catalog(true), 'pirate-builder-bay')).toBe(true);
    expect(isIslandAvailable(catalog(false), 'wonderwild-forest')).toBe(true);
  });
});
