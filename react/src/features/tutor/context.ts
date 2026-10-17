import { MAX_SPOKEN_LENGTH_BY_AGE_BAND } from '../companion/limits';
import { getSkill, listPrerequisites } from '../curriculum/queries';
import type { AgeBandValue } from '../child-profile/constants';
import type { MasterySummary } from '../mastery/types';
import { allowedVocabularyForSkill } from './content/vocabulary';
import { strategyForHintLevel } from './strategy';
import type { TutorContext } from './types';

/**
 * What a caller knows about the adventure in progress. Everything here is
 * either authored content or a bounded scalar; there is deliberately no
 * `childProfileId`, nickname, or session history parameter, so the safe
 * context builder cannot be handed something it would then have to remember
 * to drop (docs/AI_AND_CHILD_SAFETY.md "Prompt context minimization").
 *
 * `masterySummaries` is the one input derived from the child's own record,
 * and it is the Mastery Engine's already-summarized view
 * (`buildMasterySummary`: skill id and status, never counts or error
 * patterns). It is used here only to *split* prerequisite titles into known
 * and unknown, and the statuses themselves never reach `TutorContext` -
 * the roadmap's "full mastery detail is not sent to either" is enforced
 * twice over, once by the summary shape and once by this builder's output.
 */
export interface TutorContextInput {
  ageBand: AgeBandValue;
  /** `Skill.id`, which is the same string as the step's `learningObjectiveCode`. */
  skillId: string;
  /** The rung the hint ladder has reached (docs/ADVENTURE_ENGINE.md). */
  hintLevel: number;
  masterySummaries?: readonly MasterySummary[];
  /** Child-facing authored copy from the quest journal, when a quest is active. */
  questTitle?: string;
  questStageTitle?: string;
  /** The adventure's own authored hint text at this rung. */
  authoredBaseText?: string;
}

/** Prerequisite mastery counts as "known" at the same bar the curriculum graph uses. */
function isKnown(status: MasterySummary['status']): boolean {
  return status === 'PROFICIENT' || status === 'MASTERED';
}

/**
 * True when this skill can be tutored at all: the curriculum graph knows it
 * *and* a designer has authored tutoring vocabulary for it. Both halves
 * matter. A skill outside the seed curriculum has no title, description, or
 * representations to teach from, and a curriculum skill with no authored
 * vocabulary has no reviewed word list to bound the model with - so adding
 * either one alone must not silently open a new AI surface (the same
 * opt-in default as `DialogueNode.narration` in `src/features/npc/types.ts`).
 *
 * Callers that get `false` here should keep doing whatever they did before
 * this phase existed; the authored hint ladder is complete on its own.
 */
export function isTutorableSkill(skillId: string): boolean {
  return getSkill(skillId) !== undefined && allowedVocabularyForSkill(skillId) !== undefined;
}

/**
 * Assembles the only thing the tutor route is ever sent (roadmap Phase 27's
 * "tutor context builder"). Returns `undefined` for a skill that is not
 * tutorable, which callers must treat as "do not call the model" rather
 * than "call it with less" - a missing word list is exactly the case where
 * an unbounded prompt would be most tempting and least safe.
 */
export function buildTutorContext(input: TutorContextInput): TutorContext | undefined {
  const skill = getSkill(input.skillId);
  const allowedVocabulary = allowedVocabularyForSkill(input.skillId);
  if (!skill || !allowedVocabulary) return undefined;

  const statusBySkillId = new Map(
    (input.masterySummaries ?? []).map((summary) => [summary.skillId, summary.status]),
  );
  const knownPrerequisiteTitles = listPrerequisites(input.skillId)
    .filter((prerequisite) => {
      const status = statusBySkillId.get(prerequisite.id);
      return status !== undefined && isKnown(status);
    })
    .map((prerequisite) => prerequisite.title);

  return {
    ageBand: input.ageBand,
    strategy: strategyForHintLevel(input.hintLevel),
    maxLength: MAX_SPOKEN_LENGTH_BY_AGE_BAND[input.ageBand],
    skillTitle: skill.title,
    skillDescription: skill.description,
    allowedVocabulary,
    knownPrerequisiteTitles,
    allowedRepresentations: skill.representations,
    questTitle: input.questTitle,
    questStageTitle: input.questStageTitle,
    hintLevel: input.hintLevel,
    authoredBaseText: input.authoredBaseText,
  };
}
