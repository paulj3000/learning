import { describe, expect, it } from 'vitest';
import { flattenReason, toResult } from './handler';
import type { SelectionRecord } from '../../../src/features/director/types';

describe('flattenReason', () => {
  it('flattens PRACTISES_SKILL, nulling fields the other kinds would use', () => {
    expect(
      flattenReason({
        kind: 'PRACTISES_SKILL',
        skillId: 'counting-sets',
        status: 'DEVELOPING',
        weight: 2,
      }),
    ).toEqual({
      kind: 'PRACTISES_SKILL',
      skillId: 'counting-sets',
      status: 'DEVELOPING',
      weight: 2,
      storyId: null,
      penalty: null,
    });
  });

  it('flattens CONTINUES_STORY', () => {
    expect(flattenReason({ kind: 'CONTINUES_STORY', storyId: 'dragon-of-ember-mountain' })).toEqual(
      {
        kind: 'CONTINUES_STORY',
        skillId: null,
        status: null,
        weight: null,
        storyId: 'dragon-of-ember-mountain',
        penalty: null,
      },
    );
  });

  it('flattens ALREADY_COMPLETED and PLAYED_RECENTLY into the same penalty field', () => {
    expect(flattenReason({ kind: 'ALREADY_COMPLETED', penalty: 4 })).toEqual({
      kind: 'ALREADY_COMPLETED',
      skillId: null,
      status: null,
      weight: null,
      storyId: null,
      penalty: 4,
    });
    expect(flattenReason({ kind: 'PLAYED_RECENTLY', penalty: 3 })).toEqual({
      kind: 'PLAYED_RECENTLY',
      skillId: null,
      status: null,
      weight: null,
      storyId: null,
      penalty: 3,
    });
  });

  it('flattens NO_SKILLS_NEEDED with every extra field null', () => {
    expect(flattenReason({ kind: 'NO_SKILLS_NEEDED' })).toEqual({
      kind: 'NO_SKILLS_NEEDED',
      skillId: null,
      status: null,
      weight: null,
      storyId: null,
      penalty: null,
    });
  });
});

function record(overrides: Partial<SelectionRecord> = {}): SelectionRecord {
  return {
    adventureSlug: 'repair-the-moonlight-bridge',
    title: 'Repair the Moonlight Bridge',
    score: 3,
    reasons: [
      { kind: 'PRACTISES_SKILL', skillId: 'counting-sets', status: 'DEVELOPING', weight: 2 },
    ],
    ...overrides,
  };
}

describe('toResult', () => {
  it('keeps only the top 3 ranked adventures', () => {
    const ranking = [
      record({ adventureSlug: 'a', score: 5 }),
      record({ adventureSlug: 'b', score: 4 }),
      record({ adventureSlug: 'c', score: 3 }),
      record({ adventureSlug: 'd', score: 2 }),
    ];
    const result = toResult(ranking);
    expect(result.suggestions.map((s) => s.adventureSlug)).toEqual(['a', 'b', 'c']);
  });

  it('reports hasPersonalizedSignal true when any record has a skill-based reason', () => {
    const ranking = [record()];
    expect(toResult(ranking).hasPersonalizedSignal).toBe(true);
  });

  it('reports hasPersonalizedSignal false when no record has a skill-based reason (e.g. an unauthored age band)', () => {
    const ranking = [record({ reasons: [{ kind: 'NO_SKILLS_NEEDED' }] })];
    expect(toResult(ranking).hasPersonalizedSignal).toBe(false);
  });

  it('returns an empty suggestion list and no personalized signal for an empty ranking', () => {
    expect(toResult([])).toEqual({ suggestions: [], hasPersonalizedSignal: false });
  });
});
