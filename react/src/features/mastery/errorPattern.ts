import type { ErrorPattern, SkillProgressCounts } from './types';

/**
 * Count-derived only — not a semantic misconception taxonomy. A real
 * "what kind of mistake" classifier would need per-step authored error
 * categories, which is out of this phase's scope; this reads the shape
 * of a child's attempt history instead: never once independent
 * (`STALLED`), leaning on hints (`NEEDS_SUPPORT`), or a mix of both
 * (`INCONSISTENT`). Checked in priority order, most concerning first.
 */
export const STALL_MIN_EXPOSURES = 3;
export const NEEDS_SUPPORT_MIN_EXPOSURES = 2;
export const NEEDS_SUPPORT_RATIO = 0.5;

export function computeErrorPattern(counts: SkillProgressCounts): ErrorPattern {
  if (counts.exposureCount === 0) return 'NONE';

  if (counts.exposureCount >= STALL_MIN_EXPOSURES && counts.independentSuccessCount === 0) {
    return 'STALLED';
  }

  if (
    counts.exposureCount >= NEEDS_SUPPORT_MIN_EXPOSURES &&
    counts.supportedSuccessCount / counts.exposureCount >= NEEDS_SUPPORT_RATIO
  ) {
    return 'NEEDS_SUPPORT';
  }

  if (counts.independentSuccessCount > 0 && counts.supportedSuccessCount > 0) {
    return 'INCONSISTENT';
  }

  return 'NONE';
}
