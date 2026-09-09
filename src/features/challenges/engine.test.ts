import { describe, expect, it } from 'vitest';
import { computeLearningProfile, domainProfile } from '../learning-profile/profile';
import { ZERO_SKILL_PROGRESS_COUNTS } from '../mastery/status';
import type { DomainProfile } from '../learning-profile/types';
import {
  gradeChallenge,
  isAnswerCorrect,
  selectChallengeLevel,
  selectChallengeVariant,
} from './engine';
import type { Challenge, ChallengeAttemptState } from './types';

function challenge(overrides: Partial<Challenge> = {}): Challenge {
  return {
    challengeId: 'lighthouse-power',
    questId: 'the-dark-lighthouse',
    skillDomain: 'math',
    skillLevel: 3,
    challengeType: 'NUMBER_INPUT',
    prompt: 'The lamp needs 56 units of power. Each cell makes 8. How many cells?',
    solution: { kind: 'exact-number', value: 7 },
    hintLevels: [
      { level: 1, text: 'Look at how much power one cell makes.' },
      { level: 2, text: 'Try counting up by 8 until you reach 56.' },
      { level: 3, text: 'Watch the cells light up one at a time.', demonstrationId: 'demo-cells' },
    ],
    attemptLimit: 5,
    reward: 'CLOCKWORK_LIGHTHOUSE_FIXED',
    ...overrides,
  };
}

const freshAttempt: ChallengeAttemptState = {
  challengeId: 'lighthouse-power',
  attemptCount: 0,
  hintsUsed: 0,
};

