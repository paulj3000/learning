/**
 * Skill-needs ranking (docs/ROADMAP.md Phase 28: "skill-needs ranking
 * sourced from Phase 20 mastery summaries").
 *
 * Pure and total. Given the safe summary view, produce an ordered list of
 * what this child would most benefit from practising. Nothing here decides
 * what a child may see - that is `select.ts` - and nothing here reads
 * anything the Mastery Engine did not already agree to expose.
 */
import { SKILL_NEED_WEIGHT, type MasterySummaryLike, type SkillNeed } from './types';

/** The need for one skill, from its status alone. */
export function skillNeed(summary: MasterySummaryLike): SkillNeed {
  return {
    skillId: summary.skillId,
    status: summary.status,
    weight: SKILL_NEED_WEIGHT[summary.status],
  };
}

/**
 * Every skill this child has a reason to practise, most in need first.
 *
 * Zero-weight skills are dropped rather than ranked last: a `MASTERED` skill
 * and a `LOCKED` one both score zero, so keeping them would produce a tail
 * ordered by nothing meaningful. Ties break on `skillId` so a child's
 * ordering is stable between sessions rather than reshuffling under them
 * (docs/UX_AND_ACCESSIBILITY.md).
 */
export function rankSkillNeeds(summaries: readonly MasterySummaryLike[]): SkillNeed[] {
  return summaries
    .map(skillNeed)
    .filter((need) => need.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.skillId.localeCompare(b.skillId));
}

/** Need weight per skill id, for scoring an adventure's objectives. */
export function needWeightBySkillId(
  summaries: readonly MasterySummaryLike[],
): ReadonlyMap<string, SkillNeed> {
  return new Map(rankSkillNeeds(summaries).map((need) => [need.skillId, need]));
}
