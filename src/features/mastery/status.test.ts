import { describe, expect, it } from 'vitest';
import {
  MASTERED_MIN_INDEPENDENT,
  MASTERED_STREAK,
  PROFICIENT_MIN_INDEPENDENT,
  REVIEW_DECAY_DAYS,
  ZERO_SKILL_PROGRESS_COUNTS,
  applyReviewDecay,
  computeSkillStatus,
} from './status';
import type { SkillProgressCounts } from './types';

function counts(overrides: Partial<SkillProgressCounts>): SkillProgressCounts {
  return { ...ZERO_SKILL_PROGRESS_COUNTS, ...overrides };
}

describe('computeSkillStatus', () => {
  it('is LOCKED only when there is no exposure and prerequisites are unmet', () => {
    expect(computeSkillStatus(ZERO_SKILL_PROGRESS_COUNTS, false)).toBe('LOCKED');
  });

  it('is INTRODUCED, not LOCKED, once there is any exposure, even with unmet prerequisites', () => {
    expect(computeSkillStatus(counts({ exposureCount: 1 }), false)).toBe('INTRODUCED');
  });

  it('is INTRODUCED with no exposure once prerequisites are satisfied', () => {
    expect(computeSkillStatus(ZERO_SKILL_PROGRESS_COUNTS, true)).toBe('INTRODUCED');
  });

  it('is INTRODUCED after exposure with no independent success yet', () => {
    expect(
      computeSkillStatus(counts({ exposureCount: 2, supportedSuccessCount: 2 }), true),
    ).toBe('INTRODUCED');
  });

  it('is DEVELOPING with some independent success below the proficient threshold', () => {
    expect(
      computeSkillStatus(
        counts({ exposureCount: 1, independentSuccessCount: 1, consecutiveIndependentCorrect: 1 }),
        true,
      ),
    ).toBe('DEVELOPING');
  });

  it('is PROFICIENT once independent success meets the count and ratio thresholds', () => {
    expect(
      computeSkillStatus(
        counts({
          exposureCount: 4,
          independentSuccessCount: PROFICIENT_MIN_INDEPENDENT,
          consecutiveIndependentCorrect: 1,
        }),
        true,
      ),
    ).toBe('PROFICIENT');
  });

  it('is DEVELOPING, not PROFICIENT, when the independent ratio is too low', () => {
    expect(
      computeSkillStatus(
        counts({ exposureCount: 10, independentSuccessCount: PROFICIENT_MIN_INDEPENDENT }),
        true,
      ),
    ).toBe('DEVELOPING');
  });

  it('is MASTERED once the independent streak and total both clear their thresholds', () => {
    expect(
      computeSkillStatus(
        counts({
          exposureCount: MASTERED_MIN_INDEPENDENT,
          independentSuccessCount: MASTERED_MIN_INDEPENDENT,
          consecutiveIndependentCorrect: MASTERED_STREAK,
        }),
        true,
      ),
    ).toBe('MASTERED');
  });

  it('is PROFICIENT, not MASTERED, when the streak is long enough but the total is not', () => {
    expect(
      computeSkillStatus(
        counts({
          exposureCount: MASTERED_MIN_INDEPENDENT - 1,
          independentSuccessCount: MASTERED_MIN_INDEPENDENT - 1,
          consecutiveIndependentCorrect: MASTERED_STREAK,
        }),
        true,
      ),
    ).toBe('PROFICIENT');
  });
});

describe('applyReviewDecay', () => {
  const now = new Date('2026-08-20T00:00:00Z');

  it('leaves LOCKED, INTRODUCED, and DEVELOPING untouched regardless of lastPracticedAt', () => {
    const longAgo = new Date(now.getTime() - 100 * 24 * 60 * 60 * 1000).toISOString();
    expect(applyReviewDecay('LOCKED', longAgo, now)).toBe('LOCKED');
    expect(applyReviewDecay('INTRODUCED', longAgo, now)).toBe('INTRODUCED');
    expect(applyReviewDecay('DEVELOPING', longAgo, now)).toBe('DEVELOPING');
  });

  it('leaves PROFICIENT/MASTERED untouched with no lastPracticedAt on record', () => {
    expect(applyReviewDecay('PROFICIENT', null, now)).toBe('PROFICIENT');
    expect(applyReviewDecay('MASTERED', undefined, now)).toBe('MASTERED');
  });

  it('leaves PROFICIENT/MASTERED untouched when practiced recently', () => {
    const recent = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString();
    expect(applyReviewDecay('PROFICIENT', recent, now)).toBe('PROFICIENT');
    expect(applyReviewDecay('MASTERED', recent, now)).toBe('MASTERED');
  });

  it('decays MASTERED to PROFICIENT and PROFICIENT to DEVELOPING once the review window has passed', () => {
    const stale = new Date(
      now.getTime() - (REVIEW_DECAY_DAYS + 1) * 24 * 60 * 60 * 1000,
    ).toISOString();
    expect(applyReviewDecay('MASTERED', stale, now)).toBe('PROFICIENT');
    expect(applyReviewDecay('PROFICIENT', stale, now)).toBe('DEVELOPING');
  });

  it('decays exactly at the review window boundary', () => {
    const boundary = new Date(
      now.getTime() - REVIEW_DECAY_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    expect(applyReviewDecay('PROFICIENT', boundary, now)).toBe('DEVELOPING');
  });

  it('does not decay just under the review window boundary', () => {
    const almost = new Date(
      now.getTime() - (REVIEW_DECAY_DAYS * 24 * 60 * 60 * 1000 - 1000),
    ).toISOString();
    expect(applyReviewDecay('PROFICIENT', almost, now)).toBe('PROFICIENT');
  });
});
