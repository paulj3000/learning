import type { Correctness } from '../adventures/engine/types';
import { ZERO_SKILL_PROGRESS_COUNTS } from './status';
import type { SkillProgressCounts } from './types';

/**
 * The `SkillProgress` counters after one more piece of evidence, as
 * `upsertSkillProgress` (api.ts) writes them. Pure, so the same rule can be
 * pinned by golden vectors and ported to Python (LAI-0303, LAI-0603);
 * extracted unchanged from `upsertSkillProgress`.
 *
 * A success only counts as independent when the result is `correct` and no
 * hint was used (`supportLevel === 0`). Any other result increments only
 * `exposureCount` and breaks the independent streak. `now` is passed in
 * because the clock belongs to the caller.
 */
export function nextSkillProgressCounts(
  existing: SkillProgressCounts | null | undefined,
  correctness: Correctness,
  supportLevel: number,
  now: string,
): SkillProgressCounts {
  const base = existing ?? ZERO_SKILL_PROGRESS_COUNTS;
  const isIndependentSuccess = correctness === 'correct' && supportLevel === 0;
  const isSupportedSuccess = correctness === 'correct' && supportLevel > 0;
  return {
    exposureCount: base.exposureCount + 1,
    independentSuccessCount: base.independentSuccessCount + (isIndependentSuccess ? 1 : 0),
    supportedSuccessCount: base.supportedSuccessCount + (isSupportedSuccess ? 1 : 0),
    consecutiveIndependentCorrect: isIndependentSuccess
      ? base.consecutiveIndependentCorrect + 1
      : 0,
    lastPracticedAt: now,
  };
}
