import { getSkill } from '../curriculum/queries';
import type { SkillProgress } from './api';
import { computeErrorPattern } from './errorPattern';
import { applyReviewDecay, computeSkillStatus, ZERO_SKILL_PROGRESS_COUNTS } from './status';
import type { MasteryDetail, MasterySummary, SkillProgressCounts, SkillStatus } from './types';

/** Keys a child's `SkillProgress` rows by skill/learning-objective id. */
export function indexProgressBySkill(rows: SkillProgress[]): Map<string, SkillProgressCounts> {
  const bySkill = new Map<string, SkillProgressCounts>();
  for (const row of rows) {
    bySkill.set(row.learningObjectiveCode, {
      exposureCount: row.exposureCount,
      independentSuccessCount: row.independentSuccessCount,
      supportedSuccessCount: row.supportedSuccessCount,
      consecutiveIndependentCorrect: row.consecutiveIndependentCorrect,
      lastPracticedAt: row.lastPracticedAt,
    });
  }
  return bySkill;
}

/**
 * Raw (pre-decay) status for every skill in `skillIds`, resolving each
 * skill's prerequisites recursively through the curriculum graph
 * (`src/features/curriculum`). "Known" for prerequisite purposes means
 * `PROFICIENT` or `MASTERED`, computed before review decay is applied —
 * decay is a display concern for a skill's own status, not a reason to
 * re-lock skills downstream of it (see `status.ts`). Unknown skill ids
 * (not in the curriculum graph) resolve to `LOCKED` defensively; a
 * prerequisite cycle, which the curriculum seed content should never
 * contain, also resolves to `LOCKED` rather than looping forever.
 */
export function resolveSkillStatuses(
  skillIds: readonly string[],
  progressBySkillId: ReadonlyMap<string, SkillProgressCounts>,
): Map<string, SkillStatus> {
  const resolved = new Map<string, SkillStatus>();
  const resolving = new Set<string>();

  function resolve(skillId: string): SkillStatus {
    const cached = resolved.get(skillId);
    if (cached) return cached;
    if (resolving.has(skillId)) return 'LOCKED';

    const skill = getSkill(skillId);
    if (!skill) {
      resolved.set(skillId, 'LOCKED');
      return 'LOCKED';
    }

    resolving.add(skillId);
    const prerequisitesSatisfied = skill.prerequisiteSkillIds.every((prerequisiteId) => {
      const prerequisiteStatus = resolve(prerequisiteId);
      return prerequisiteStatus === 'PROFICIENT' || prerequisiteStatus === 'MASTERED';
    });
    resolving.delete(skillId);

    const counts = progressBySkillId.get(skillId) ?? ZERO_SKILL_PROGRESS_COUNTS;
    const status = computeSkillStatus(counts, prerequisitesSatisfied);
    resolved.set(skillId, status);
    return status;
  }

  for (const skillId of skillIds) {
    resolve(skillId);
  }
  return resolved;
}

/**
 * Full detail, for the owning parent's own dashboard only — see
 * `MasteryDetail`'s doc comment for why this must not reach the AI Tutor
 * Engine or Adaptive Adventure Director.
 */
export function buildMasteryDetail(
  skillIds: readonly string[],
  progressBySkillId: ReadonlyMap<string, SkillProgressCounts>,
  now: Date = new Date(),
): MasteryDetail[] {
  const rawStatuses = resolveSkillStatuses(skillIds, progressBySkillId);
  return skillIds.map((skillId) => {
    const counts = progressBySkillId.get(skillId) ?? ZERO_SKILL_PROGRESS_COUNTS;
    const rawStatus = rawStatuses.get(skillId) ?? 'LOCKED';
    return {
      skillId,
      status: applyReviewDecay(rawStatus, counts.lastPracticedAt, now),
      rawStatus,
      errorPattern: computeErrorPattern(counts),
      exposureCount: counts.exposureCount,
      independentSuccessCount: counts.independentSuccessCount,
      supportedSuccessCount: counts.supportedSuccessCount,
      lastPracticedAt: counts.lastPracticedAt ?? null,
    };
  });
}

/**
 * The safe, summarized view for the AI Tutor Engine (Phase 27) and the
 * Adaptive Adventure Director (Phase 28) — status and skill identity
 * only, per `MasterySummary`'s doc comment.
 */
export function buildMasterySummary(
  skillIds: readonly string[],
  progressBySkillId: ReadonlyMap<string, SkillProgressCounts>,
  now: Date = new Date(),
): MasterySummary[] {
  return buildMasteryDetail(skillIds, progressBySkillId, now).map(({ skillId, status }) => ({
    skillId,
    status,
  }));
}
