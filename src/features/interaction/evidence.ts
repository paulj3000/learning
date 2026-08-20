import type { Correctness } from '../adventures/engine/types';
import { hintLevelForScaffoldingLevel } from '../teaching/scaffolding';
import type { ScaffoldingLevel } from '../teaching/types';
import type { InteractionEvidence } from './types';

/**
 * The "attempt, hint, duration, and result capture" deliverable (roadmap
 * Phase 22), as a pure function rather than a React hook — domain logic
 * stays independent of components (CLAUDE.md section 13). Callers own
 * their own attempt counter and start-of-attempt timestamp (the same
 * pattern `useAdventureSession.ts` already uses for `attemptNumber`);
 * this just assembles the evidence shape once an answer is evaluated.
 */
export function buildInteractionEvidence(input: {
  interactionId: string;
  objectiveIds: string[];
  correctness: Correctness;
  attemptNumber: number;
  scaffoldingLevel: ScaffoldingLevel | undefined;
  startedAtMs: number;
  nowMs?: number;
}): InteractionEvidence {
  const nowMs = input.nowMs ?? Date.now();
  return {
    interactionId: input.interactionId,
    objectiveIds: input.objectiveIds,
    correctness: input.correctness,
    attemptNumber: input.attemptNumber,
    scaffoldingLevel: input.scaffoldingLevel,
    durationMs: Math.max(0, nowMs - input.startedAtMs),
  };
}

/** The existing 1-5 integer, or `0` for no scaffold used — what `recordAction`/`recordSkillEvidence` already expect. */
export function evidenceHintLevel(evidence: InteractionEvidence): number {
  return evidence.scaffoldingLevel ? hintLevelForScaffoldingLevel(evidence.scaffoldingLevel) : 0;
}
