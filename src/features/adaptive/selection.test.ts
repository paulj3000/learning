import { describe, expect, it } from 'vitest';
import type { AdventureDefinition } from '../adventures/engine/types';
import { computeLearningProfile, domainProfile } from '../learning-profile/profile';
import { ZERO_SKILL_PROGRESS_COUNTS } from '../mastery/status';
import type { SkillLevel } from '../learning-profile/types';
import { resolveAdventureForSkillLevel, selectDifficultyLevel } from './selection';

function profileWith(exposure: number, independent: number) {
  return domainProfile(
    computeLearningProfile([
      {
        skillId: 'counting-sets',
        counts: {
          ...ZERO_SKILL_PROGRESS_COUNTS,
          exposureCount: exposure,
          independentSuccessCount: independent,
        },
      },
    ]),
    'math',
  );
}

function variant(slug: string, skillLevel?: SkillLevel): AdventureDefinition {
  return {
    slug,
    version: 1,
    title: slug,
    locationSlug: 'clockwork-harbor',
    ageBands: ['PATHFINDER'],
    entryStepId: 'start',
    steps: [],
    ...(skillLevel === undefined ? {} : { skillDomain: 'math' as const, skillLevel }),
  };
}

describe('selectDifficultyLevel', () => {
  it('does not scale a domain the island has never assessed', () => {
    const unassessed = domainProfile(computeLearningProfile([]), 'reading');
    expect(selectDifficultyLevel(unassessed)).toBe(1);
  });

  it('stretches a child who is both settled and consistently succeeding', () => {
    const strong = profileWith(20, 19);
    expect(selectDifficultyLevel(strong)).toBe(strong.level + 1);
  });

  it('holds the level for a child whose evidence is still mixed', () => {
    const mixed = profileWith(12, 6);
    expect(selectDifficultyLevel(mixed)).toBe(mixed.level);
  });

  it('does not stretch on a strong ratio backed by little evidence', () => {
    const thin = profileWith(2, 2);
    expect(selectDifficultyLevel(thin)).toBe(thin.level);
  });

  it('never exceeds the derived ceiling', () => {
    expect(selectDifficultyLevel(profileWith(200, 200))).toBe(5);
  });

  it('does not drop a level after a single failure', () => {
    // Section 8: "Failure should NOT immediately reduce skill level."
    const before = profileWith(20, 19);
    // One more attempt, no more successes: exactly one wrong answer.
    const after = profileWith(21, 19);

    expect(after.level).toBe(before.level);
    expect(selectDifficultyLevel(after)).toBeGreaterThanOrEqual(before.level);
  });
});

describe('resolveAdventureForSkillLevel', () => {
  const variants = [variant('v1', 1), variant('v3', 3), variant('v5', 5)];

  it('picks an exact match when one exists', () => {
    expect(resolveAdventureForSkillLevel(variants, 3)?.slug).toBe('v3');
  });

  it('prefers the easier variant on a tie', () => {
    // Level 2 is equidistant from the level-1 and level-3 variants.
    expect(resolveAdventureForSkillLevel(variants, 2)?.slug).toBe('v1');
  });

  it('clamps to the nearest authored variant beyond either end', () => {
    expect(resolveAdventureForSkillLevel(variants, 6)?.slug).toBe('v5');
    expect(resolveAdventureForSkillLevel(variants, 1)?.slug).toBe('v1');
  });

  it('ignores unlevelled adventures rather than ranking them as easiest', () => {
    // Every adventure authored before Clockwork Harbor is unlevelled; treating
    // those as level 1 would hand back a bee adventure as a lighthouse puzzle.
    const mixed = [variant('legacy'), variant('v3', 3)];
    expect(resolveAdventureForSkillLevel(mixed, 1)?.slug).toBe('v3');
  });

  it('returns undefined when nothing is levelled, so the caller can fall back to age band', () => {
    expect(resolveAdventureForSkillLevel([variant('legacy')], 3)).toBeUndefined();
    expect(resolveAdventureForSkillLevel([], 3)).toBeUndefined();
  });
});
