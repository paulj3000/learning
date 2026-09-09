import type { LearningDomain, SkillLevel } from '../learning-profile/types';

/**
 * The Adaptive Challenge Engine (`docs/regions/clockwork.md` section 8,
 * "Phase 2"). Shared island infrastructure per section 32, not something
 * Clockwork Harbor owns - hence `src/features/challenges/` rather than a
 * folder under the region.
 *
 * Two rules from CLAUDE.md shape this module and are worth stating before the
 * types:
 *
 * - **Correctness is never AI's decision.** CLAUDE.md section 7: "gameplay
 *   correctness must be evaluated by application code whenever possible".
 *   Section 15 of the roadmap says the same thing in its own words. So a
 *   `Challenge` carries its own `solution` and `gradeChallenge` is a pure
 *   function. AI may phrase a hint; it never says whether the child was right.
 * - **A challenge is content, not a database row.** Same status as
 *   `AdventureTemplate` and `ISLAND_LOCATIONS` (`docs/DATA_MODEL.md`:
 *   "Content packs are not database models").
 */

/** Section 8's challenge types. */
export type ChallengeType =
  | 'MULTIPLE_CHOICE'
  | 'NUMBER_INPUT'
  | 'TEXT_INPUT'
  | 'MATCHING'
  | 'SEQUENCE'
  | 'OBJECT_PLACEMENT'
  | 'MECHANICAL'
  | 'DIALOGUE'
  | 'EXPLORATION'
  | 'INFERENCE';

/**
 * A solution, in the shape its `ChallengeType` implies.
 *
 * A tagged union rather than a loose `unknown`, so `gradeChallenge` can check
 * an answer without casting and TypeScript can tell an author they have paired
 * a `SEQUENCE` challenge with a single number.
 */
export type ChallengeSolution =
  | { kind: 'exact-number'; value: number }
  /** `tolerance` is inclusive, for measurement challenges where "close enough" is the real-world answer. */
  | { kind: 'number-within'; value: number; tolerance: number }
  | { kind: 'choice'; optionId: string }
  /** Order matters. Used by `SEQUENCE` and by `MECHANICAL` gear trains. */
  | { kind: 'ordered-ids'; ids: readonly string[] }
  /** Order does not matter. Used by `MATCHING` and `OBJECT_PLACEMENT`. */
  | { kind: 'unordered-ids'; ids: readonly string[] }
  /** Compared case-insensitively after trimming; never fuzzy-matched, so a child is never told a real answer was wrong on a technicality nobody can see. */
  | { kind: 'text'; accepted: readonly string[] };

/**
 * One rung of section 8's support ladder, authored per challenge.
 *
 * The ladder is `Contextual Hint -> Second Attempt -> Visual Demonstration ->
 * Simplified Version`, and every rung is authored so a child is never left
 * without help when AI is unavailable (CLAUDE.md section 7: "every response
 * must have a safe fallback authored in code").
 */
export interface HintLevel {
  /** 1 is the gentlest nudge; higher is more explicit. */
  level: number;
  /** Authored, readable aloud, and never naming a score or a skill (CLAUDE.md section 13). */
  text: string;
  /**
   * An optional in-world demonstration to show alongside the text - the
   * ladder's "Visual Demonstration" rung. An id the region's scene knows how to
   * play, never a raw asset url.
   */
  demonstrationId?: string;
}

export interface Challenge {
  challengeId: string;
  /** The quest this challenge belongs to, in the shared LAI quest system (section 6). */
  questId: string;
  skillDomain: LearningDomain;
  /** What level this variant is authored for. `selectChallengeVariant` picks among variants by the child's own level. */
  skillLevel: SkillLevel;
  challengeType: ChallengeType;
  /**
   * The in-world framing. Section 2.1 is emphatic that this must carry a
   * purpose ("The lift needs 56 units of power...") rather than state a bare
   * exercise ("Solve 8 x 7").
   */
  prompt: string;
  solution: ChallengeSolution;
  hintLevels: readonly HintLevel[];
  /**
   * How many attempts before the ladder reaches its last rung. Not a lockout:
   * running out moves the child to a simplified variant, never to a dead end
   * (CLAUDE.md pillar 7, "calm engagement").
   */
  attemptLimit: number;
  /** The change key recorded on completion, or an item id. Optional: not every challenge pays out. */
  reward?: string;
}

/** What the child submitted, in the same shape family as `ChallengeSolution`. */
export type ChallengeAnswer =
  | { kind: 'number'; value: number }
  | { kind: 'choice'; optionId: string }
  | { kind: 'ids'; ids: readonly string[] }
  | { kind: 'text'; value: string };

/** Where a child stands on one challenge right now. Held for the length of an attempt, not persisted as its own model. */
export interface ChallengeAttemptState {
  challengeId: string;
  attemptCount: number;
  hintsUsed: number;
}

/** What the engine decided to do next, after grading one answer. */
export type ChallengeOutcome =
  | { kind: 'CORRECT'; reward?: string }
  /** Show this hint and let them try again - the ladder's first three rungs. */
  | { kind: 'RETRY_WITH_HINT'; hint: HintLevel }
  /**
   * The ladder's last rung. The child has used every authored hint, so the
   * challenge is swapped for an easier variant rather than repeated.
   * `targetLevel` is never below 1.
   */
  | { kind: 'OFFER_SIMPLER'; targetLevel: SkillLevel };
