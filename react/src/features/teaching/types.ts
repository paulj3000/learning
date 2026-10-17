/**
 * Teaching Engine (docs/ARCHITECTURE.md "Platform engine boundaries",
 * docs/ROADMAP.md Phase 21). Generalizes the per-adventure hint ladder
 * (docs/ADVENTURE_ENGINE.md, `src/features/adventures/engine/hints.ts`)
 * into a reusable, cross-adventure lesson state machine and scaffolding
 * vocabulary. Owns no data model of its own — it is a pure, stateless
 * derivation over the Mastery Engine's already-recorded evidence
 * (`src/features/mastery`), same "no premature persistence" approach as
 * the Learning Engine's curriculum content.
 */

/**
 * A skill's lesson phase, in the roadmap's own listed order. Not strictly
 * linear in practice — a lapsed skill can land back on `REVIEW` from
 * `MASTERED` without passing back through the earlier phases — so treat
 * this as a labeled set of stages, not a single one-way pipeline.
 */
export type TeachingPhase =
  | 'INTRODUCE'
  | 'DEMONSTRATE'
  | 'GUIDED_PRACTICE'
  | 'INDEPENDENT_PRACTICE'
  | 'APPLICATION'
  | 'MASTERY_CHECK'
  | 'REVIEW';

export const TEACHING_PHASE_ORDER: readonly TeachingPhase[] = [
  'INTRODUCE',
  'DEMONSTRATE',
  'GUIDED_PRACTICE',
  'INDEPENDENT_PRACTICE',
  'APPLICATION',
  'MASTERY_CHECK',
  'REVIEW',
];

/**
 * The kind of support offered on a struggling attempt, from mildest to
 * most intensive. This is the roadmap's own vocabulary
 * (docs/ROADMAP.md Phase 21), a formalization of the existing "Adaptation"
 * list in docs/ADVENTURE_ENGINE.md ("show manipulatives or visual groups",
 * "provide a worked example using different values", etc.) rather than a
 * new idea. Deliberately kept numerically interchangeable with the
 * existing 1-5 `hintLevel`/`supportLevel` integers already recorded on
 * `AdventureAction`/`SkillEvidence` (`scaffolding.ts`'s
 * `scaffoldingLevelForHintLevel`/`hintLevelForScaffoldingLevel`), so this
 * is a labeling layer over data already being recorded, not a schema or
 * content migration of the five authored hint strings every adventure
 * step already has.
 */
export type ScaffoldingLevel =
  | 'CONTEXTUAL_HINT'
  | 'VISUAL_REPRESENTATION'
  | 'INTERACTIVE_MANIPULATIVE'
  | 'GUIDED_DEMONSTRATION'
  | 'EQUIVALENT_RETRY_PROBLEM';

export const SCAFFOLDING_LEVEL_ORDER: readonly ScaffoldingLevel[] = [
  'CONTEXTUAL_HINT',
  'VISUAL_REPRESENTATION',
  'INTERACTIVE_MANIPULATIVE',
  'GUIDED_DEMONSTRATION',
  'EQUIVALENT_RETRY_PROBLEM',
];
