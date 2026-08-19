import { describe, expect, it } from 'vitest';
import { ISLAND_LOCATIONS, getIslandLocation, isLocationUnlocked } from './locations';

describe('isLocationUnlocked', () => {
  it('is always unlocked when there is no unlockRequirement', () => {
    expect(isLocationUnlocked({ unlockRequirement: undefined }, [])).toBe(true);
  });

  it('is locked when the required world change is absent', () => {
    expect(isLocationUnlocked({ unlockRequirement: { changeKey: 'SOME_CHANGE' } }, [])).toBe(false);
  });

  it('is unlocked once the required world change is present', () => {
    expect(
      isLocationUnlocked({ unlockRequirement: { changeKey: 'SOME_CHANGE' } }, ['SOME_CHANGE']),
    ).toBe(true);
  });
});

describe("the Dragon's Sanctuary location", () => {
  const location = getIslandLocation('dragons-sanctuary');

  it('is registered and gated on the Dragon of Ember Mountain story completing', () => {
    expect(location).toBeDefined();
    expect(location?.unlockRequirement).toEqual({
      changeKey: 'DRAGON_OF_EMBER_MOUNTAIN_COMPLETE',
    });
  });

  it('is the only currently-gated MVP location, so every other location stays always-visible', () => {
    const gatedSlugs = ISLAND_LOCATIONS.filter((item) => item.unlockRequirement).map(
      (item) => item.slug,
    );
    expect(gatedSlugs).toEqual(['dragons-sanctuary']);
  });
});
