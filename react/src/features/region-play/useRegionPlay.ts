import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { ApiError, isApiError } from '../../api/errors';
import { playApiFor, type PlayApi } from '../../api/play/playApi';
import type { AnswerSubmission, SessionAction } from '../../api/play/types';
import {
  initialRegionPlayState,
  regionPlayReducer,
  scopeKey,
  type PlayActionName,
  type RegionPlayAction,
  type RegionPlayState,
} from './regionPlayState';

/**
 * Plays one region as one child against the Django play API (TR-6).
 *
 * Loads the region on mount and whenever `childId` or `regionId` changes.
 * A change aborts every request still in flight and resets the state, and
 * the reducer drops any reply addressed to the old child (see
 * `regionPlayState.ts`), so one child's data can never appear on another's
 * screen.
 *
 * After anything that can change the world (an answer, a conflict) the hook
 * re-reads the region from the server rather than patching it locally.
 *
 * Errors land in `state.error`. `unauthenticated` (a 401 that survived one
 * token refresh) also calls `onUnauthenticated`, which the app wires to
 * `AuthContext.refresh()` so `RequireParent` sends the parent to sign in, as
 * everywhere else. A conflict that means "your view is out of date"
 * (`attempt_already_answered`, `chest_already_open`, `session_not_open`,
 * `content_unavailable`) also triggers a re-read.
 */

export interface UseRegionPlayOptions {
  /** For tests and future callers; defaults to the configured Django API. */
  createApi?: (childId: string) => PlayApi;
  onUnauthenticated?: () => void;
}

export interface RegionPlayControls {
  state: RegionPlayState;
  startSession: () => Promise<void>;
  changeSession: (action: SessionAction) => Promise<void>;
  acceptQuest: (questId: string) => Promise<void>;
  requestChallenge: (chestEntityId: string) => Promise<void>;
  submitAnswer: (submission: AnswerSubmission) => Promise<void>;
  refresh: () => Promise<void>;
}

const REFRESH_ON_CONFLICT = new Set([
  'attempt_already_answered',
  'chest_already_open',
  'session_not_open',
  'content_unavailable',
]);

