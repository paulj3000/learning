import type { ApiError } from '../../api/errors';
import type {
  AnswerOutcome,
  IssuedChallenge,
  ItemView,
  PlaySession,
  QuestEntry,
  RegionBootstrap,
} from '../../api/play/types';

/**
 * Client state for playing one region as one child (TR-6). A pure reducer,
 * so the rules are testable without React:
 *
 * - **The server is the only source of truth.** Every field here is a copy of
 *   something the play API returned. No action marks a chest open, grants an
 *   item, or decides an answer; `answerAccepted` only records the server's
 *   outcome, and the hook re-reads the region after it.
 * - **Stale responses are dropped.** State belongs to one `scope` (child and
 *   region). Every action carries the scope it was started for, and an
 *   action for any other scope is ignored, so a reply that arrives after the
 *   parent switched children can never paint over the new child's state.
 * - **Rewards are shown once.** `rewards` holds items from successful answer
 *   outcomes, de-duplicated by id; a replayed answer (a 409) adds nothing.
 */

export type PlayActionName =
  | 'load'
  | 'startSession'
  | 'changeSession'
  | 'acceptQuest'
  | 'requestChallenge'
  | 'submitAnswer'
  | 'refresh';

export interface RegionPlayState {
  scope: string;
  status: 'idle' | 'loading' | 'ready' | 'error';
  bootstrap: RegionBootstrap | null;
  session: PlaySession | null;
  /** The outstanding challenge, if the child asked for one and has not answered it. */
  challenge: IssuedChallenge | null;
  lastOutcome: AnswerOutcome | null;
  /** Items newly granted during this visit, from server outcomes only. */
  rewards: ItemView[];
  /** The action in flight, so a UI can disable controls and a double tap sends nothing. */
  busy: PlayActionName | null;
  /** The last failure. A load failure also sets `status: 'error'`. */
  error: ApiError | null;
  errorAction: PlayActionName | null;
}

export type RegionPlayAction = { scope: string } & (
  | { type: 'reset' }
  | { type: 'started'; action: PlayActionName }
  | { type: 'failed'; action: PlayActionName; error: ApiError }
  | { type: 'loaded'; bootstrap: RegionBootstrap }
  | { type: 'sessionChanged'; session: PlaySession }
  | { type: 'questAccepted'; quest: QuestEntry }
  | { type: 'challengeIssued'; challenge: IssuedChallenge }
  | { type: 'answerAccepted'; outcome: AnswerOutcome }
  | { type: 'challengeCleared' }
);

export function scopeKey(childId: string, regionId: string): string {
  return `${childId}\u0000${regionId}`;
}

export function initialRegionPlayState(scope: string): RegionPlayState {
  return {
    scope,
    status: 'idle',
    bootstrap: null,
    session: null,
    challenge: null,
    lastOutcome: null,
    rewards: [],
    busy: null,
    error: null,
    errorAction: null,
  };
}

export function regionPlayReducer(state: RegionPlayState, action: RegionPlayAction): RegionPlayState {
  if (action.type === 'reset') return initialRegionPlayState(action.scope);
  if (action.scope !== state.scope) return state; // a reply for another child or region

  switch (action.type) {
    case 'started':
      return {
        ...state,
        busy: action.action,
        error: null,
        errorAction: null,
        status: action.action === 'load' ? 'loading' : state.status,
      };
    case 'failed':
      return {
        ...state,
        busy: null,
        error: action.error,
        errorAction: action.action,
        status: action.action === 'load' ? 'error' : state.status,
      };
    case 'loaded': {
      const session = action.bootstrap.session;
      // A challenge survives a refresh only while its session is still the open one.
      const challenge =
        state.challenge && session && state.challenge.sessionId === session.sessionId
          ? state.challenge
          : null;
      return {
        ...state,
        status: 'ready',
        busy: null,
        bootstrap: action.bootstrap,
        session,
        challenge,
      };
    }
    case 'sessionChanged': {
      const open = action.session.status === 'ACTIVE' || action.session.status === 'PAUSED';
      return {
        ...state,
        busy: null,
        session: open ? action.session : null,
        challenge: open ? state.challenge : null,
      };
    }
    case 'questAccepted': {
      if (!state.bootstrap) return { ...state, busy: null };
      const quests = state.bootstrap.quests.some((q) => q.questId === action.quest.questId)
        ? state.bootstrap.quests.map((q) => (q.questId === action.quest.questId ? action.quest : q))
        : [...state.bootstrap.quests, action.quest];
      return { ...state, busy: null, bootstrap: { ...state.bootstrap, quests } };
    }
    case 'challengeIssued':
      return { ...state, busy: null, challenge: action.challenge };
    case 'answerAccepted': {
      const known = new Set(state.rewards.map((item) => item.itemId));
      const fresh = action.outcome.newItems.filter((item) => !known.has(item.itemId));
      return {
        ...state,
        busy: null,
        // Answered either way: a retry asks the server for the next attempt.
        challenge: null,
        lastOutcome: action.outcome,
        rewards: [...state.rewards, ...fresh],
      };
    }
    case 'challengeCleared':
      return { ...state, busy: null, challenge: null };
  }
}
