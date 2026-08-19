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
});

describe('Fossil Ridge Camp location', () => {
  it('is registered and gated on the Dinosaur Expedition story completing', () => {
    const location = getIslandLocation('fossil-ridge-camp');
    expect(location).toBeDefined();
    expect(location?.unlockRequirement).toEqual({ changeKey: 'DINOSAUR_EXPEDITION_COMPLETE' });
  });
});

describe('the Writing Room location', () => {
  it('is registered and gated on the Castle Secret Door story completing', () => {
    const location = getIslandLocation('castle-writing-room');
    expect(location).toBeDefined();
    expect(location?.unlockRequirement).toEqual({
      changeKey: 'THE_CASTLES_SECRET_DOOR_COMPLETE',
    });
  });
});

describe('gated MVP locations overall', () => {
  it('gates exactly the three story-payoff locations, leaving every original MVP location always-visible', () => {
    const gatedSlugs = ISLAND_LOCATIONS.filter((item) => item.unlockRequirement).map(
      (item) => item.slug,
    );
    expect(gatedSlugs.sort()).toEqual(
      ['castle-writing-room', 'dragons-sanctuary', 'fossil-ridge-camp'].sort(),
    );
  });
});
