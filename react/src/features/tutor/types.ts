/**
 * AI Tutor Engine (docs/ROADMAP.md Phase 27, docs/ARCHITECTURE.md
 * "Platform engine boundaries"). Chatty the Parrot, teaching one already
 * chosen skill with one already chosen strategy.
 *
 * The engine boundary that matters here: this module decides how something
 * is *said*, never what is *true*. Correctness stays with the Adventure
 * Engine, mastery stays with the Mastery Engine, and which skill to work on
 * stays with the caller - CLAUDE.md section 7's "gameplay correctness must
 * be evaluated by application code" is unchanged by this phase. A tutoring
 * turn is presentation, and a failed one costs the child an authored line
 * rather than a wrong answer.
 */
import type { AgeBandValue } from '../child-profile/constants';
import type { CurriculumRepresentation } from '../curriculum/types';
import type { CompanionEmotion, SafetyDisposition } from '../companion/schema';

/**
 * The approved-strategies schema from the roadmap's Phase 27 deliverables:
 * "Chatty can explain, ask guiding questions, hint, encourage, and switch
 * representations". A closed union, in the roadmap's own order, for the
 * same reason `NpcCondition` and `QuestObjective` are closed unions - a
 * strategy the island did not author is not a strategy.
 *
 * Note what is *absent*, which is the other half of the same deliverable
 * ("cannot independently determine mastery, invent curriculum
 * requirements, or bypass safety constraints"): there is no ASSESS, no
 * SET_GOAL, no ADVANCE, and no OVERRIDE. Those are not strategies the
 * validator rejects, they are strategies that do not exist, so no model
 * response can request one.
 */
export type TutorStrategy =
  'EXPLAIN' | 'ASK_GUIDING_QUESTION' | 'GIVE_HINT' | 'ENCOURAGE' | 'SWITCH_REPRESENTATION';

export const APPROVED_TUTOR_STRATEGIES: readonly TutorStrategy[] = [
  'EXPLAIN',
  'ASK_GUIDING_QUESTION',
  'GIVE_HINT',
  'ENCOURAGE',
  'SWITCH_REPRESENTATION',
];

/**
 * Everything the tutor route is allowed to know, and the exact argument set
 * `requestTutorTurn` sends to Bedrock (amplify/data/resource.ts's
 * `generateTutorTurn`). The roadmap's deliverable is a context builder
 * "assembling only current quest, current skill, known prerequisites,
 * allowed vocabulary, and current hint level - not a full child profile or
 * history", and this interface is where that is enforced: there is no field
 * for a child profile id, nickname, age, mastery status, counts, error
 * pattern, session history, or free text, so `buildTutorContext` cannot
 * leak one by accident and a reviewer can check the whole surface in one
 * screen (docs/AI_AND_CHILD_SAFETY.md "Prompt context minimization").
 *
 * Everything here is either an authored string (curriculum and quest copy
 * written by a content designer, identical for every child) or a bounded
 * scalar. Nothing a child typed or said ever reaches this shape.
 */
export interface TutorContext {
  ageBand: AgeBandValue;
  /** Chosen deterministically by `strategyForHintLevel`, never by the model. */
  strategy: TutorStrategy;
  maxLength: number;
  /** `Skill.title` - authored curriculum copy. */
  skillTitle: string;
  /** `Skill.description` - authored curriculum copy. */
  skillDescription: string;
  /**
   * The complete list of learning words this turn may use. Sent to the
   * model as an instruction *and* enforced afterwards by
   * `validateTutorTurn`, which rejects any curriculum term outside it.
   */
  allowedVocabulary: readonly string[];
  /**
   * Authored titles of this skill's direct prerequisites the child has
   * already reached `PROFICIENT`/`MASTERED` on. Titles only: the statuses
   * that decided the split stay behind in the Mastery Engine, so this
   * carries "you can build on this" without carrying a judgment about the
   * child (docs/DATA_MODEL.md: "Do not label children with fixed ability
   * judgments").
   */
  knownPrerequisiteTitles: readonly string[];
  /** `Skill.representations`; the only ones a SWITCH_REPRESENTATION turn may name. */
  allowedRepresentations: readonly CurriculumRepresentation[];
  /** Child-facing authored quest title, for story continuity. */
  questTitle?: string;
  /** Child-facing authored stage heading, for story continuity. */
  questStageTitle?: string;
  /** The existing 1-5 hint-ladder rung (docs/ADVENTURE_ENGINE.md "Hint ladder"). */
  hintLevel: number;
  /** The adventure's own authored hint text at this rung; already correct. */
  authoredBaseText?: string;
}

/**
 * One validated tutoring turn. Narrower than `CompanionTurn` on purpose:
 * no `choices`, because a tutoring turn never drives gameplay.
 */
export interface TutorTurn {
  spokenText: string;
  strategy: TutorStrategy;
  /** Only present for SWITCH_REPRESENTATION, and only from the skill's own authored set. */
  representation?: CurriculumRepresentation;
  emotion: CompanionEmotion;
  safetyDisposition: SafetyDisposition;
}