export function useRegionPlay(
  childId: string,
  regionId: string,
  options: UseRegionPlayOptions = {},
): RegionPlayControls {
  const { createApi = playApiFor, onUnauthenticated } = options;
  const scope = scopeKey(childId, regionId);
  const [state, dispatch] = useReducer(regionPlayReducer, scope, initialRegionPlayState);
  const api = useMemo(() => createApi(childId), [createApi, childId]);

  const controllerRef = useRef<AbortController>(new AbortController());
  const scopeRef = useRef(scope);
  const busyRef = useRef<PlayActionName | null>(null);
  // Read by event handlers, which run after commit; synced in an effect, not during render.
  const stateRef = useRef(state);
  const onUnauthenticatedRef = useRef(onUnauthenticated);
  useEffect(() => {
    stateRef.current = state;
    onUnauthenticatedRef.current = onUnauthenticated;
  });

  const reload = useCallback(
    async (forScope: string) => {
      if (forScope !== scopeRef.current) return;
      const signal = controllerRef.current.signal;
      try {
        const bootstrap = await api.getRegion(regionId, signal);
        dispatch({ scope: forScope, type: 'loaded', bootstrap });
      } catch (caught) {
        if (isApiError(caught) && caught.kind !== 'aborted' && forScope === scopeRef.current) {
          dispatch({ scope: forScope, type: 'failed', action: 'refresh', error: caught });
        }
      }
    },
    [api, regionId],
  );

  /** Runs one API call for the current scope; replies for an older scope are dropped. */
  const run = useCallback(
    async function run<T>(
      name: PlayActionName,
      call: (signal: AbortSignal) => Promise<T>,
      onSuccess: (value: T, scope: string) => RegionPlayAction[],
      options: { exclusive?: boolean } = {},
    ): Promise<T | undefined> {
      const exclusive = options.exclusive ?? true;
      if (exclusive && busyRef.current) return undefined; // a double tap sends nothing
      const startedScope = scopeRef.current;
      const signal = controllerRef.current.signal;
      if (exclusive) busyRef.current = name;
      dispatch({ scope: startedScope, type: 'started', action: name });
      try {
        const value = await call(signal);
        for (const action of onSuccess(value, startedScope)) dispatch(action);
        return value;
      } catch (caught) {
        const error = isApiError(caught) ? caught : new ApiError('invalid_response');
        if (error.kind === 'aborted' || startedScope !== scopeRef.current) return undefined;
        dispatch({ scope: startedScope, type: 'failed', action: name, error });
        if (error.kind === 'unauthenticated') onUnauthenticatedRef.current?.();
        if (error.kind === 'conflict' && REFRESH_ON_CONFLICT.has(error.code)) {
          dispatch({ scope: startedScope, type: 'challengeCleared' });
          void reload(startedScope);
        }
        return undefined;
      } finally {
        if (exclusive && busyRef.current === name) busyRef.current = null;
      }
    },
    [reload],
  );

  useEffect(() => {
    const controller = new AbortController();
    controllerRef.current = controller;
    scopeRef.current = scope;
    busyRef.current = null;
    dispatch({ scope, type: 'reset' });
    dispatch({ scope, type: 'started', action: 'load' });
    api.getRegion(regionId, controller.signal).then(
      (bootstrap) => dispatch({ scope, type: 'loaded', bootstrap }),
      (caught: unknown) => {
        const error = isApiError(caught) ? caught : new ApiError('invalid_response');
        if (error.kind === 'aborted' || controller.signal.aborted) return;
        dispatch({ scope, type: 'failed', action: 'load', error });
        if (error.kind === 'unauthenticated') onUnauthenticatedRef.current?.();
      },
    );
    return () => controller.abort();
  }, [api, regionId, scope]);

  const startSession = useCallback(async () => {
    await run(
      'startSession',
      (signal) => api.startSession(regionId, signal),
      (result, at) => [{ scope: at, type: 'sessionChanged', session: result.value }],
    );
  }, [api, regionId, run]);

  const changeSession = useCallback(
    async (action: SessionAction) => {
      const session = stateRef.current.session;
      if (!session) return;
      await run(
        'changeSession',
        (signal) => api.changeSession(session.sessionId, action, signal),
        (updated, at) => [{ scope: at, type: 'sessionChanged', session: updated }],
      );
    },
    [api, run],
  );

  const acceptQuest = useCallback(
    async (questId: string) => {
      await run(
        'acceptQuest',
        (signal) => api.acceptQuest(questId, signal),
        (result, at) => [{ scope: at, type: 'questAccepted', quest: result.value }],
      );
    },
    [api, run],
  );

  const requestChallenge = useCallback(
    async (chestEntityId: string) => {
      const session = stateRef.current.session;
      if (!session) return;
      await run(
        'requestChallenge',
        (signal) => api.requestChestChallenge(session.sessionId, chestEntityId, signal),
        (result, at) => [{ scope: at, type: 'challengeIssued', challenge: result.value }],
      );
    },
    [api, run],
  );

  const submitAnswer = useCallback(
    async (submission: AnswerSubmission) => {
      const challenge = stateRef.current.challenge;
      if (!challenge) return;
      const startedScope = scopeRef.current;
      const outcome = await run(
        'submitAnswer',
        (signal) => api.submitAnswer(challenge.attemptId, submission, signal),
        (result, at) => [{ scope: at, type: 'answerAccepted', outcome: result }],
      );
      if (outcome) await reload(startedScope);
    },
    [api, run, reload],
  );

  const refresh = useCallback(async () => {
    await run(
      'refresh',
      (signal) => api.getRegion(regionId, signal),
      (bootstrap, at) => [{ scope: at, type: 'loaded', bootstrap }],
      { exclusive: false },
    );
  }, [api, regionId, run]);

  return { state, startSession, changeSession, acceptQuest, requestChallenge, submitAnswer, refresh };
}
