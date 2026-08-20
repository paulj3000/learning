import type { AgeBandValue } from '../child-profile/constants';

/**
 * Curriculum content (Subject -> Grade -> Domain -> Skill), owned by the
 * Learning Engine (docs/ARCHITECTURE.md "Platform engine boundaries").
 * Source-controlled content, not a DB model, same pattern as
 * `AdventureTemplate` and the flat `LearningObjective` list this graph
 * grows beyond (docs/DATA_MODEL.md: "Content packs are not database
 * models").
 *
 * `Skill.id` values are the existing `learningObjectiveCode` strings
 * already written by `upsertSkillProgress` (`SkillProgress`,
 * `SkillEvidence`) and already referenced by adventure content's
 * `objectiveIds`, so this graph layers structure over evidence that is
 * already being recorded rather than requiring a data migration.
 */

export type CurriculumRepresentation = 'numeric' | 'visual' | 'word-problem' | 'game-interaction';

export interface Subject {
  id: string;
  title: string;
}

export interface Grade {
  id: string;
  subjectId: string;
  title: string;
  /** Which child age bands this grade/level is appropriate for. */
  ageBands: AgeBandValue[];
}

export interface Domain {
  id: string;
  gradeId: string;
  title: string;
}

export interface Skill {
  id: string;
  domainId: string;
  title: string;
  description: string;
  /** Skill IDs that should be introduced before this one. */
  prerequisiteSkillIds: string[];
  /** 1 (easiest) to 5 (hardest), relative to this skill's own domain. */
  difficulty: 1 | 2 | 3 | 4 | 5;
  representations: CurriculumRepresentation[];
  /**
   * Optional external standards mapping (for example a Common Core code).
   * Left unpopulated in the current seed content: "Formal curriculum
   * framework mapping" is still a pending decision
   * (docs/IMPLEMENTATION_STATUS.md "Decisions pending"), so no specific
   * standards codes are asserted here yet. The field exists so a future
   * decision can populate it without a schema change.
   */
  standardsRefs?: string[];
}
