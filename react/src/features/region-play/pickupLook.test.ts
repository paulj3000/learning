import { describe, expect, it } from 'vitest';
import { isPickupLook, pickupLook } from './pickupLook';
import { tryParseRegionPlayConfig } from './regionPlayConfig';

describe('pickupLook (Feather defect: every pickup used to be a key)', () => {
  it('draws the Pirate’s Leap feather as a feather, by its model or by its own words', () => {
    expect(
      pickupLook({ entityId: 'cove-leap-feather', label: 'Parrot feather', assetId: 'feather' }),
    ).toBe('FEATHER');
    expect(pickupLook({ entityId: 'cove-leap-feather', label: 'Parrot feather' })).toBe('FEATHER');
    expect(pickupLook({ entityId: 'x', label: 'A bright FEATHER' })).toBe('FEATHER');
  });

  it('keeps real keys as keys', () => {
    expect(pickupLook({ entityId: 'cove-brass-key', label: 'Old brass key' })).toBe('KEY');
    expect(pickupLook({ entityId: 'gate', label: 'Key', assetId: 'treasure-key' })).toBe('KEY');
  });

  it('draws the shell as a shell', () => {
    expect(pickupLook({ entityId: 'cove-leap-shell', label: 'Sparkly shell' })).toBe('SHELL');
  });

  it('never calls something a key that is not one, and has a neutral default', () => {
    expect(pickupLook({ entityId: 'keepsake-1', label: 'A keepsake' })).toBe('GEM');
    expect(pickupLook({ entityId: 'monkey-toy', label: 'Monkey' })).toBe('GEM');
    expect(pickupLook({ entityId: 'mystery', label: null, assetId: null })).toBe('GEM');
  });

  it('lets the model id win over the label', () => {
    expect(pickupLook({ entityId: 'odd', label: 'Old key', assetId: 'feather' })).toBe('FEATHER');
  });

  it('parses a pickup look and model, and drops an unknown look', () => {
    expect(isPickupLook('FEATHER')).toBe(true);
    expect(isPickupLook('feather')).toBe(false);
    const config = tryParseRegionPlayConfig({
      chests: [],
      figures: [],
      interactions: [],
      procedural: [],
      pickups: [
        { entityId: 'a', assetId: 'feather', look: 'FEATHER' },
        { entityId: 'b', look: 'DRAGON' },
        { entityId: 'c' },
      ],
      runes: [],
      drawn: [],
      puzzles: [],
      props: [],
    } as never);
    expect(config?.pickups).toEqual([
      { entityId: 'a', assetId: 'feather', look: 'FEATHER' },
      { entityId: 'b' },
      { entityId: 'c' },
    ]);
  });
});
