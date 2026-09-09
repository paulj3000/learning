import type { Skill } from '../curriculum/types';
import type { SkillProgressCounts } from '../mastery/types';

/**
 * The Learning Profile (`docs/regions/clockwork.md` section 7, "Phase 1 -
 * Skill Engine Foundation").
 *
 * The roadmap's goal for this layer is one sentence: "Separate educational
 * difficulty from age." Section 2.2 spells out the consequence - one world,
 * one story, and difficulty that moves with demonstrated skill rather than
 * with a birthday. Section 32 then asks that this become shared Learning
 * Adventure Island infrastructure rather than something Clockwork Harbor owns,
 * which is why it lives in `src/features/learning-profile/` and not under
 * `src/features/clockwork-harbor/`.
 *
 * ## Why this is derived, not stored
 *
 * The roadmap sketches the profile as a document to persist, with `level`,
 * `confidence`, `attempts`, and `successes` per domain. This codebase already
 * records exactly those counters, per skill, in `SkillProgress` -
 * `exposureCount`, `independentSuccessCount`, `supportedSuccessCount`,
 * `consecutiveIndependentCorrect` - written by `upsertSkillProgress` from
 * every adventure step a child completes anywhere on the island, and already
 * interpreted by the Mastery Engine.
 *
 * Persisting a second set of counters would mean two systems counting the same
 * answers, and they would disagree the first time one write path was missed.
 * Worse, a per-domain store would be blind to everything the child did before
 * Clockwork Harbor existed: a child who has been practicing counting in Pirate
 * Builder Bay for a month would arrive at the harbor as a beginner.
 *
 * So a `LearningProfile` is a **read-time aggregate** over `SkillProgress`
 * rows the island is already writing. Clockwork Harbor inherits the child's
 * whole history for free, and there is exactly one place a "success" is
 * counted. `computeLearningProfile` in `profile.ts` does the aggregation.
 *
 * ## What is genuinely new here
 *
 * Two things the Mastery Engine does not provide, both of which the roadmap
 * needs and neither of which duplicates it:
 *
 * 1. A **coarse domain grouping** (six domains) above the curriculum's
 *    fine-grained skills, because a puzzle asks "how good is this child at
 *    logic?", not "what is their status on `patterns`?".
 * 2. A **1-6 difficulty scale** (section 7's Explorer -> Master Explorer
 *    ladder) that a challenge can be authored against. `SkillStatus` answers
 *    "how well is this skill known", which is a different question from "how
 *    hard should the next puzzle be".
 */

/** Section 7's six domains. */
export const LEARNING_DOMAINS = [
  'math',
  'reading',
  'vocabulary',
  'logic',
  'science',
  'spatial',
] as const;

export type LearningDomain = (typeof LEARNING_DOMAINS)[number];

/**
 * Section 7's difficulty scale, 1-6.
 *
 * Level 6 is the roadmap's open-ended "Challenge Levels" band, which is a
 * ceiling rather than another rung: nothing auto-promotes into it (see
 * `MAX_DERIVED_LEVEL` in `profile.ts`), because "open-ended and increasingly
 * complex" is a decision for authored content, not for an arithmetic rule.
 */
export type SkillLevel = 1 | 2 | 3 | 4 | 5 | 6;

export const SKILL_LEVEL_TITLES: Readonly<Record<SkillLevel, string>> = {
  1: 'Explorer',
  2: 'Adventurer',
  3: 'Pathfinder',
  4: 'Trailblazer',
  5: 'Master Explorer',
  6: 'Challenge',
};

/** One domain's standing, in the shape section 7 asks for. */
export interface DomainProfile {
  domain: LearningDomain;
  level: SkillLevel;
  /**
   * 0-1. How much evidence stands behind `level`, not how well the child did:
   * a child who answered three questions correctly and a child who answered
   * thirty can both sit at level 3, but only the second should be moved up on
   * the strength of one more.
   *
   * Kept distinct from the success ratio on purpose. Section 8's adaptive rule
   * is that "repeated success can increase difficulty" while "failure should
   * NOT immediately reduce skill level", which needs a measure of *how settled*
   * a level is, separate from how often the child is right.
   */
  confidence: number;
  attempts: number;
  successes: number;
}

export interface LearningProfile {
  /** Every domain, always - a domain with no evidence reports level 1 with zero confidence rather than being absent. */
  domains: Readonly<Record<LearningDomain, DomainProfile>>;
}

/** What `computeLearningProfile` needs about one skill the child has practiced. */
export interface SkillEvidenceInput {
  skillId: string;
  counts: SkillProgressCounts;
}

/**
 * How a curriculum skill maps onto a Learning Profile domain.
 *
 * Authored rather than inferred from `Skill.domainId`, because the curriculum's
 * domains are subject-and-grade scoped ("early-number", "measurement-and-data",
 * "observing-and-sorting") while section 7's six are broad reasoning domains.
 * The two graphs answer different questions and there is no mechanical
 * translation between them, so the mapping is written down and tested for
 * completeness (`profile.test.ts`) rather than guessed at.
 *
 * `patterns` maps to `logic` rather than `math` deliberately: section 12 uses
 * gear patterns as the Adventurer-level rung of a reasoning puzzle, not as
 * arithmetic.
 */
export const SKILL_DOMAIN_MAP: Readonly<Record<string, LearningDomain>> = {
  // Math
  'counting-sets': 'math',
  'addition-within-ten': 'math',
  'subtraction-within-ten': 'math',
  'comparing-lengths': 'math',
  measurement: 'math',
  // Logic
  patterns: 'logic',
  classification: 'logic',
  'cause-and-effect': 'logic',
  // Science
  observation: 'science',
  'animal-science': 'science',
};

/**
 * Three of the six domains - `reading`, `vocabulary`, and `spatial` - have no
 * curriculum skills mapped to them, because the curriculum does not author any
 * yet: `SKILLS` currently holds ten skills across math and early science only.
 *
 * They are still listed in `LEARNING_DOMAINS` rather than being dropped,
 * because the roadmap's own chapters need them (section 11's Market Mystery is
 * reading and deduction, section 13's Gearwing Owl is spatial reasoning), and a
 * domain that reports level 1 with zero confidence is an honest answer for a
 * child the island has never assessed on it. What it must not do is silently
 * read as "this child is bad at reading" - so `hasEvidence` below lets a caller
 * tell "no evidence" apart from "assessed low", and the challenge engine
 * refuses to scale difficulty on an unevidenced domain.
 *
 * Authoring reading/vocabulary/spatial curriculum skills is the prerequisite
 * for those chapters, and is recorded as a known gap in
 * `docs/IMPLEMENTATION_STATUS.md`.
 */
export const DOMAINS_WITHOUT_CURRICULUM_SKILLS: readonly LearningDomain[] = [
  'reading',
  'vocabulary',
  'spatial',
];

/** The domain a skill belongs to, or `undefined` for a skill nobody has mapped yet. */
export function domainForSkill(skillId: string): LearningDomain | undefined {
  return SKILL_DOMAIN_MAP[skillId];
}

/** Every curriculum skill that has no domain mapping. Used by `profile.test.ts` as an authoring check, the same role `manifest.test.ts` plays for assets. */
export function unmappedSkills(skills: readonly Skill[]): string[] {
  return skills.filter((skill) => !SKILL_DOMAIN_MAP[skill.id]).map((skill) => skill.id);
}
