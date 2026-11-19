import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createStandardCapabilityRegistry } from '@lai/game-engine/engine';
import { checkContentCompatibility, profileFor, validateAdventure, AGE_BANDS } from '@lai/game-engine/sdk';
import definition from './treasureCoveAdventure.json';
import { TREASURE_COVE_ADVENTURE, TREASURE_COVE_COMPONENT_TYPES } from './treasureCoveAdventure';

/**
 * GE-070: Treasure Cove's AdventureDefinition is valid for the engine it targets. Django checks
 * separately that every id in it is one the Treasure Cove seed publishes
 * (`lai/apps/regions/tests/test_treasure_cove_adventure.py`).
 */
describe('Treasure Cove adventure definition (GE-070)', () => {
  const registry = createStandardCapabilityRegistry();

  it('passes the SDK validator against the standard capability registry', () => {
    const result = validateAdventure(definition, registry, {
      componentTypes: TREASURE_COVE_COMPONENT_TYPES,
      realmId: 'pirate-builder-bay',
    });
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('passes the content compatibility validator as an adventure', () => {
    const report = checkContentCompatibility(definition, registry, { kind: 'ADVENTURE' });
    expect(report.issues).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('leaves the visible island change pillar 2 requires: the bridge to Lookout Point', () => {
    expect(TREASURE_COVE_ADVENTURE.worldConsequenceId).toBe('TREASURE_COVE_QUEST_COMPLETE');
  });

  it('serves every age band, with the engine’s band profiles (no cove overrides)', () => {
    expect([...TREASURE_COVE_ADVENTURE.ageBands].sort()).toEqual([...AGE_BANDS].sort());
    for (const band of AGE_BANDS) expect(() => profileFor(TREASURE_COVE_ADVENTURE, band)).not.toThrow();
  });

  it('declares no jump challenge here: Pirate’s Leap’s course is GE-071', () => {
    expect(TREASURE_COVE_ADVENTURE.jumpChallenges).toEqual([]);
  });

  it('the Treasure Cove seed scene passes the content compatibility validator', () => {
    // The seed's own snapshots (Django is authoritative, ADR-047): the cove layout and the
    // Pirate's Leap course, as the seed stores them in the 3D Area's scene.
    const seed = (name: string): unknown =>
      JSON.parse(readFileSync(resolve(process.cwd(), '../lai/apps/regions', name), 'utf8'));
    const layout = checkContentCompatibility(seed('treasure_cove_layout.json'), registry, {
      kind: 'AREA_SCENE',
    });
    expect(layout.issues).toEqual([]);
    const course = checkContentCompatibility({ platforming: seed('pirates_leap_course.json') }, registry, {
      kind: 'AREA_SCENE',
    });
    expect(course.issues).toEqual([]);
  });

  it('would refuse a required jump with no walking route, or a missing world change', () => {
    const requiredJump = {
      ...definition,
      jumpChallenges: [
        { id: 'leap-gap', areaId: 'treasure-rush-cove', jumpRouteId: 'jump', accessibleRouteId: null, optional: false },
      ],
    };
    expect(validateAdventure(requiredJump, registry).ok).toBe(false);
    const noConsequence = { ...definition, worldConsequenceId: '' };
    expect(checkContentCompatibility(noConsequence, registry, { kind: 'ADVENTURE' }).ok).toBe(false);
  });

  it('is frozen, so nothing at runtime can change what was validated', () => {
    expect(Object.isFrozen(TREASURE_COVE_ADVENTURE)).toBe(true);
    expect(Object.isFrozen(TREASURE_COVE_ADVENTURE.components)).toBe(true);
  });
});
