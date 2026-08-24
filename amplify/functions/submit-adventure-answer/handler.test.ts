import { describe, expect, it } from 'vitest';
import { decideSubmission, isStepAnswer } from './handler';
import type { AdventureStep } from '../../../src/features/adventures/engine/types';

function makeStep(overrides: Partial<AdventureStep>): AdventureStep {
  return {
    id: 'step-1',
    type: 'NUMBER_INPUT',
    objectiveIds: ['counting-sets'],
    presentation: { kind: 'number-input', prompt: 'How many planks?', correctValue: 4 },
    transitions: [
      { when: 'correct', nextStepId: 'step-2' },
      { when: 'incorrect', nextStepId: 'step-1' },
    ],
    fallback: { text: 'Fallback text.' },
    ...overrides,
  };
}

describe('decideSubmission', () => {
  it('advances on a correct answer', () => {
    const step = makeStep({});
    const decision = decideSubmission(step, { kind: 'number-input', value: 4 }, 0);
    expect(decision).toEqual({
      correctness: 'correct',
      supportLevel: 0,
      action: 'ADVANCE',
      nextStepId: 'step-2',
    });
  });

  it('advances on a wrong answer when the step has no hint policy', () => {
    const step = makeStep({ hintPolicy: undefined });
    const decision = decideSubmission(step, { kind: 'number-input', value: 1 }, 0);
    expect(decision).toEqual({
      correctness: 'incorrect',
      supportLevel: 0,
      action: 'ADVANCE',
      nextStepId: 'step-1',
    });
  });

  it('retries and escalates the hint ladder on a wrong answer with a hint policy, without advancing', () => {
    const step = makeStep({
      hintPolicy: { ladder: ['Try counting slowly.', 'Point at each one.'] },
    });
    const decision = decideSubmission(step, { kind: 'number-input', value: 1 }, 0);
    expect(decision).toEqual({
      correctness: 'incorrect',
      supportLevel: 1,
      action: 'RETRY',
    });
    expect(decision.nextStepId).toBeUndefined();
  });

  it('carries a child forward as correct once the hint ladder reaches guided completion', () => {
    const step = makeStep({
      hintPolicy: { ladder: ['1', '2', '3', '4', '5'] },
    });
    // Already at hint level 4 — one more wrong attempt reaches level 5 (MAX_HINT_LEVEL).
    const decision = decideSubmission(step, { kind: 'number-input', value: 1 }, 4);
    expect(decision).toEqual({
      correctness: 'correct',
      supportLevel: 5,
      action: 'ADVANCE',
      nextStepId: 'step-2',
    });
  });

  it('never escalates past the maximum hint level', () => {
    const step = makeStep({
      hintPolicy: { ladder: ['1', '2', '3', '4', '5'] },
    });
    const decision = decideSubmission(step, { kind: 'number-input', value: 1 }, 5);
    expect(decision.supportLevel).toBe(5);
    expect(decision.action).toBe('ADVANCE');
  });

  it('advances a not-applicable step (e.g. reflection) without ever retrying', () => {
    const step = makeStep({
      type: 'REFLECTION',
      presentation: { kind: 'reflection', prompt: 'How was that?' },
      transitions: [{ when: 'always', nextStepId: 'step-2' }],
      hintPolicy: { ladder: ['hint'] },
    });
    const decision = decideSubmission(step, { kind: 'reflection' }, 0);
    expect(decision).toEqual({
      correctness: 'not_applicable',
      supportLevel: 0,
      action: 'ADVANCE',
      nextStepId: 'step-2',
    });
  });

  it('scores a partial matching answer the same as incorrect for retry purposes', () => {
    const step = makeStep({
      type: 'MATCHING',
      presentation: {
        kind: 'matching',
        prompt: 'Match tools to jobs',
        pairs: [
          { leftId: 'hammer', rightId: 'nail' },
          { leftId: 'saw', rightId: 'plank' },
        ],
      },
      transitions: [
        { when: 'correct', nextStepId: 'step-2' },
        { when: 'partial', nextStepId: 'step-1' },
        { when: 'incorrect', nextStepId: 'step-1' },
      ],
      hintPolicy: { ladder: ['Look again.'] },
    });
    const decision = decideSubmission(
      step,
      {
        kind: 'matching',
        pairs: [
          { leftId: 'hammer', rightId: 'nail' },
          { leftId: 'saw', rightId: 'nail' },
        ],
      },
      0,
    );
    expect(decision.correctness).toBe('partial');
    expect(decision.action).toBe('RETRY');
  });

  it('throws when the answer kind does not match the step presentation, same as validateStepAnswer', () => {
    const step = makeStep({});
    expect(() => decideSubmission(step, { kind: 'choice', optionId: 'a' }, 0)).toThrow();
  });
});

describe('isStepAnswer', () => {
  it('accepts every well-formed answer kind', () => {
    expect(isStepAnswer({ kind: 'number-input', value: 4 })).toBe(true);
    expect(isStepAnswer({ kind: 'choice', optionId: 'a' })).toBe(true);
    expect(isStepAnswer({ kind: 'short-response', optionId: 'a' })).toBe(true);
    expect(isStepAnswer({ kind: 'creative-choice', optionId: 'a' })).toBe(true);
    expect(isStepAnswer({ kind: 'ordering', order: ['a', 'b'] })).toBe(true);
    expect(isStepAnswer({ kind: 'matching', pairs: [{ leftId: 'a', rightId: 'b' }] })).toBe(true);
    expect(isStepAnswer({ kind: 'reflection' })).toBe(true);
    expect(isStepAnswer({ kind: 'narrative' })).toBe(true);
    expect(isStepAnswer({ kind: 'world-change' })).toBe(true);
  });

  it('rejects malformed or missing payloads', () => {
    expect(isStepAnswer(null)).toBe(false);
    expect(isStepAnswer(undefined)).toBe(false);
    expect(isStepAnswer('correct')).toBe(false);
    expect(isStepAnswer({})).toBe(false);
    expect(isStepAnswer({ kind: 'number-input', value: '4' })).toBe(false);
    expect(isStepAnswer({ kind: 'choice' })).toBe(false);
    expect(isStepAnswer({ kind: 'ordering', order: 'a,b' })).toBe(false);
    expect(isStepAnswer({ kind: 'not-a-real-kind' })).toBe(false);
  });
});
