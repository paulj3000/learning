import {
  createGameplayEventFactory,
  type AnyGameplayEvent,
  type GameplayEventContext,
  type GameplayEventPayloads,
  type GameplayEventType,
} from '@lai/game-engine/contracts';
import { forwardClaim } from '../../runtime/gameplayClaimSink';

/**
 * GE-072: which `lai.gameplay-event` v1 claims Storykeeper Castle reports, and how.
 *
 * Claims are facts for Django to confirm, never awards (`docs/engineering/game-engine/
 * public-contracts.md` section 2). Each one here follows something the server already accepted
 * or recorded, so it only restates it; scoring (GE-100) keys any award on the server rows. This
 * replaces the castle's own scoring-source names (SC-JMP-08 prep): the castle has no second
 * vocabulary and no points.
 *
 * | Castle fact | Claim |
 * |---|---|
 * | A castle adventure step answered (card, walk-in, aim or pad: one submit) | `learning.answer.submitted`, `ADVENTURE_STEP` |
 * | A castle adventure session completed | `adventure.completed` |
 * | A room recorded as discovered for the first time | `exploration.area.entered` |
 *
 * Wrong answers are claimed like right ones (the server grades). No correctness, support level,
 * band or child data is ever in a claim. Hops, falls, views and recoveries are not claims.
 */

export const CASTLE_REALM_ID = 'storykeeper-castle';
/** The castle is one 3D place; its rooms are reported as areas the child explored. */
export const CASTLE_AREA_ID = 'storykeeper-castle';

export type CastleClaim = {
  [T in GameplayEventType]: { type: T; payload: GameplayEventPayloads[T] };
}[GameplayEventType];

/** The claim context: inside an adventure session, or exploring the castle (no session). */
export function castleClaimContext(
  adventureSlug: string | null,
  sessionId: string | null,
): GameplayEventContext {
  return {
    realmId: CASTLE_REALM_ID,
    adventureId: adventureSlug ?? CASTLE_REALM_ID,
    areaId: CASTLE_AREA_ID,
    sessionRef: adventureSlug ? sessionId : null,
  };
}

/** An authored option id when the answer carries one (choice, creative choice, short response). */
function choiceIdOf(answer: unknown): string | null {
  if (typeof answer !== 'object' || answer === null) return null;
  const optionId = (answer as { optionId?: unknown }).optionId;
  return typeof optionId === 'string' && optionId.length > 0 ? optionId : null;
}

export function answerClaim(stepId: string, answer: unknown): CastleClaim {
  return {
    type: 'learning.answer.submitted',
    payload: { learningRef: { kind: 'ADVENTURE_STEP', stepId }, choiceId: choiceIdOf(answer) },
  };
}

export function adventureCompletedClaim(): CastleClaim {
  return { type: 'adventure.completed', payload: {} };
}

export function roomExploredClaim(roomId: string): CastleClaim {
  return { type: 'exploration.area.entered', payload: { areaId: roomId } };
}

/** Builds the claim for `context` and hands it to the visit's sink. Never throws. */
export function emitCastleClaim(context: GameplayEventContext, claim: CastleClaim): void {
  try {
    const factory = createGameplayEventFactory(context);
    forwardClaim(factory.create(claim.type, claim.payload as never) as AnyGameplayEvent);
  } catch {
    // An unbuildable claim is dropped: a child's play never fails for scoring.
  }
}
