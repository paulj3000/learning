import { describe, expect, it } from 'vitest';
import {
  NEEDS_SUPPORT_MIN_EXPOSURES,
  NEEDS_SUPPORT_RATIO,
  STALL_MIN_EXPOSURES,
  computeErrorPattern,
} from './errorPattern';
import { ZERO_SKILL_PROGRESS_COUNTS } from './status';
import type { SkillProgressCounts } from './types';

function counts(overrides: Partial<SkillProgressCounts>): SkillProgressCounts {
  return { ...ZERO_SKILL_PROGRESS_COUNTS, ...overrides };
}

describe('computeErrorPattern', () => {
  it('is NONE with no exposure', () => {
    expect(computeErrorPattern(ZERO_SKILL_PROGRESS_COUNTS)).toBe('NONE');
  });

  it('is NONE for a clean run of independent successes', () => {
    expect(computeErrorPattern(counts({ exposureCount: 2, independentSuccessCount: 2 }))).toBe(
      'NONE',
    );
  });

  it('is STALLED after repeated exposure with zero independent success', () => {
    expect(
      computeErrorPattern(
        counts({ exposureCount: STALL_MIN_EXPOSURES, supportedSuccessCount: STALL_MIN_EXPOSURES }),
      ),
    ).toBe('STALLED');
  });

  it('is not STALLED below the stall exposure threshold', () => {
    expect(
      computeErrorPattern(
        counts({ exposureCount: STALL_MIN_EXPOSURES - 1, supportedSuccessCount: 1 }),
      ),
    ).not.toBe('STALLED');
  });

  it('is NEEDS_SUPPORT once at least half of exposures ended supported', () => {
    expect(
      computeErrorPattern(
        counts({
          exposureCount: NEEDS_SUPPORT_MIN_EXPOSURES,
          supportedSuccessCount: Math.ceil(NEEDS_SUPPORT_MIN_EXPOSURES * NEEDS_SUPPORT_RATIO),
        }),
      ),
    ).toBe('NEEDS_SUPPORT');
  });

  it('prefers STALLED over NEEDS_SUPPORT when both conditions hold', () => {
    expect(
      computeErrorPattern(
        counts({ exposureCount: STALL_MIN_EXPOSURES, supportedSuccessCount: STALL_MIN_EXPOSURES }),
      ),
    ).toBe('STALLED');
  });

  it('is INCONSISTENT with a mix of independent and supported success below the support ratio', () => {
    expect(
      computeErrorPattern(
        counts({ exposureCount: 4, independentSuccessCount: 2, supportedSuccessCount: 1 }),
      ),
    ).toBe('INCONSISTENT');
  });
});
