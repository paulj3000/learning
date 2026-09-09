import { describe, expect, it } from 'vitest';
import { deriveClockworkHarborState, deriveClockworkRegionProgress } from './state';
import {
  CLOCKWORK_CHANGE_KEYS,
  creatureChangeKey,
  GOLDEN_GEAR_IDS,
  goldenGearChangeKey,
  MECHANICAL_CREATURE_IDS,
} from './types';

const ALL_GEAR_KEYS = GOLDEN_GEAR_IDS.map(goldenGearChangeKey);

describe('deriveClockworkHarborState', () => {
  it('reports the "before" harbor for a child with no history', () => {
    const state = deriveClockworkHarborState([]);

    expect(state).toEqual({
      lighthouseFixed: false,
      marketMysterySolved: false,
      companionCogUnlocked: false,
      drawbridgeFixed: false,
      animalsRecovered: [],
      workshopUnlocked: false,
      undergroundUnlocked: false,
      heartRestored: false,
      goldenGearsFound: [],
    });
  });

  it('ignores change keys belonging to other regions', () => {
    // `BRIDGE_REPAIRED` is Pirate Builder Bay's. The harbor's own drawbridge
    // must not be opened by it - the reason harbor keys carry a prefix.
    const state = deriveClockworkHarborState(['BRIDGE_REPAIRED', 'TIDE_GATE_SET']);

    expect(state.drawbridgeFixed).toBe(false);
    expect(state.lighthouseFixed).toBe(false);
  });

  it('unlocks Cog with the market mystery, never separately', () => {
    const solved = deriveClockworkHarborState([CLOCKWORK_CHANGE_KEYS.MARKET_MYSTERY_SOLVED]);
    expect(solved.marketMysterySolved).toBe(true);
    expect(solved.companionCogUnlocked).toBe(true);

    // There is no history in which the mystery is unsolved but Cog is a companion.
    const unsolved = deriveClockworkHarborState([CLOCKWORK_CHANGE_KEYS.LIGHTHOUSE_FIXED]);
    expect(unsolved.companionCogUnlocked).toBe(false);
  });

  it('lists recovered creatures in authored order, not the order they were found', () => {
    const state = deriveClockworkHarborState([
      creatureChangeKey('copper-crab'),
      creatureChangeKey('clockwork-fox'),
    ]);

    expect(state.animalsRecovered).toEqual(['clockwork-fox', 'copper-crab']);
  });

  it('collects Golden Gears by their own keys', () => {
    const state = deriveClockworkHarborState([
      goldenGearChangeKey('golden-gear-03'),
      goldenGearChangeKey('golden-gear-01'),
    ]);

    expect(state.goldenGearsFound).toEqual(['golden-gear-01', 'golden-gear-03']);
  });

  it('authors twelve Golden Gears with distinct keys', () => {
    expect(GOLDEN_GEAR_IDS).toHaveLength(12);
    expect(new Set(ALL_GEAR_KEYS).size).toBe(12);
  });

  it('gives every mechanical creature a distinct change key', () => {
    const keys = MECHANICAL_CREATURE_IDS.map(creatureChangeKey);
    expect(new Set(keys).size).toBe(MECHANICAL_CREATURE_IDS.length);
  });
});

describe('deriveClockworkRegionProgress', () => {
  it('is NOT_STARTED until the child has actually arrived', () => {
    expect(deriveClockworkRegionProgress([])).toBe('NOT_STARTED');
    // Even a repaired lighthouse cannot precede arriving, but the ladder must
    // not claim otherwise if history is ever backfilled out of order.
    expect(deriveClockworkRegionProgress([CLOCKWORK_CHANGE_KEYS.LIGHTHOUSE_FIXED])).toBe(
      'NOT_STARTED',
    );
  });

  it('is DISCOVERED for a child who has walked in but changed nothing', () => {
    expect(deriveClockworkRegionProgress([CLOCKWORK_CHANGE_KEYS.ARRIVED])).toBe('DISCOVERED');
  });

  it('is IN_PROGRESS once chapter one is behind them', () => {
    expect(
      deriveClockworkRegionProgress([
        CLOCKWORK_CHANGE_KEYS.ARRIVED,
        CLOCKWORK_CHANGE_KEYS.LIGHTHOUSE_FIXED,
      ]),
    ).toBe('IN_PROGRESS');
  });

  it('is COMPLETED when the Heart runs but gears remain, so there is still somewhere to go', () => {
    expect(
      deriveClockworkRegionProgress([
        CLOCKWORK_CHANGE_KEYS.ARRIVED,
        CLOCKWORK_CHANGE_KEYS.LIGHTHOUSE_FIXED,
        CLOCKWORK_CHANGE_KEYS.HEART_RESTORED,
        goldenGearChangeKey('golden-gear-01'),
      ]),
    ).toBe('COMPLETED');
  });

  it('is MASTERED only with the story finished and all twelve gears found', () => {
    expect(
      deriveClockworkRegionProgress([
        CLOCKWORK_CHANGE_KEYS.ARRIVED,
        CLOCKWORK_CHANGE_KEYS.HEART_RESTORED,
        ...ALL_GEAR_KEYS,
      ]),
    ).toBe('MASTERED');
  });

  it('does not award MASTERED for gears alone, without the finale', () => {
    expect(deriveClockworkRegionProgress([CLOCKWORK_CHANGE_KEYS.ARRIVED, ...ALL_GEAR_KEYS])).toBe(
      'DISCOVERED',
    );
  });

  it('never moves backward as history grows', () => {
    const ladder = [
      [CLOCKWORK_CHANGE_KEYS.ARRIVED],
      [CLOCKWORK_CHANGE_KEYS.ARRIVED, CLOCKWORK_CHANGE_KEYS.LIGHTHOUSE_FIXED],
      [
        CLOCKWORK_CHANGE_KEYS.ARRIVED,
        CLOCKWORK_CHANGE_KEYS.LIGHTHOUSE_FIXED,
        CLOCKWORK_CHANGE_KEYS.HEART_RESTORED,
      ],
    ];
    const order = ['DISCOVERED', 'IN_PROGRESS', 'COMPLETED'];

    ladder.forEach((keys, index) => {
      expect(deriveClockworkRegionProgress(keys)).toBe(order[index]);
    });
  });
});
