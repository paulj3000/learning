import type { ErrorPattern, SkillStatus } from '../mastery/types';
import type { TeachingPhase } from './types';

export interface TeachingPhaseInput {
  /** Displayed (decay-adjusted) status, `MasteryDetail.status`. */
  status: SkillStatus;
  /** Pre-decay status, `MasteryDetail.rawStatus`. */
  rawStatus: SkillStatus;
  errorPattern: ErrorPattern;
  exposureCount: number;
}

/**
 * Derives a skill's current lesson phase purely from the Mastery Engine's
 * already-computed evidence — no separate persisted lesson-progress
 * state. Initial, documented thresholds, same "not pedagogically
 * validated" honesty as `src/features/mastery/status.ts`'s constants.
 *
 * - A skill that decayed (status differs from rawStatus, i.e. review
 *   decay fired) always resolves to `REVIEW`, regardless of the decayed
 *   status level — a lapsed skill needs a refresher, not a from-scratch
 *   re-teach.
 * - `LOCKED` resolves to `INTRODUCE` as a harmless default; callers
 *   should not present teaching UI for a locked skill at all (the
 *   Learning Engine's `isSkillUnlocked` is the actual gate).
 * - `INTRODUCED` splits on whether the child has attempted the skill yet
 *   (`exposureCount`): zero attempts is `INTRODUCE` (first exposure,
 *   nothing graded yet); any attempts with still no independent success
 *   is `DEMONSTRATE` (they have tried and need to be shown, not just
 *   told).
 * - `DEVELOPING` splits on `errorPattern`: a clean run so far
 *   (`NONE`) is `INDEPENDENT_PRACTICE`; anything showing struggle
 *   (`NEEDS_SUPPORT`, `INCONSISTENT`, `STALLED`) is `GUIDED_PRACTICE`.
 * - `PROFICIENT` splits the same way: a clean run is `MASTERY_CHECK`
 *   (ready to confirm); still-mixed evidence is `APPLICATION` (practice
 *   applying it in varied contexts before certifying mastery).
 * - `MASTERED` (undecayed) is `MASTERY_CHECK` — periodic light
 *   confirmation rather than nothing at all.
 */
export function deriveTeachingPhase(input: TeachingPhaseInput): TeachingPhase {
  if (input.status !== input.rawStatus) return 'REVIEW';

  switch (input.status) {
    case 'LOCKED':
      return 'INTRODUCE';
    case 'INTRODUCED':
      return input.exposureCount === 0 ? 'INTRODUCE' : 'DEMONSTRATE';
    case 'DEVELOPING':
      return input.errorPattern === 'NONE' ? 'INDEPENDENT_PRACTICE' : 'GUIDED_PRACTICE';
    case 'PROFICIENT':
      return input.errorPattern === 'NONE' ? 'MASTERY_CHECK' : 'APPLICATION';
    case 'MASTERED':
      return 'MASTERY_CHECK';
  }
}
