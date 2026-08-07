import { describe, expect, it } from 'vitest';
import { validateCompanionTurn } from './schema';

const baseContext = { expectedIntent: 'HINT' as const, maxLength: 200 };

describe('validateCompanionTurn', () => {
  it('accepts a well-formed turn', () => {
    const result = validateCompanionTurn(
      {
        spokenText: 'Try counting the gaps one at a time.',
        emotion: 'ENCOURAGING',
        intent: 'HINT',
        safetyDisposition: 'ALLOW',
      },
      baseContext,
    );
    expect(result.valid).toBe(true);
  });

  it('accepts and normalizes lower-case enum values from a real model response', () => {
    const result = validateCompanionTurn(
      {
        spokenText: 'Try counting the gaps one at a time.',
        emotion: 'curious',
        intent: 'HINT',
        safetyDisposition: 'allow',
      },
      baseContext,
    );
    expect(result).toEqual({
      valid: true,
      turn: {
        spokenText: 'Try counting the gaps one at a time.',
        emotion: 'CURIOUS',
        intent: 'HINT',
        choices: undefined,
        safetyDisposition: 'ALLOW',
      },
    });
  });

  it('rejects a non-object response', () => {
    const result = validateCompanionTurn('not an object', baseContext);
    expect(result.valid).toBe(false);
  });

  it('rejects an empty spokenText', () => {
    const result = validateCompanionTurn(
      { spokenText: '  ', emotion: 'CALM', intent: 'HINT', safetyDisposition: 'ALLOW' },
      baseContext,
    );
    expect(result.valid).toBe(false);
  });

  it('rejects an unknown emotion', () => {
    const result = validateCompanionTurn(
      { spokenText: 'Hi!', emotion: 'GRUMPY', intent: 'HINT', safetyDisposition: 'ALLOW' },
      baseContext,
    );
    expect(result.valid).toBe(false);
  });

  it('rejects an intent that does not match what was requested', () => {
    const result = validateCompanionTurn(
      { spokenText: 'Hi!', emotion: 'CALM', intent: 'CELEBRATE', safetyDisposition: 'ALLOW' },
      baseContext,
    );
    expect(result.valid).toBe(false);
  });

  it('allows the model to escalate to REDIRECT regardless of requested intent', () => {
    const result = validateCompanionTurn(
      {
        spokenText: "Let's ask a grown-up about that.",
        emotion: 'CALM',
        intent: 'REDIRECT',
        safetyDisposition: 'REDIRECT',
      },
      baseContext,
    );
    expect(result.valid).toBe(true);
  });

  it('rejects spokenText longer than the age-band limit', () => {
    const result = validateCompanionTurn(
      {
        spokenText: 'x'.repeat(201),
        emotion: 'CALM',
        intent: 'HINT',
        safetyDisposition: 'ALLOW',
      },
      baseContext,
    );
    expect(result.valid).toBe(false);
  });

  it('rejects spokenText containing a URL', () => {
    const result = validateCompanionTurn(
      {
        spokenText: 'Visit example.com to learn more!',
        emotion: 'CALM',
        intent: 'HINT',
        safetyDisposition: 'ALLOW',
      },
      baseContext,
    );
    expect(result.valid).toBe(false);
  });

  it('rejects spokenText requesting personal information', () => {
    const result = validateCompanionTurn(
      {
        spokenText: 'What is your home address?',
        emotion: 'CALM',
        intent: 'HINT',
        safetyDisposition: 'ALLOW',
      },
      baseContext,
    );
    expect(result.valid).toBe(false);
  });

  it('rejects choices when none were allowed', () => {
    const result = validateCompanionTurn(
      {
        spokenText: 'Pick one!',
        emotion: 'CURIOUS',
        intent: 'HINT',
        safetyDisposition: 'ALLOW',
        choices: [{ id: 'a', label: 'A' }],
      },
      baseContext,
    );
    expect(result.valid).toBe(false);
  });

  it('rejects a choice ID that was not in the allowed set', () => {
    const result = validateCompanionTurn(
      {
        spokenText: 'Pick one!',
        emotion: 'CURIOUS',
        intent: 'HINT',
        safetyDisposition: 'ALLOW',
        choices: [{ id: 'not-allowed', label: 'Nope' }],
      },
      { ...baseContext, allowedChoiceIds: ['a', 'b'] },
    );
    expect(result.valid).toBe(false);
  });

  it('accepts choices that are all within the allowed set', () => {
    const result = validateCompanionTurn(
      {
        spokenText: 'Pick one!',
        emotion: 'CURIOUS',
        intent: 'HINT',
        safetyDisposition: 'ALLOW',
        choices: [{ id: 'a', label: 'A' }],
      },
      { ...baseContext, allowedChoiceIds: ['a', 'b'] },
    );
    expect(result.valid).toBe(true);
  });
});
