import { describe, expect, it } from 'vitest';
import { listAllRegions } from './regionOverview';
import { ISLAND_LOCATIONS } from './locations';

describe('listAllRegions', () => {
  it('lists every authored region, including locked ones, in authored order', () => {
    const regions = listAllRegions([]);

    expect(regions.map((region) => region.slug)).toEqual(
      ISLAND_LOCATIONS.map((location) => location.slug),
    );
  });

  it('names the world each region belongs to', () => {
    const regions = listAllRegions([]);
    const bay = regions.find((region) => region.slug === 'pirate-builder-bay');
    const beach = regions.find((region) => region.slug === 'cove-care-beach');

    expect(bay?.worldTitle).toBe('Learning Adventure Island');
    expect(beach?.worldTitle).toBe('Creature Care Cove');
  });

  it('marks a secret region unlocked only once its change key is present', () => {
    const locked = listAllRegions([]).find((region) => region.slug === 'dragons-sanctuary');
    const unlocked = listAllRegions(['DRAGON_OF_EMBER_MOUNTAIN_COMPLETE']).find(
      (region) => region.slug === 'dragons-sanctuary',
    );

    expect(locked?.unlocked).toBe(false);
    expect(unlocked?.unlocked).toBe(true);
  });

  it('treats a region with no unlock requirement as always available', () => {
    const harbor = listAllRegions([]).find((region) => region.slug === 'clockwork-harbor');

    expect(harbor?.unlocked).toBe(true);
  });
});
