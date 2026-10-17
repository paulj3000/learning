import { describe, expect, it } from 'vitest';
import { getHintText, isGuidedCompletion, MAX_HINT_LEVEL, nextHintLevel } from './hints';
import type { AdventureStep } from './types';

function makeStep(ladder?: string[]): AdventureStep {
  return {
    id: 'step-1',
    type: 'NUMBER_INPUT',
    objectiveIds: [],
    presentation: { kind: 'number-input', prompt: 'How many?', correctValue: 4 },
    transitions: [{ when: 'always', nextStepId: 'next' }],
    hintPolicy: ladder ? { ladder } : undefined,
    fallback: { text: 'Fallback text.' },
  };
}

describe('nextHintLevel', () => {
  it('increments by one', () => {
    expect(nextHintLevel(0)).toBe(1);
    expect(nextHintLevel(2)).toBe(3);
  });

  it('caps at the max hint level', () => {
    expect(nextHintLevel(MAX_HINT_LEVEL)).toBe(MAX_HINT_LEVEL);
    expect(nextHintLevel(MAX_HINT_LEVEL + 5)).toBe(MAX_HINT_LEVEL);
  });
});

describe('isGuidedCompletion', () => {
  it('is only true at the top of the ladder', () => {
    expect(isGuidedCompletion(4)).toBe(false);
    expect(isGuidedCompletion(5)).toBe(true);
  });
});

describe('getHintText', () => {
  const ladder = [
    'Encouragement',
    'Attention cue',
    'Strategy hint',
    'Partial scaffold',
    'Guided completion',
  ];

  it('returns undefined at level 0', () => {
    expect(getHintText(makeStep(ladder), 0)).toBeUndefined();
  });

  it('returns undefined when the step has no hint policy', () => {
    expect(getHintText(makeStep(), 1)).toBeUndefined();
  });

  it('returns the ladder entry for a given level', () => {
    expect(getHintText(makeStep(ladder), 1)).toBe('Encouragement');
    expect(getHintText(makeStep(ladder), 3)).toBe('Strategy hint');
  });

  it('clamps to the last authored ladder entry', () => {
    expect(getHintText(makeStep(ladder), 99)).toBe('Guided completion');
  });
});
