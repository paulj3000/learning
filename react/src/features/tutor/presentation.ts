import type { CompanionIntent, CompanionTurn } from '../companion/schema';
import type { CompanionTurnState } from '../companion/useCompanionTurn';
import type { TutorStrategy, TutorTurn } from './types';
import type { TutorTurnState } from './useTutorTurn';

/**
 * Presentation adapter only. The child never meets "the tutor" as a
 * separate character: Chatty the Parrot is one companion with one voice and
 * one speech bubble (CLAUDE.md section 6), so a validated tutoring turn is
 * projected into the shape `CompanionBubble` already renders rather than
 * growing a second bubble beside it.
 *
 * Nothing downstream of this function makes a decision from the projected
 * intent, which is why the lossy mapping below is safe: `strategy` is the
 * field that carries meaning, and it stays intact on the `TutorTurn` for
 * the audit trail and for any adult-facing surface that wants it.
 */
const INTENT_BY_STRATEGY: Record<TutorStrategy, CompanionIntent> = {
  EXPLAIN: 'HINT',
  ASK_GUIDING_QUESTION: 'ASK',
  GIVE_HINT: 'HINT',
  ENCOURAGE: 'NARRATE',
  SWITCH_REPRESENTATION: 'HINT',
};

export function toCompanionTurn(turn: TutorTurn): CompanionTurn {
  return {
    spokenText: turn.spokenText,
    emotion: turn.emotion,
    intent: INTENT_BY_STRATEGY[turn.strategy],
    safetyDisposition: turn.safetyDisposition,
  };
}

export function toCompanionTurnState(state: TutorTurnState): CompanionTurnState {
  if (state.status !== 'ready') return state;
  return { status: 'ready', turn: toCompanionTurn(state.turn), source: state.source };
}
