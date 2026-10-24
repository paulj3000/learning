import { nextHintLevel, isGuidedCompletion } from './hints';
import { getNextStepId } from './transitions';
import type { AdventureStep, Correctness } from './types';
import { validateStepAnswer, type StepAnswer } from './validators';

/*
 * The submission decision tree, shared by the `submitAdventureAnswer` Lambda
 * (amplify/functions/submit-adventure-answer/handler.ts, which re-exports
 * these) and the golden vectors that pin it for the Python port (LAI-0303,
 * LAI-0601). Moved here unchanged from the Lambda so the vectors do not have
 * to import an AWS handler.
 */

export interface SubmissionDecision {
  correctness: Correctness;
  supportLevel: number;
  action: 'RETRY' | 'ADVANCE';
  /** Set only when `action` is `'ADVANCE'`. */
  nextStepId?: string;
}

/**
 * Pure decision logic, kept separate from the AWS SDK calls below so it can
 * be unit tested without mocking DynamoDB (same split
 * `amplify/functions/claim-coop-slot/handler.ts`'s `decideClaim` already
 * established). Mirrors `useAdventureSession.submitAnswer`'s decision tree
 * exactly (`src/features/adventures/useAdventureSession.ts`): a wrong
 * answer on a step with a hint policy retries and escalates the hint
 * ladder instead of advancing, unless the ladder has already reached
 * "guided completion" (`isGuidedCompletion`), in which case the child is
 * carried forward as if correct — the same age-appropriate "never let a
 * child get stuck forever" rule the client used to apply itself.
 */
export function decideSubmission(
  step: AdventureStep,
  answer: StepAnswer,
  hintLevel: number,
): SubmissionDecision {
  const correctness = validateStepAnswer(step, answer);
  const needsRetry =
    (correctness === 'incorrect' || correctness === 'partial') && Boolean(step.hintPolicy);

  if (needsRetry) {
    const escalatedHintLevel = nextHintLevel(hintLevel);
    if (isGuidedCompletion(escalatedHintLevel)) {
      const finalCorrectness: Correctness = 'correct';
      return {
        correctness: finalCorrectness,
        supportLevel: escalatedHintLevel,
        action: 'ADVANCE',
        nextStepId: getNextStepId(step, finalCorrectness),
      };
    }
    return { correctness, supportLevel: escalatedHintLevel, action: 'RETRY' };
  }

  return {
    correctness,
    supportLevel: hintLevel,
    action: 'ADVANCE',
    nextStepId: getNextStepId(step, correctness),
  };
}

/**
 * Minimal shape guard for the decoded `answer` argument, external data at
 * this boundary (CLAUDE.md section 13). Deliberately shallow: anything
 * that gets past this but still does not match `step.presentation.kind`
 * is rejected by `validateStepAnswer` itself, which throws on a kind
 * mismatch rather than guessing.
 */
export function isStepAnswer(value: unknown): value is StepAnswer {
  if (typeof value !== 'object' || value === null || !('kind' in value)) return false;
  const kind = (value as { kind: unknown }).kind;
  switch (kind) {
    case 'number-input':
      return typeof (value as { value?: unknown }).value === 'number';
    case 'choice':
    case 'short-response':
    case 'creative-choice':
      return typeof (value as { optionId?: unknown }).optionId === 'string';
    case 'ordering':
      return Array.isArray((value as { order?: unknown }).order);
    case 'matching':
      return Array.isArray((value as { pairs?: unknown }).pairs);
    case 'reflection':
    case 'narrative':
    case 'world-change':
      return true;
    default:
      return false;
  }
}
