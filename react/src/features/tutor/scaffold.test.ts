import { describe, expect, it } from 'vitest';
import { representationAidForTurn } from './scaffold';
import type { TutorTurnState } from './useTutorTurn';
import type { TutorStrategy } from './types';

function ready(strategy: TutorStrategy, source: 'AI' | 'FALLBACK' = 'AI'): TutorTurnState {
  return {
    status: 'ready',
    source,
    turn: {
      spokenText: "Let's try looking at it a different way.",
      strategy,
      emotion: 'CHEERFUL',
      safetyDisposition: 'ALLOW',
    },
  };
}

describe('representationAidForTurn', () => {
  it('offers the skill’s manipulative on the partial-scaffold rung', () => {
    expect(
      representationAidForTurn('counting-sets', ready('SWITCH_REPRESENTATION'), true)?.id,
    ).toBe('counting-sets-visual');
  });

  it('offers it just the same when the turn fell back to authored content', () => {
    // The scaffold is a property of the rung, not of whether Bedrock
    // answered, so a child with AI switched off still gets the manipulative.
    expect(
      representationAidForTurn('counting-sets', ready('SWITCH_REPRESENTATION', 'FALLBACK'), true)
        ?.id,
    ).toBe('counting-sets-visual');
  });

  it('offers nothing on the other rungs', () => {
    for (const strategy of ['ENCOURAGE', 'ASK_GUIDING_QUESTION', 'GIVE_HINT', 'EXPLAIN'] as const) {
      expect(representationAidForTurn('counting-sets', ready(strategy), true)).toBeUndefined();
    }
  });

  it('never follows a child to another step', () => {
    expect(
      representationAidForTurn('counting-sets', ready('SWITCH_REPRESENTATION'), false),
    ).toBeUndefined();
  });

  it('offers nothing while the turn is loading, idle, or errored', () => {
    for (const state of [{ status: 'idle' }, { status: 'loading' }, { status: 'error' }] as const) {
      expect(representationAidForTurn('counting-sets', state, true)).toBeUndefined();
    }
  });

  it('offers nothing for a step with no objective or no authored aid', () => {
    expect(
      representationAidForTurn(undefined, ready('SWITCH_REPRESENTATION'), true),
    ).toBeUndefined();
    expect(
      representationAidForTurn('reading-comprehension', ready('SWITCH_REPRESENTATION'), true),
    ).toBeUndefined();
  });
});
