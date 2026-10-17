/**
 * Adaptive Adventure Director (docs/ROADMAP.md Phase 28,
 * docs/ARCHITECTURE.md "Platform engine boundaries").
 *
 * Decides which adventure to put in front of a child next, favouring skills
 * they are still working on. Everything here is pure and deterministic: no
 * AI touches this, because "what should this child do next" is a judgment
 * about a child, and CLAUDE.md section 7 keeps those in application code.
 *
 * Three boundaries define the whole module and are worth stating up front:
 *
 * 1. **It reads `MasterySummary`, never `MasteryDetail`.** Status and skill
 *    identity only. Raw counts, `lastPracticedAt`, and `errorPattern` stay
 *    behind in the Mastery Engine, which is the rule Phase 20 wrote into
 *    `MasteryDetail`'s own doc comment before this engine existed.
 * 2. **It ranks, it does not gate.** Age band is the only hard filter, and
 *    it belongs to the Adventure Engine (`isAdventureForAgeBand`). Nothing
 *    here withholds content because a child is "not ready"; a lower rank
 *    moves an adventure down a list, never off the island.
 * 3. **Its reasoning is adult-facing.** A `SelectionRecord` explains why an
 *    adventure ranked where it did, for a developer or a parent-facing
 *    surface. None of that vocabulary may reach a child: CLAUDE.md pillar 7
 *    and section 3 both rule out presenting learning as remediation, so a
 *    child sees adventures in an order, never a reason.
 */
import type { SkillStatus } from '../mastery/types';

/**
 * How much a child would benefit from practising one skill right now.
 *
 * These weights are authored product constants, not a validated model of
 * learning - the same honesty Phase 20's mastery thresholds and Phase 23's
 * relationship thresholds are documented with.
 *
 * `LOCKED` scores zero, and not because the skill is finished: a locked
 * skill has unmet prerequisites, so practising it would put a child in front
 * of something they have not been prepared for. The two ends of the ladder
 * score zero for opposite reasons, which is why this is a lookup rather than
 * an arithmetic inversion of the status order.
 */
export const SKILL_NEED_WEIGHT: Readonly<Record<SkillStatus, number>> = {
  LOCKED: 0,
  INTRODUCED: 3,
  DEVELOPING: 2,
  PROFICIENT: 1,
  MASTERED: 0,
};

/** One skill and how much practice it currently wants. */
export interface SkillNeed {
  skillId: string;
  status: SkillStatus;
  weight: number;
}

/**
 * Why an adventure ranked where it did. A closed union rather than free text,
 * so a record stays machine-readable, testable, and impossible to smuggle a
 * child-facing sentence into.
 */
export type SelectionReason =
  | { kind: 'PRACTISES_SKILL'; skillId: string; status: SkillStatus; weight: number }
  | { kind: 'CONTINUES_STORY'; storyId: string }
  | { kind: 'ALREADY_COMPLETED'; penalty: number }
  | { kind: 'PLAYED_RECENTLY'; penalty: number }
  | { kind: 'NO_SKILLS_NEEDED' };

/** One candidate adventure, scored, with the reasoning that produced the score. */
export interface SelectionRecord {
  adventureSlug: string;
  title: string;
  score: number;
  reasons: SelectionReason[];
}

/**
 * Everything the Director may see about one child. Assembled by `api.ts`
 * from engines that already own the data; this module never reads the
 * network and never receives a nickname, age, identifier, or free text.
 */
export interface DirectorContext {
  /** Safe per-skill view from the Mastery Engine (Phase 20). */
  masterySummaries: readonly MasterySummaryLike[];
  /** `AdventureDefinition.slug` values with a COMPLETED session. */
  completedAdventureSlugs: readonly string[];
  /**
   * Slugs from the child's most recent sessions, newest first. Used only to
   * damp repetition, never to hide anything.
   */
  recentAdventureSlugs: readonly string[];
  /** Story ids the child has started and not finished (Phase 12). */
  storiesInProgress: readonly string[];
}

/** Structural shape of `MasterySummary`, restated so this module imports no value from Mastery. */
export interface MasterySummaryLike {
  skillId: string;
  status: SkillStatus;
}
