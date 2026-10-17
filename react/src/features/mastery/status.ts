import type { SkillProgressCounts, SkillStatus } from './types';

/**
 * Initial deterministic thresholds, not a pedagogically validated model —
 * same "not yet formally decided" honesty as `docs/IMPLEMENTATION_STATUS.md`
 * "Decisions pending" for curriculum framework mapping. Easy to retune
 * without touching call sites, since every caller goes through
 * `computeSkillStatus`/`applyReviewDecay`.
 */
export const MASTERED_STREAK = 3;
export const MASTERED_MIN_INDEPENDENT = 5;
export const PROFICIENT_MIN_INDEPENDENT = 3;
export const PROFICIENT_MIN_RATIO = 0.6;
export const REVIEW_DECAY_DAYS = 21;

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A skill with no `SkillProgress` row yet (`exposureCount === 0`) has all
 * counters at zero, same as a freshly-created row — callers with no row
 * for a skill should pass this rather than special-casing "no row."
 */
export const ZERO_SKILL_PROGRESS_COUNTS: SkillProgressCounts = {
  exposureCount: 0,
  independentSuccessCount: 0,
  supportedSuccessCount: 0,
  consecutiveIndependentCorrect: 0,
  lastPracticedAt: null,
};

/**
 * `prerequisitesSatisfied` comes from the Learning Engine
 * (`src/features/curriculum/queries.ts`'s `isSkillUnlocked`) — the
 * Mastery Engine has no opinion on curriculum structure, only on evidence.
 * A skill the child has already been exposed to is never re-locked even
 * if a later curriculum edit changes its prerequisites, since exposure is
 * historical fact.
 */
export function computeSkillStatus(
  counts: SkillProgressCounts,
  prerequisitesSatisfied: boolean,
): SkillStatus {
  if (counts.exposureCount === 0 && !prerequisitesSatisfied) return 'LOCKED';
  if (counts.independentSuccessCount === 0) return 'INTRODUCED';
  if (
    counts.consecutiveIndependentCorrect >= MASTERED_STREAK &&
    counts.independentSuccessCount >= MASTERED_MIN_INDEPENDENT
  ) {
    return 'MASTERED';
  }
  if (
    counts.independentSuccessCount >= PROFICIENT_MIN_INDEPENDENT &&
    counts.independentSuccessCount / counts.exposureCount >= PROFICIENT_MIN_RATIO
  ) {
    return 'PROFICIENT';
  }
  return 'DEVELOPING';
}

/**
 * Review/decay rule: a `PROFICIENT`/`MASTERED` status earned long ago and
 * not practiced recently steps back down one level, so the world keeps
 * inviting review rather than treating mastery as permanent. This is a
 * read-time, presentational rule only — it never rewrites the stored
 * `SkillProgress` row, so a child's evidence history is never lost or
 * overwritten by the passage of time. The next real practice event
 * recomputes and persists a fresh status via `computeSkillStatus`.
 */
export function applyReviewDecay(
  status: SkillStatus,
  lastPracticedAt: string | null | undefined,
  now: Date = new Date(),
): SkillStatus {
  if (status !== 'PROFICIENT' && status !== 'MASTERED') return status;
  if (!lastPracticedAt) return status;
  const daysSincePractice = (now.getTime() - new Date(lastPracticedAt).getTime()) / ONE_DAY_MS;
  if (daysSincePractice < REVIEW_DECAY_DAYS) return status;
  return status === 'MASTERED' ? 'PROFICIENT' : 'DEVELOPING';
}
