import { ApiError } from '../../api/errors';
import { read } from '../../api/parse';
import * as parse from '../../api/play/parse';
import {
  CHILD_A,
  CHILD_B,
  bootstrapJson,
  challengeJson,
  outcomeJson,
  questJson,
  sessionJson,
} from '../../test/playFixtures';
import {
  initialRegionPlayState,
  regionPlayReducer,
  scopeKey,
  type RegionPlayState,
} from './regionPlayState';

const A = scopeKey(CHILD_A, 'treasure-rush-cove');
const B = scopeKey(CHILD_B, 'treasure-rush-cove');
const bootstrap = (overrides = {}) => read(bootstrapJson(overrides), parse.regionBootstrap);
const session = (overrides = {}) => read(sessionJson(overrides), parse.session);
const challenge = () => read(challengeJson(), parse.issuedChallenge);
const outcome = (correct: boolean) => read(outcomeJson(correct), parse.answerOutcome);

function ready(): RegionPlayState {
  return regionPlayReducer(initialRegionPlayState(A), {
    scope: A,
    type: 'loaded',
    bootstrap: bootstrap(),
  });
}

describe('regionPlayReducer', () => {
  it('ignores every reply addressed to another child', () => {
    const state = ready();
    const actions = [
      { type: 'loaded', bootstrap: bootstrap({ session: sessionJson() }) },
      { type: 'sessionChanged', session: session() },
      { type: 'challengeIssued', challenge: challenge() },
      { type: 'answerAccepted', outcome: outcome(true) },
      { type: 'failed', action: 'load', error: new ApiError('server') },
    ] as const;
    for (const action of actions) {
      expect(regionPlayReducer(state, { scope: B, ...action })).toBe(state);
    }
  });

  it('resets completely for a new scope', () => {
    const state = regionPlayReducer(ready(), {
      scope: A,
      type: 'answerAccepted',
      outcome: outcome(true),
    });
    expect(regionPlayReducer(state, { scope: B, type: 'reset' })).toEqual(
      initialRegionPlayState(B),
    );
  });

  it('records loading, failure, and readiness', () => {
    let state = regionPlayReducer(initialRegionPlayState(A), {
      scope: A,
      type: 'started',
      action: 'load',
    });
    expect([state.status, state.busy]).toEqual(['loading', 'load']);
    state = regionPlayReducer(state, {
      scope: A,
      type: 'failed',
      action: 'load',
      error: new ApiError('not_found'),
    });
    expect([state.status, state.error?.kind, state.busy]).toEqual(['error', 'not_found', null]);
    state = regionPlayReducer(state, { scope: A, type: 'loaded', bootstrap: bootstrap() });
    expect(state.status).toBe('ready');
  });

  it('keeps the screen when a later action fails', () => {
    const state = regionPlayReducer(ready(), {
      scope: A,
      type: 'failed',
      action: 'submitAnswer',
      error: new ApiError('conflict', { code: 'attempt_already_answered' }),
    });
    expect(state.status).toBe('ready');
    expect([state.errorAction, state.error?.code]).toEqual([
      'submitAnswer',
      'attempt_already_answered',
    ]);
  });

  it('shows rewards only from the server outcome, once each', () => {
    let state = regionPlayReducer(ready(), {
      scope: A,
      type: 'challengeIssued',
      challenge: challenge(),
    });
    state = regionPlayReducer(state, { scope: A, type: 'answerAccepted', outcome: outcome(true) });
    state = regionPlayReducer(state, { scope: A, type: 'answerAccepted', outcome: outcome(true) });
    expect(state.rewards.map((item) => item.itemId)).toEqual(['golden-doubloon']);
    expect(state.challenge).toBeNull();
    expect(state.lastOutcome?.correct).toBe(true);
  });

  it('never marks a chest open or grants anything on a wrong answer', () => {
    const state = regionPlayReducer(ready(), {
      scope: A,
      type: 'answerAccepted',
      outcome: outcome(false),
    });
    expect(state.rewards).toEqual([]);
    expect(state.bootstrap?.chests[0].isOpen).toBe(false);
  });

  it('drops the session and the challenge when the session closes', () => {
    let state = regionPlayReducer(ready(), {
      scope: A,
      type: 'sessionChanged',
      session: session(),
    });
    state = regionPlayReducer(state, { scope: A, type: 'challengeIssued', challenge: challenge() });
    state = regionPlayReducer(state, {
      scope: A,
      type: 'sessionChanged',
      session: session({ status: 'COMPLETED', completedAt: '2026-10-24T19:00:00Z' }),
    });
    expect([state.session, state.challenge]).toEqual([null, null]);
  });

  it('keeps a paused session', () => {
    const state = regionPlayReducer(ready(), {
      scope: A,
      type: 'sessionChanged',
      session: session({ status: 'PAUSED' }),
    });
    expect(state.session?.status).toBe('PAUSED');
  });

  it('keeps an outstanding challenge across a refresh of the same session only', () => {
    let state = regionPlayReducer(ready(), {
      scope: A,
      type: 'challengeIssued',
      challenge: challenge(),
    });
    state = regionPlayReducer(state, {
      scope: A,
      type: 'loaded',
      bootstrap: bootstrap({ session: sessionJson() }),
    });
    expect(state.challenge).not.toBeNull();
    state = regionPlayReducer(state, {
      scope: A,
      type: 'loaded',
      bootstrap: bootstrap({ session: null }),
    });
    expect(state.challenge).toBeNull();
  });

  it('replaces an accepted quest in place', () => {
    const accepted = read(
      questJson({ status: 'ACTIVE', currentStageId: 'open-the-chest' }),
      parse.quest,
    );
    const state = regionPlayReducer(ready(), { scope: A, type: 'questAccepted', quest: accepted });
    expect(state.bootstrap?.quests).toHaveLength(1);
    expect(state.bootstrap?.quests[0].status).toBe('ACTIVE');
  });
});
