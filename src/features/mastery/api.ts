import { client } from '../../lib/data-client';
import type { Schema } from '../../../amplify/data/resource';
import type { Correctness } from '../adventures/engine/types';
import { computeErrorPattern } from './errorPattern';
import { computeSkillStatus } from './status';
import type { SkillProgressCounts } from './types';

export type SkillProgress = Schema['SkillProgress']['type'];

/** One row per (child, skill) the child has ever practiced (parent dashboard), newest first. */
export async function listSkillProgress(childProfileId: string): Promise<SkillProgress[]> {
  const { data } = await client.models.SkillProgress.list();
  return data
    .filter((row: SkillProgress) => row.childProfileId === childProfileId)
    .sort((a: SkillProgress, b: SkillProgress) =>
      (b.lastPracticedAt ?? '').localeCompare(a.lastPracticedAt ?? ''),
    );
}

/**
 * One compact row per (child, skill), incremented rather than replaced, so
 * progress accumulates across sessions (DATA_MODEL.md SkillProgress: "Do
 * not label children with fixed ability judgments").
 *
 * A success only counts as independent when both the result is `correct`
 * and no hint was used (`supportLevel === 0`) — an incorrect/partial/
 * not_applicable result never increments either success counter, only
 * `exposureCount`. `prerequisitesSatisfied` is not a parameter here: a row
 * being written at all means `exposureCount` is about to be >= 1, and
 * `computeSkillStatus`'s `LOCKED` branch only ever applies at
 * `exposureCount === 0`, so a single skill's own write can never resolve
 * to `LOCKED` regardless of curriculum prerequisites — see
 * `resolveSkillStatuses` for the graph-aware read path that does compute
 * `LOCKED` for skills with no evidence at all.
 */
export async function upsertSkillProgress(
  childProfileId: string,
  learningObjectiveCode: string,
  correctness: Correctness,
  supportLevel: number,
): Promise<void> {
  const isIndependentSuccess = correctness === 'correct' && supportLevel === 0;
  const isSupportedSuccess = correctness === 'correct' && supportLevel > 0;

  const { data: existingRows } = await client.models.SkillProgress.list();
  const existing = existingRows.find(
    (row: SkillProgress) =>
      row.childProfileId === childProfileId && row.learningObjectiveCode === learningObjectiveCode,
  );
  const now = new Date().toISOString();

  const counts: SkillProgressCounts = existing
    ? {
        exposureCount: existing.exposureCount + 1,
        independentSuccessCount: existing.independentSuccessCount + (isIndependentSuccess ? 1 : 0),
        supportedSuccessCount: existing.supportedSuccessCount + (isSupportedSuccess ? 1 : 0),
        consecutiveIndependentCorrect: isIndependentSuccess
          ? existing.consecutiveIndependentCorrect + 1
          : 0,
        lastPracticedAt: now,
      }
    : {
        exposureCount: 1,
        independentSuccessCount: isIndependentSuccess ? 1 : 0,
        supportedSuccessCount: isSupportedSuccess ? 1 : 0,
        consecutiveIndependentCorrect: isIndependentSuccess ? 1 : 0,
        lastPracticedAt: now,
      };

  const recentLevel = computeSkillStatus(counts, true);
  const errorPattern = computeErrorPattern(counts);

  if (!existing) {
    const { errors } = await client.models.SkillProgress.create({
      childProfileId,
      learningObjectiveCode,
      exposureCount: counts.exposureCount,
      independentSuccessCount: counts.independentSuccessCount,
      supportedSuccessCount: counts.supportedSuccessCount,
      consecutiveIndependentCorrect: counts.consecutiveIndependentCorrect,
      recentLevel,
      errorPattern,
      lastPracticedAt: now,
    });
    if (errors?.length) {
      throw new Error(errors[0]?.message ?? 'Could not record skill progress.');
    }
    return;
  }

  const { errors } = await client.models.SkillProgress.update({
    id: existing.id,
    exposureCount: counts.exposureCount,
    independentSuccessCount: counts.independentSuccessCount,
    supportedSuccessCount: counts.supportedSuccessCount,
    consecutiveIndependentCorrect: counts.consecutiveIndependentCorrect,
    recentLevel,
    errorPattern,
    lastPracticedAt: now,
  });
  if (errors?.length) {
    throw new Error(errors[0]?.message ?? 'Could not record skill progress.');
  }
}