function profileWith(exposure: number, independent: number): DomainProfile {
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

describe('isAnswerCorrect', () => {
  it('grades exact numbers', () => {
    const solution = { kind: 'exact-number', value: 7 } as const;
    expect(isAnswerCorrect(solution, { kind: 'number', value: 7 })).toBe(true);
    expect(isAnswerCorrect(solution, { kind: 'number', value: 8 })).toBe(false);
  });

  it('accepts a measurement inside its tolerance, inclusive', () => {
    const solution = { kind: 'number-within', value: 10, tolerance: 0.5 } as const;
    expect(isAnswerCorrect(solution, { kind: 'number', value: 10.5 })).toBe(true);
    expect(isAnswerCorrect(solution, { kind: 'number', value: 9.5 })).toBe(true);
    expect(isAnswerCorrect(solution, { kind: 'number', value: 10.6 })).toBe(false);
  });

  it('requires order for a sequence and ignores it for a match', () => {
    const ordered = { kind: 'ordered-ids', ids: ['a', 'b', 'c'] } as const;
    expect(isAnswerCorrect(ordered, { kind: 'ids', ids: ['a', 'b', 'c'] })).toBe(true);
    expect(isAnswerCorrect(ordered, { kind: 'ids', ids: ['b', 'a', 'c'] })).toBe(false);

    const unordered = { kind: 'unordered-ids', ids: ['a', 'b', 'c'] } as const;
    expect(isAnswerCorrect(unordered, { kind: 'ids', ids: ['c', 'a', 'b'] })).toBe(true);
    expect(isAnswerCorrect(unordered, { kind: 'ids', ids: ['a', 'b'] })).toBe(false);
  });

  it('does not let a duplicate stand in for a missing id', () => {
    const unordered = { kind: 'unordered-ids', ids: ['a', 'b'] } as const;
    expect(isAnswerCorrect(unordered, { kind: 'ids', ids: ['a', 'a'] })).toBe(false);
  });

  it('compares text case-insensitively after trimming, but never fuzzily', () => {
    const solution = { kind: 'text', accepted: ['gear', 'cog'] } as const;
    expect(isAnswerCorrect(solution, { kind: 'text', value: '  GeAr ' })).toBe(true);
    expect(isAnswerCorrect(solution, { kind: 'text', value: 'gears' })).toBe(false);
  });

  it('returns false rather than throwing when answer and solution shapes disagree', () => {
    // A shape mismatch is a content bug, and a child mid-puzzle must not see a
    // raw error because of one.
    expect(isAnswerCorrect({ kind: 'exact-number', value: 7 }, { kind: 'text', value: '7' })).toBe(
      false,
    );
  });
});

describe('gradeChallenge', () => {
  it('pays out the reward on a correct answer', () => {
    const { outcome } = gradeChallenge(challenge(), { kind: 'number', value: 7 }, freshAttempt);

    expect(outcome).toEqual({ kind: 'CORRECT', reward: 'CLOCKWORK_LIGHTHOUSE_FIXED' });
  });

  it('walks down the authored hint ladder one rung per wrong answer', () => {
    const target = challenge();
    let state = freshAttempt;
    const texts: string[] = [];

    for (let i = 0; i < 3; i += 1) {
      const result = gradeChallenge(target, { kind: 'number', value: 1 }, state);
      expect(result.outcome.kind).toBe('RETRY_WITH_HINT');
      if (result.outcome.kind === 'RETRY_WITH_HINT') texts.push(result.outcome.hint.text);
      state = result.state;
    }

    expect(texts).toEqual(target.hintLevels.map((hint) => hint.text));
    expect(state.hintsUsed).toBe(3);
  });

  it('reaches the demonstration rung before offering anything simpler', () => {
    let state = { ...freshAttempt, hintsUsed: 2 };
    const result = gradeChallenge(challenge(), { kind: 'number', value: 1 }, state);

    expect(result.outcome.kind).toBe('RETRY_WITH_HINT');
    if (result.outcome.kind === 'RETRY_WITH_HINT') {
      expect(result.outcome.hint.demonstrationId).toBe('demo-cells');
    }
  });

  it('offers an easier variant once the hints run out, never a dead end', () => {
    const state = { ...freshAttempt, hintsUsed: 3 };
    const { outcome } = gradeChallenge(challenge(), { kind: 'number', value: 1 }, state);

    expect(outcome).toEqual({ kind: 'OFFER_SIMPLER', targetLevel: 2 });
  });

  it('offers an easier variant once the attempt limit is reached', () => {
    const state = { ...freshAttempt, attemptCount: 4, hintsUsed: 0 };
    const { outcome } = gradeChallenge(
      challenge({ attemptLimit: 5 }),
      { kind: 'number', value: 1 },
      state,
    );

    expect(outcome.kind).toBe('OFFER_SIMPLER');
  });

  it('never proposes a level below 1', () => {
    const { outcome } = gradeChallenge(
      challenge({ skillLevel: 1, hintLevels: [] }),
      { kind: 'number', value: 1 },
      freshAttempt,
    );

    expect(outcome).toEqual({ kind: 'OFFER_SIMPLER', targetLevel: 1 });
  });

  it('always returns some next step, for every outcome', () => {
    const target = challenge();
    let state = freshAttempt;
    for (let i = 0; i < 10; i += 1) {
      const result = gradeChallenge(target, { kind: 'number', value: 1 }, state);
      expect(['RETRY_WITH_HINT', 'OFFER_SIMPLER']).toContain(result.outcome.kind);
      state = result.state;
    }
  });
});

describe('selectChallengeLevel', () => {
  it('does not scale an unevidenced domain', () => {
    const unassessed = domainProfile(computeLearningProfile([]), 'reading');
    expect(selectChallengeLevel(unassessed)).toBe(1);
  });

  it('stretches a child who is both settled and consistently succeeding', () => {
    const strong = profileWith(20, 19);
    expect(selectChallengeLevel(strong)).toBe(strong.level + 1);
  });

  it('holds the level for a child whose evidence is still mixed', () => {
    const mixed = profileWith(12, 6);
    expect(selectChallengeLevel(mixed)).toBe(mixed.level);
  });

  it('does not stretch on a strong ratio backed by little evidence', () => {
    const thin = profileWith(2, 2);
    expect(selectChallengeLevel(thin)).toBe(thin.level);
  });

  it('never exceeds the derived ceiling', () => {
    expect(selectChallengeLevel(profileWith(200, 200))).toBe(5);
  });

  it('does not drop a level after a single failure', () => {
    // Section 8: "Failure should NOT immediately reduce skill level."
    const before = profileWith(20, 19);
    // One more attempt, no more successes: exactly one wrong answer.
    const after = profileWith(21, 19);

    expect(after.level).toBe(before.level);
    expect(selectChallengeLevel(after)).toBeGreaterThanOrEqual(before.level);
  });
});

describe('selectChallengeVariant', () => {
  const variants = [
    challenge({ challengeId: 'v1', skillLevel: 1 }),
    challenge({ challengeId: 'v3', skillLevel: 3 }),
    challenge({ challengeId: 'v5', skillLevel: 5 }),
  ];

  it('picks an exact match when one exists', () => {
    expect(selectChallengeVariant(variants, 3)?.challengeId).toBe('v3');
  });

  it('prefers the easier variant on a tie', () => {
    // Level 2 is equidistant from the level-1 and level-3 variants.
    expect(selectChallengeVariant(variants, 2)?.challengeId).toBe('v1');
  });

  it('clamps to the nearest authored variant beyond either end', () => {
    expect(selectChallengeVariant(variants, 6)?.challengeId).toBe('v5');
    expect(selectChallengeVariant(variants, 1)?.challengeId).toBe('v1');
  });

  it('returns undefined only when there are no variants', () => {
    expect(selectChallengeVariant([], 3)).toBeUndefined();
  });
});
