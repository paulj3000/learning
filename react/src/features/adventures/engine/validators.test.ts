import { describe, expect, it } from 'vitest';
import { validateStepAnswer } from './validators';
import type { AdventureStep } from './types';

function makeStep(overrides: Partial<AdventureStep>): AdventureStep {
  return {
    id: 'step-1',
    type: 'NARRATIVE',
    objectiveIds: [],
    presentation: { kind: 'narrative', speaker: 'Chatty', text: 'Hello!' },
    transitions: [{ when: 'always', nextStepId: 'step-2' }],
    fallback: { text: 'Fallback text.' },
    ...overrides,
  };
}

describe('validateStepAnswer', () => {
  it('marks a matching number correct', () => {
    const step = makeStep({
      type: 'NUMBER_INPUT',
      presentation: { kind: 'number-input', prompt: 'How many planks?', correctValue: 4 },
    });
    expect(validateStepAnswer(step, { kind: 'number-input', value: 4 })).toBe('correct');
  });

  it('marks a wrong number incorrect', () => {
    const step = makeStep({
      type: 'NUMBER_INPUT',
      presentation: { kind: 'number-input', prompt: 'How many planks?', correctValue: 4 },
    });
    expect(validateStepAnswer(step, { kind: 'number-input', value: 3 })).toBe('incorrect');
  });

  it('checks a choice by option id', () => {
    const step = makeStep({
      type: 'CHOICE',
      presentation: {
        kind: 'choice',
        prompt: 'Pick a bundle',
        options: [
          { id: 'a', label: 'Bundle A' },
          { id: 'b', label: 'Bundle B' },
        ],
        correctOptionId: 'b',
      },
    });
    expect(validateStepAnswer(step, { kind: 'choice', optionId: 'b' })).toBe('correct');
    expect(validateStepAnswer(step, { kind: 'choice', optionId: 'a' })).toBe('incorrect');
  });

  it('requires an exact sequence for ordering', () => {
    const step = makeStep({
      type: 'ORDERING',
      presentation: {
        kind: 'ordering',
        prompt: 'Order shortest to longest',
        items: [
          { id: 'short', label: 'Short plank' },
          { id: 'medium', label: 'Medium plank' },
          { id: 'long', label: 'Long plank' },
        ],
        correctOrder: ['short', 'medium', 'long'],
      },
    });
    expect(validateStepAnswer(step, { kind: 'ordering', order: ['short', 'medium', 'long'] })).toBe(
      'correct',
    );
    expect(validateStepAnswer(step, { kind: 'ordering', order: ['medium', 'short', 'long'] })).toBe(
      'incorrect',
    );
  });

  it('scores matching as correct, partial, or incorrect', () => {
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
    });
    expect(
      validateStepAnswer(step, {
        kind: 'matching',
        pairs: [
          { leftId: 'hammer', rightId: 'nail' },
          { leftId: 'saw', rightId: 'plank' },
        ],
      }),
    ).toBe('correct');
    expect(
      validateStepAnswer(step, {
        kind: 'matching',
        pairs: [
          { leftId: 'hammer', rightId: 'nail' },
          { leftId: 'saw', rightId: 'nail' },
        ],
      }),
    ).toBe('partial');
    expect(
      validateStepAnswer(step, {
        kind: 'matching',
        pairs: [
          { leftId: 'hammer', rightId: 'plank' },
          { leftId: 'saw', rightId: 'nail' },
        ],
      }),
    ).toBe('incorrect');
  });

  it('checks short response against accepted option ids', () => {
    const step = makeStep({
      type: 'SHORT_RESPONSE',
      presentation: {
        kind: 'short-response',
        prompt: 'What do we do first?',
        options: [
          { id: 'count', label: 'Count the planks' },
          { id: 'sing', label: 'Sing a song' },
        ],
        acceptedOptionIds: ['count'],
      },
    });
    expect(validateStepAnswer(step, { kind: 'short-response', optionId: 'count' })).toBe('correct');
    expect(validateStepAnswer(step, { kind: 'short-response', optionId: 'sing' })).toBe(
      'incorrect',
    );
  });

  it('always accepts a creative choice', () => {
    const step = makeStep({
      type: 'CREATIVE_CHOICE',
      presentation: {
        kind: 'creative-choice',
        prompt: 'Pick a flag color',
        options: [{ id: 'red', label: 'Red' }],
      },
    });
    expect(validateStepAnswer(step, { kind: 'creative-choice', optionId: 'red' })).toBe(
      'not_applicable',
    );
  });

  it('treats narrative, reflection, and world-change steps as not applicable', () => {
    expect(validateStepAnswer(makeStep({ type: 'NARRATIVE' }), { kind: 'narrative' })).toBe(
      'not_applicable',
    );
    expect(
      validateStepAnswer(
        makeStep({
          type: 'REFLECTION',
          presentation: { kind: 'reflection', prompt: 'How was that?' },
        }),
        { kind: 'reflection' },
      ),
    ).toBe('not_applicable');
    expect(
      validateStepAnswer(
        makeStep({
          type: 'WORLD_CHANGE',
          presentation: {
            kind: 'world-change',
            text: 'The bridge is repaired!',
            payload: {
              changeType: 'REPAIR',
              changeKey: 'BRIDGE_REPAIRED',
              locationSlug: 'pirate-builder-bay',
            },
          },
        }),
        { kind: 'world-change' },
      ),
    ).toBe('not_applicable');
  });

  it('throws when the answer kind does not match the step presentation', () => {
    const step = makeStep({
      type: 'NUMBER_INPUT',
      presentation: { kind: 'number-input', prompt: 'How many?', correctValue: 4 },
    });
    expect(() => validateStepAnswer(step, { kind: 'choice', optionId: 'a' })).toThrow();
  });
});
