/**
 * Mastery Engine (docs/ARCHITECTURE.md "Platform engine boundaries",
 * docs/ROADMAP.md Phase 20). Owns `SkillEvidence`/`SkillProgress`
 * (docs/DATA_MODEL.md "Engine ownership"). Pure, deterministic logic only
 * — no AI, per CLAUDE.md section 7 ("gameplay correctness must be
 * evaluated by application code").
 */

/** Per-skill status, in increasing order of independent competence. */
export type SkillStatus = 'LOCKED' | 'INTRODUCED' | 'DEVELOPING' | 'PROFICIENT' | 'MASTERED';

/**
 * The same ladder as an ordered list, so a caller can ask "is this status at
 * least X?" without hardcoding the order at the comparison site. Lives here,
 * next to the type it orders, for the same reason `RELATIONSHIP_LEVEL_ORDER`
 * lives beside `RelationshipLevel` in src/features/npc/types.ts.
 *
 * Added for the Phase 25 Quest Engine's `LEARN` objective; `status.ts` still
 * decides what a status *is*, and this only says how two of them compare.
 */
export const SKILL_STATUS_ORDER: readonly SkillStatus[] = [
  'LOCKED',
  'INTRODUCED',
  'DEVELOPING',
  'PROFICIENT',
  'MASTERED',
];

/**
 * A lightweight, count-derived signal, not a semantic misconception
 * taxonomy (which would need per-step authored error categories, out of
 * this phase's scope). `STALLED` takes priority over `NEEDS_SUPPORT`,
 * which takes priority over `INCONSISTENT`.
 */
export type ErrorPattern = 'NONE' | 'NEEDS_SUPPORT' | 'INCONSISTENT' | 'STALLED';

/** The raw counters a `SkillProgress` row carries, independent of the DB client type. */
export interface SkillProgressCounts {
  exposureCount: number;
  independentSuccessCount: number;
  supportedSuccessCount: number;
  consecutiveIndependentCorrect: number;
  lastPracticedAt: string | null | undefined;
}

/**
 * Full detail, for the owning parent's own dashboard only. Never sent to
 * the AI Tutor Engine or the Adaptive Adventure Director — see
 * `MasterySummary` below.
 */
export interface MasteryDetail {
  skillId: string;
  /** Displayed status, after `applyReviewDecay`. */
  status: SkillStatus;
  /**
   * Status before review decay. Differs from `status` exactly when decay
   * fired (a `PROFICIENT`/`MASTERED` skill not practiced recently) — the
   * Teaching Engine (Phase 21) uses this to tell "genuinely still
   * developing" apart from "lapsed from mastery," which call for
   * different lesson phases (`GUIDED_PRACTICE` vs `REVIEW`).
   */
  rawStatus: SkillStatus;
  errorPattern: ErrorPattern;
  exposureCount: number;
  independentSuccessCount: number;
  supportedSuccessCount: number;
  lastPracticedAt: string | null;
}

/**
 * The safe, summarized view exposed to the AI Tutor Engine (Phase 27) and
 * the Adaptive Adventure Director (Phase 28) — status and skill identity
 * only. Deliberately excludes raw counts, `lastPracticedAt`, and
 * `errorPattern` detail, matching this phase's deliverable that "full
 * mastery detail is not sent to either."
 */
export interface MasterySummary {
  skillId: string;
  status: SkillStatus;
}
