import { describe, expect, it } from 'vitest';
import { buildTutorContext } from './context';
import { disallowedCurriculumTerms, validateTutorTurn } from './schema';
import type { TutorContext } from './types';

function contextFor(hintLevel: number, skillId = 'counting-sets'): TutorContext {
  const context = buildTutorContext({ ageBand: 'PATHFINDER', skillId, hintLevel });
  if (!context) throw new Error('test fixture skill must be tutorable');
  return context;
}

const HINT_CONTEXT = contextFor(3);

function turn(overrides: Record<string, unknown> = {}) {
  return {
    spokenText: 'Try counting each plank one at a time.',
    strategy: 'GIVE_HINT',
    emotion: 'ENCOURAGING',
    safetyDisposition: 'ALLOW',
    ...overrides,
  };
}

describe('validateTutorTurn', () => {
  it('accepts a well-formed turn for the requested strategy', () => {
    const result = validateTutorTurn(turn(), HINT_CONTEXT);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.turn.strategy).toBe('GIVE_HINT');
      expect(result.turn.representation).toBeUndefined();
    }
  });

  it('normalizes casing the way the companion route already does', () => {
    const result = validateTutorTurn(
      turn({ strategy: 'give_hint', emotion: 'warm and curious', safetyDisposition: 'allow' }),
      HINT_CONTEXT,
    );
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.turn.strategy).toBe('GIVE_HINT');
      expect(result.turn.emotion).toBe('CURIOUS');
    }
  });

  it('rejects a strategy the model chose for itself', () => {
    const result = validateTutorTurn(turn({ strategy: 'EXPLAIN' }), HINT_CONTEXT);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toContain('did not match the requested strategy');
  });

  it('rejects a strategy that is not approved at all', () => {
    const result = validateTutorTurn(turn({ strategy: 'ASSESS_MASTERY' }), HINT_CONTEXT);
    expect(result.valid).toBe(false);
  });

  it('rejects a turn that decides what the child has learned', () => {
    const result = validateTutorTurn(
      turn({ spokenText: 'You have mastered counting! Ready for level 3.' }),
      HINT_CONTEXT,
    );
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toContain('claimed mastery');
  });

  it('rejects a turn that wanders into a curriculum topic it was not given', () => {
    const result = validateTutorTurn(
      turn({ spokenText: 'Counting is easy. Now try multiplication with those planks.' }),
      HINT_CONTEXT,
    );
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toContain('multiplication');
  });

  it('still applies the shared URL and personal-information checks', () => {
    expect(
      validateTutorTurn(turn({ spokenText: 'Look at www.example.com' }), HINT_CONTEXT).valid,
    ).toBe(false);
    expect(
      validateTutorTurn(turn({ spokenText: 'What is your school name?' }), HINT_CONTEXT).valid,
    ).toBe(false);
  });

  it('enforces the age band length budget', () => {
    const long = 'Count the planks. '.repeat(30);
    expect(validateTutorTurn(turn({ spokenText: long }), HINT_CONTEXT).valid).toBe(false);
  });

  it('rejects missing or empty required fields', () => {
    expect(validateTutorTurn(null, HINT_CONTEXT).valid).toBe(false);
    expect(validateTutorTurn(turn({ spokenText: '   ' }), HINT_CONTEXT).valid).toBe(false);
    expect(validateTutorTurn(turn({ emotion: undefined }), HINT_CONTEXT).valid).toBe(false);
    expect(validateTutorTurn(turn({ safetyDisposition: undefined }), HINT_CONTEXT).valid).toBe(
      false,
    );
  });

  it('keeps a non-ALLOW disposition rather than dropping it', () => {
    const result = validateTutorTurn(turn({ safetyDisposition: 'STOP' }), HINT_CONTEXT);
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.turn.safetyDisposition).toBe('STOP');
  });

  describe('representation', () => {
    const switchContext = contextFor(4);

    it('accepts one the curriculum authored for this skill', () => {
      const result = validateTutorTurn(
        turn({ strategy: 'SWITCH_REPRESENTATION', representation: 'visual' }),
        switchContext,
      );
      expect(result.valid).toBe(true);
      if (result.valid) expect(result.turn.representation).toBe('visual');
    });

    it('rejects one the curriculum never authored for this skill', () => {
      // `counting-sets` is authored as visual and game-interaction only.
      const result = validateTutorTurn(
        turn({ strategy: 'SWITCH_REPRESENTATION', representation: 'word-problem' }),
        switchContext,
      );
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.reason).toContain('curriculum authored');
    });

    it('rejects an invented representation', () => {
      const result = validateTutorTurn(
        turn({ strategy: 'SWITCH_REPRESENTATION', representation: 'interpretive-dance' }),
        switchContext,
      );
      expect(result.valid).toBe(false);
    });

    it('rejects one set on a turn that is not switching representation', () => {
      const result = validateTutorTurn(turn({ representation: 'visual' }), HINT_CONTEXT);
      expect(result.valid).toBe(false);
    });

    it('treats an empty representation as absent', () => {
      expect(validateTutorTurn(turn({ representation: '' }), HINT_CONTEXT).valid).toBe(true);
    });
  });
});

describe('disallowedCurriculumTerms', () => {
  it('matches whole words only', () => {
    expect(disallowedCurriculumTerms('The country is far away.', [])).toEqual([]);
    expect(disallowedCurriculumTerms('Send it to the address.', [])).toEqual([]);
  });

  it('finds terms the skill was not given', () => {
    expect(disallowedCurriculumTerms('Try dividing them into fractions.', ['count'])).toContain(
      'fractions',
    );
  });

  it('allows terms the skill was given', () => {
    expect(disallowedCurriculumTerms('Keep counting each one.', ['counting'])).toEqual([]);
  });
});
