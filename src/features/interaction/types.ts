/**
 * Interaction Engine (docs/ARCHITECTURE.md "Platform engine boundaries",
 * docs/ROADMAP.md Phase 22). A reusable, cross-adventure interaction
 * contract: six named mechanics, each split into `skillParams`
 * (correctness-determining data — never shown to the child) and
 * `presentation` (labels/copy/units — never used for correctness), kept
 * as separate types rather than one blob, per the roadmap's own
 * deliverable ("skill parameters kept separate from visual/story
 * presentation"). Mirrors the existing per-step contract
 * (`src/features/adventures/engine/types.ts`'s `PresentationSpec`,
 * `validators.ts`'s `StepAnswer`) but generalized to be adventure-
 * independent — this module owns no adventure/step concept at all.
 */

import type { Correctness } from '../adventures/engine/types';
import type { ScaffoldingLevel } from '../teaching/types';

export type InteractionMechanic = 'DRAG_SORT' | 'SPLIT' | 'MEASURE' | 'BUILD' | 'DECODE' | 'CONVERSE';

export interface InteractionItem {
  id: string;
  label: string;
}

/** Correctness-determining data only. Never rendered directly. */
export type InteractionSkillParams =
  | { mechanic: 'DRAG_SORT'; correctOrder: string[] }
  | { mechanic: 'SPLIT'; total: number; partsCount: number }
  | { mechanic: 'MEASURE'; targetValue: number; tolerance: number }
  | { mechanic: 'BUILD'; requiredPieceIds: string[] }
  | { mechanic: 'DECODE'; pairs: Array<{ promptId: string; answerId: string }> }
  | { mechanic: 'CONVERSE'; acceptedResponseIds: string[] };

/** Themeable labels/copy only. Never used for correctness. */
export type InteractionPresentation =
  | { mechanic: 'DRAG_SORT'; prompt: string; items: InteractionItem[] }
  | { mechanic: 'SPLIT'; prompt: string; totalLabel: string; partsCount: number }
  | { mechanic: 'MEASURE'; prompt: string; unit: string }
  | { mechanic: 'BUILD'; prompt: string; availablePieces: InteractionItem[] }
  | { mechanic: 'DECODE'; prompt: string; prompts: InteractionItem[]; choices: InteractionItem[] }
  | { mechanic: 'CONVERSE'; prompt: string; responses: InteractionItem[] };

export type InteractionAnswer =
  | { mechanic: 'DRAG_SORT'; order: string[] }
  | { mechanic: 'SPLIT'; parts: number[] }
  | { mechanic: 'MEASURE'; value: number }
  | { mechanic: 'BUILD'; selectedPieceIds: string[] }
  | { mechanic: 'DECODE'; matches: Array<{ promptId: string; answerId: string }> }
  | { mechanic: 'CONVERSE'; responseId: string };

/**
 * A full interaction: which skills/objectives it evidences, plus the two
 * separated data halves above. `id` is a stable content identifier (same
 * role as `AdventureStep.id`), not a DB row id.
 */
export interface InteractionSpec {
  id: string;
  objectiveIds: string[];
  skillParams: InteractionSkillParams;
  presentation: InteractionPresentation;
}

/**
 * The "attempt, hint, duration, and result capture" deliverable's output
 * shape — everything needed to feed `recordAction`/`recordSkillEvidence`/
 * `upsertSkillProgress` (`src/features/adventures/api.ts`,
 * `src/features/mastery/api.ts`) for any interaction, regardless of
 * mechanic. `scaffoldingLevel` is the Teaching Engine's vocabulary
 * (`src/features/teaching`), translated to the existing integer
 * `hintLevel`/`supportLevel` at the call site via
 * `hintLevelForScaffoldingLevel`.
 */
export interface InteractionEvidence {
  interactionId: string;
  objectiveIds: string[];
  correctness: Correctness;
  attemptNumber: number;
  scaffoldingLevel: ScaffoldingLevel | undefined;
  durationMs: number;
}
