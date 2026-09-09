import { MAX_DERIVED_LEVEL } from '../learning-profile/profile';
import { hasEvidence } from '../learning-profile/profile';
import type { DomainProfile, SkillLevel } from '../learning-profile/types';
import type {
  Challenge,
  ChallengeAnswer,
  ChallengeAttemptState,
  ChallengeOutcome,
  ChallengeSolution,
} from './types';

/**
 * Deterministic grading and section 8's adaptive rules
 * (`docs/regions/clockwork.md`).
 *
 * Every function here is pure. Nothing in this file calls a model, and nothing
 * in it may: CLAUDE.md section 7 requires gameplay correctness to be decided by
 * application code, and section 15 of the roadmap repeats it for this engine
 * specifically. AI's role sits above this layer, phrasing the hint text an
 * authored `HintLevel` already guarantees.
 */

function idsEqualOrdered(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

function idsEqualUnordered(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const remaining = [...b];
  for (const id of a) {
    const at = remaining.indexOf(id);
    if (at === -1) return false;
    remaining.splice(at, 1);
  }
  return true;
}

/** Normalizes free text before comparison: trimmed, collapsed whitespace, case-folded. Never fuzzy - see `ChallengeSolution`. */
function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Whether an answer satisfies a solution.
 *
 * A mismatch between the answer's shape and the solution's is `false` rather
 * than a thrown error: a shape mismatch is a content or client bug, and
 * throwing here would surface a raw error to a child mid-puzzle. The
 * authoring check that shapes line up belongs in a content test, not at the
 * point a five-year-old presses a button.
 */
export function isAnswerCorrect(solution: ChallengeSolution, answer: ChallengeAnswer): boolean {
  switch (solution.kind) {
    case 'exact-number':
      return answer.kind === 'number' && answer.value === solution.value;
    case 'number-within':
      return (
        answer.kind === 'number' && Math.abs(answer.value - solution.value) <= solution.tolerance
      );
    case 'choice':
      return answer.kind === 'choice' && answer.optionId === solution.optionId;
    case 'ordered-ids':
      return answer.kind === 'ids' && idsEqualOrdered(answer.ids, solution.ids);
    case 'unordered-ids':
      return answer.kind === 'ids' && idsEqualUnordered(answer.ids, solution.ids);
    case 'text':
      return (
        answer.kind === 'text' &&
        solution.accepted.some(
          (accepted) => normalizeText(accepted) === normalizeText(answer.value),
        )
      );
  }
}

/**
 * Grades one answer and decides the next step on section 8's support ladder.
 *
 * The ladder is `Failure -> Contextual Hint -> Second Attempt -> Visual
 * Demonstration -> Simplified Version`, so a wrong answer walks one rung down
 * the challenge's authored `hintLevels` and only offers an easier variant once
 * those run out. A child is never simply told "wrong" and left where they were.
 */
export function gradeChallenge(
  challenge: Challenge,
  answer: ChallengeAnswer,
  state: ChallengeAttemptState,
): { outcome: ChallengeOutcome; state: ChallengeAttemptState } {
  const attemptCount = state.attemptCount + 1;

  if (isAnswerCorrect(challenge.solution, answer)) {
    return {
      outcome: { kind: 'CORRECT', reward: challenge.reward },
      state: { ...state, attemptCount },
    };
  }

  const nextHint = challenge.hintLevels[state.hintsUsed];
  /*
    Out of authored hints, or past the attempt limit, means the ladder's last
    rung: offer the same challenge one level easier. `attemptLimit` is a floor
    on how much help a child gets before simplification, not a lockout - there
    is no branch here that ends the attempt without offering something next.
  */
  if (!nextHint || attemptCount >= challenge.attemptLimit) {
    return {
      outcome: {
        kind: 'OFFER_SIMPLER',
        targetLevel: Math.max(1, challenge.skillLevel - 1) as SkillLevel,
      },
      state: { ...state, attemptCount },
    };
  }

  return {
    outcome: { kind: 'RETRY_WITH_HINT', hint: nextHint },
    state: { attemptCount, challengeId: state.challengeId, hintsUsed: state.hintsUsed + 1 },
  };
}

/**
 * The level a challenge should be served at for one domain.
 *
 * Section 8's rules, in order of how load-bearing they are:
 *
 * 1. **"Failure should NOT immediately reduce skill level."** This function
 *    only ever reads a `DomainProfile`, which is derived from cumulative
 *    evidence (`computeLearningProfile`); a single wrong answer moves the
 *    child's successes not at all and their attempts by one, so it cannot pull
 *    the level down a rung. Difficulty relief for a struggling child comes
 *    from the *ladder* (`OFFER_SIMPLER`), which is scoped to the challenge in
 *    front of them and forgotten afterward, rather than from a demotion that
 *    would follow them around.
 * 2. **"Repeated success can increase difficulty."** A domain that is both
 *    settled (`confidence`) and going well gets promoted one rung.
 * 3. **An unevidenced domain is not scaled.** A domain the island has never
 *    assessed reports level 1 with zero confidence, which is an absence of
 *    data, not a low score - promoting or trusting it either way would be
 *    inventing an assessment that never happened.
 */
export function selectChallengeLevel(profile: DomainProfile): SkillLevel {
  if (!hasEvidence(profile)) return 1;

  const successRatio = profile.successes / profile.attempts;
  const readyToStretch = profile.confidence >= 0.7 && successRatio >= 0.8;
  if (!readyToStretch) return profile.level;

  return Math.min(profile.level + 1, MAX_DERIVED_LEVEL) as SkillLevel;
}

/**
 * Picks the authored variant of a challenge closest to `level`, preferring an
 * easier one on a tie.
 *
 * Preferring easier is deliberate: between two equally distant variants, the
 * one that lets a child succeed and continue is a better failure mode than the
 * one that stalls them, and section 2.1 wants the harbor to feel like an
 * adventure rather than an assessment. Returns `undefined` only when the
 * caller passed no variants at all.
 */
export function selectChallengeVariant(
  variants: readonly Challenge[],
  level: SkillLevel,
): Challenge | undefined {
  if (variants.length === 0) return undefined;
  return [...variants].sort((a, b) => {
    const distance = Math.abs(a.skillLevel - level) - Math.abs(b.skillLevel - level);
    return distance !== 0 ? distance : a.skillLevel - b.skillLevel;
  })[0];
}
