import { useCallback, useEffect, useRef } from 'react';
import type { Correctness } from '../../../../adventures/engine/types';
import { answerClaim, castleClaimContext, emitCastleClaim } from './castleGameplayClaims';
import { playCastleCue } from './castleSoundCues';

/**
 * Right, try-again and hint sounds for a castle adventure (SC-R06-01), raised from what the server
 * decided and never from a guess: the wrapped submit plays `answerRight` only for a `correct`
 * grade and `answerRetry` only for an `incorrect` one (a creative choice or a reflection, graded
 * `not_applicable`, is silent), and `hint` only when the hint level the server reports goes up on
 * the same step. Whether a Sprout hears the retry is the castle audio's rule, not this hook's.
 *
 * GE-072: with `claim`, every answer the server accepted (any grade) is also reported as a
 * `learning.answer.submitted` claim for the step. A pad, the card, a walk-in or an aim all reach
 * this one submit, so an answer is claimed once whichever way it was given. A failed submit
 * (`null`) claims nothing.
 *
 * One answer at a time: while a submit is in flight, another (a second lectern press, a portrait
 * looked at again, the card and a pad together) is not sent and resolves to `null`, so a child
 * cannot send the same answer twice or spend two hint rungs on one try. Callers treat `null` as
 * "nothing was graded", never as a wrong answer.
 */
export function useCastleAnswerCues<A>(
  submit: (answer: A) => Promise<Correctness | null>,
  stepId: string | null,
  hintLevel: number,
  claim: { adventureSlug: string; sessionId: string | null } | null = null,
): (answer: A) => Promise<Correctness | null> {
  const seen = useRef<{ stepId: string | null; hintLevel: number }>({ stepId, hintLevel });
  useEffect(() => {
    const previous = seen.current;
    seen.current = { stepId, hintLevel };
    if (previous.stepId === stepId && hintLevel > previous.hintLevel) playCastleCue('hint');
  }, [stepId, hintLevel]);

  const claimSlug = claim?.adventureSlug ?? null;
  const claimSession = claim?.sessionId ?? null;
  const inFlight = useRef(false);
  return useCallback(
    async (answer: A) => {
      if (inFlight.current) return null;
      inFlight.current = true;
      let correctness: Correctness | null;
      try {
        correctness = await submit(answer);
      } finally {
        inFlight.current = false;
      }
      if (correctness === 'correct') playCastleCue('answerRight');
      else if (correctness === 'incorrect') playCastleCue('answerRetry');
      if (correctness !== null && claimSlug && stepId) {
        emitCastleClaim(castleClaimContext(claimSlug, claimSession), answerClaim(stepId, answer));
      }
      return correctness;
    },
    [submit, claimSlug, claimSession, stepId],
  );
}
