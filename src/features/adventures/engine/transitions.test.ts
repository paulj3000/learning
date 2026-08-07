import { describe, expect, it } from 'vitest';
import { getNextStepId } from './transitions';
import type { AdventureStep } from './types';

function makeStep(transitions: AdventureStep['transitions']): AdventureStep {
  return {
    id: 'step-1',
    type: 'NUMBER_INPUT',
    objectiveIds: [],
    presentation: { kind: 'number-input', prompt: 'How many?', correctValue: 4 },
    transitions,
    fallback: { text: 'Fallback text.' },
  };
}

describe('getNextStepId', () => {
  it('follows the rule matching the given correctness', () => {
    const step = makeStep([
      { when: 'correct', nextStepId: 'next' },
      { when: 'incorrect', nextStepId: 'retry' },
    ]);
    expect(getNextStepId(step, 'correct')).toBe('next');
    expect(getNextStepId(step, 'incorrect')).toBe('retry');
  });

  it('falls back to an "always" rule when no specific rule matches', () => {
    const step = makeStep([{ when: 'always', nextStepId: 'onward' }]);
    expect(getNextStepId(step, 'partial')).toBe('onward');
    expect(getNextStepId(step, 'not_applicable')).toBe('onward');
  });

  it('prefers a specific rule over an "always" rule', () => {
    const step = makeStep([
      { when: 'always', nextStepId: 'onward' },
      { when: 'incorrect', nextStepId: 'retry' },
    ]);
    expect(getNextStepId(step, 'incorrect')).toBe('retry');
  });

  it('throws for an unauthored transition path', () => {
    const step = makeStep([{ when: 'correct', nextStepId: 'next' }]);
    expect(() => getNextStepId(step, 'incorrect')).toThrow();
  });
});
