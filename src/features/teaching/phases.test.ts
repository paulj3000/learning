import { describe, expect, it } from 'vitest';
import { deriveTeachingPhase, type TeachingPhaseInput } from './phases';
import { TEACHING_PHASE_ORDER, type TeachingPhase } from './types';

function input(overrides: Partial<TeachingPhaseInput> = {}): TeachingPhaseInput {
  return {
    status: 'INTRODUCED',
    rawStatus: 'INTRODUCED',
    errorPattern: 'NONE',
    exposureCount: 0,
    ...overrides,
  };
}

describe('deriveTeachingPhase', () => {
  it('lists all seven phases exactly once', () => {
    const asSet = new Set(TEACHING_PHASE_ORDER);
    expect(asSet.size).toBe(7);
    const expected: TeachingPhase[] = [
      'INTRODUCE',
      'DEMONSTRATE',
      'GUIDED_PRACTICE',
      'INDEPENDENT_PRACTICE',
      'APPLICATION',
      'MASTERY_CHECK',
      'REVIEW',
    ];
    expect([...asSet].sort()).toEqual([...expected].sort());
  });

  it('is REVIEW whenever review decay has fired, regardless of the decayed status', () => {
    expect(
      deriveTeachingPhase(input({ status: 'DEVELOPING', rawStatus: 'MASTERED' })),
    ).toBe('REVIEW');
    expect(
      deriveTeachingPhase(input({ status: 'PROFICIENT', rawStatus: 'MASTERED' })),
    ).toBe('REVIEW');
  });

  it('is INTRODUCE for a LOCKED skill', () => {
    expect(deriveTeachingPhase(input({ status: 'LOCKED', rawStatus: 'LOCKED' }))).toBe(
      'INTRODUCE',
    );
  });

  it('is INTRODUCE for an INTRODUCED skill with no attempts yet', () => {
    expect(
      deriveTeachingPhase(
        input({ status: 'INTRODUCED', rawStatus: 'INTRODUCED', exposureCount: 0 }),
      ),
    ).toBe('INTRODUCE');
  });

  it('is DEMONSTRATE for an INTRODUCED skill with attempts but no independent success', () => {
    expect(
      deriveTeachingPhase(
        input({ status: 'INTRODUCED', rawStatus: 'INTRODUCED', exposureCount: 2 }),
      ),
    ).toBe('DEMONSTRATE');
  });

  it('is INDEPENDENT_PRACTICE for a clean DEVELOPING run', () => {
    expect(
      deriveTeachingPhase(
        input({ status: 'DEVELOPING', rawStatus: 'DEVELOPING', errorPattern: 'NONE' }),
      ),
    ).toBe('INDEPENDENT_PRACTICE');
  });

  it.each(['NEEDS_SUPPORT', 'INCONSISTENT', 'STALLED'] as const)(
    'is GUIDED_PRACTICE for a struggling DEVELOPING run (%s)',
    (errorPattern) => {
      expect(
        deriveTeachingPhase(input({ status: 'DEVELOPING', rawStatus: 'DEVELOPING', errorPattern })),
      ).toBe('GUIDED_PRACTICE');
    },
  );

  it('is MASTERY_CHECK for a clean PROFICIENT run', () => {
    expect(
      deriveTeachingPhase(
        input({ status: 'PROFICIENT', rawStatus: 'PROFICIENT', errorPattern: 'NONE' }),
      ),
    ).toBe('MASTERY_CHECK');
  });

  it('is APPLICATION for a still-mixed PROFICIENT run', () => {
    expect(
      deriveTeachingPhase(
        input({ status: 'PROFICIENT', rawStatus: 'PROFICIENT', errorPattern: 'INCONSISTENT' }),
      ),
    ).toBe('APPLICATION');
  });

  it('is MASTERY_CHECK for an undecayed MASTERED skill', () => {
    expect(deriveTeachingPhase(input({ status: 'MASTERED', rawStatus: 'MASTERED' }))).toBe(
      'MASTERY_CHECK',
    );
  });
});
