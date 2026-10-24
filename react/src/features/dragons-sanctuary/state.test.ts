import { describe, expect, it } from 'vitest';
import { DRAGON_SCALE_SPOTS, FIRE_RUNE_SPOTS } from '../island-map/three/dragonsSanctuaryRegion';
import { deriveDragonsSanctuaryState, deriveRestorationStage, hasAllFireRunes } from './state';
import {
  DRAGON_SCALE_IDS,
  dragonScaleChangeKey,
  FIRE_RUNE_IDS,
  fireRuneChangeKey,
  SANCTUARY_CHANGE_KEYS,
  SANCTUARY_RESTORATION_ORDER,
} from './types';

const ALL_RUNE_KEYS = FIRE_RUNE_IDS.map(fireRuneChangeKey);

describe('the state vocabulary matches the world', () => {
  it('names exactly the runes the region places', () => {
    // A rune in the world but not here could be picked up and never recorded;
    // one here but not in the world could be required and never found.
    expect([...FIRE_RUNE_IDS].sort()).toEqual(FIRE_RUNE_SPOTS.map((rune) => rune.id).sort());
  });

  it('names exactly the scales the region places', () => {
    expect([...DRAGON_SCALE_IDS].sort()).toEqual(
      DRAGON_SCALE_SPOTS.map((scale) => scale.id).sort(),
    );
  });

  it('prefixes every change key with the region, so no key collides with another region', () => {
    const keys = [
      ...Object.values(SANCTUARY_CHANGE_KEYS),
      ...ALL_RUNE_KEYS,
      ...DRAGON_SCALE_IDS.map(dragonScaleChangeKey),
    ];
    for (const key of keys) expect(key.startsWith('DRAGONS_SANCTUARY_'), key).toBe(true);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('does not stutter when a prop id already says "rune"', () => {
    expect(fireRuneChangeKey('dragons-sanctuary:prop:rune-stone')).toBe(
      'DRAGONS_SANCTUARY_RUNE_STONE_FOUND',
    );
  });
});

describe('deriveDragonsSanctuaryState', () => {
  it('gives a child with no history the forgotten sanctuary', () => {
    const state = deriveDragonsSanctuaryState([]);
    expect(state).toEqual({
      forgeLit: false,
      runesFound: [],
      scalesFound: [],
      crystalCavernUnlocked: false,
      hatcheryUnlocked: false,
      restorationStage: 'FORGOTTEN',
    });
  });

  it('reports the forge lit once the change is recorded', () => {
    const state = deriveDragonsSanctuaryState([SANCTUARY_CHANGE_KEYS.FORGE_LIT]);
    expect(state.forgeLit).toBe(true);
    expect(state.restorationStage).toBe('EMBER_RETURNS');
  });

  it('lists found runes in authored order, not the order they were found', () => {
    const state = deriveDragonsSanctuaryState([ALL_RUNE_KEYS[2], ALL_RUNE_KEYS[0]]);
    expect(state.runesFound).toEqual([FIRE_RUNE_IDS[0], FIRE_RUNE_IDS[2]]);
  });

  it('ignores change keys that belong to another region', () => {
    const state = deriveDragonsSanctuaryState(['CLOCKWORK_LIGHTHOUSE_FIXED', 'BRIDGE_REPAIRED']);
    expect(state.forgeLit).toBe(false);
    expect(state.restorationStage).toBe('FORGOTTEN');
  });

  it('counts dragon scales without them touching the restoration stage', () => {
    // Collecting is optional (Phase 10); it must not advance the region's
    // story, or a child who explores would out-pace one who plays the quest.
    const state = deriveDragonsSanctuaryState(DRAGON_SCALE_IDS.map(dragonScaleChangeKey));
    expect(state.scalesFound).toEqual([...DRAGON_SCALE_IDS]);
    expect(state.restorationStage).toBe('FORGOTTEN');
  });
});

describe('deriveRestorationStage', () => {
  it('climbs Phase 9’s ladder in order', () => {
    expect(deriveRestorationStage([])).toBe('FORGOTTEN');
    expect(deriveRestorationStage([SANCTUARY_CHANGE_KEYS.FORGE_LIT])).toBe('EMBER_RETURNS');
    expect(deriveRestorationStage([SANCTUARY_CHANGE_KEYS.CRYSTAL_CAVERN_UNLOCKED])).toBe(
      'DRAGONS_RETURN',
    );
    expect(deriveRestorationStage([SANCTUARY_CHANGE_KEYS.HATCHERY_UNLOCKED])).toBe(
      'HATCHERY_RESTORED',
    );
  });

  it('never moves backward as history grows', () => {
    // History only grows, and a sanctuary the child changed stays changed
    // (ADR-005). Adding any key must never lower the stage.
    const keys: string[] = [];
    let previous = SANCTUARY_RESTORATION_ORDER.indexOf(deriveRestorationStage(keys));
    for (const key of [
      SANCTUARY_CHANGE_KEYS.ARRIVED,
      ...ALL_RUNE_KEYS,
      SANCTUARY_CHANGE_KEYS.FORGE_LIT,
      SANCTUARY_CHANGE_KEYS.CRYSTAL_CAVERN_UNLOCKED,
      SANCTUARY_CHANGE_KEYS.HATCHERY_UNLOCKED,
    ]) {
      keys.push(key);
      const now = SANCTUARY_RESTORATION_ORDER.indexOf(deriveRestorationStage(keys));
      expect(now, `adding ${key} lowered the stage`).toBeGreaterThanOrEqual(previous);
      previous = now;
    }
  });

  it('reports no stage the sanctuary cannot yet render', () => {
    // Phase 4 has not authored the quests that would earn the top two rungs,
    // so nothing may return them yet.
    const everyKey = [
      ...Object.values(SANCTUARY_CHANGE_KEYS),
      ...ALL_RUNE_KEYS,
      ...DRAGON_SCALE_IDS.map(dragonScaleChangeKey),
    ];
    expect(['SANCTUARY_REBORN', 'DRAGON_KEEPER']).not.toContain(deriveRestorationStage(everyKey));
  });
});

describe('hasAllFireRunes', () => {
  it('is false until every rune is found', () => {
    expect(hasAllFireRunes([])).toBe(false);
    expect(hasAllFireRunes(ALL_RUNE_KEYS.slice(0, 2))).toBe(false);
  });

  it('is true once all three are found', () => {
    expect(hasAllFireRunes(ALL_RUNE_KEYS)).toBe(true);
  });
});
