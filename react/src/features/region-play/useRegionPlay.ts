import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { ApiError, isApiError } from '../../api/errors';
import { playApiFor, type PlayApi } from '../../api/play/playApi';
import type { JsonObject } from '../../api/parse';
import type { AnswerSubmission, PuzzleOutcome, SessionAction } from '../../api/play/types';
import type { PlayOutcome } from '../npc-manager/dialogue/triggers';
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
  /**
   * Every play API outcome this hook receives for the current child and region, as it arrives
   * (LAI-NPC-016: NPC triggers and reactions). Observation only: it cannot change what the hook
   * sends or stores, so rewards and progress stay exactly as the server said.
   */
  onOutcome?: (outcome: PlayOutcome) => void;
}

export interface RegionPlayControls {
  state: RegionPlayState;
  startSession: () => Promise<void>;
  changeSession: (action: SessionAction) => Promise<void>;
  acceptQuest: (questId: string) => Promise<void>;
  requestChallenge: (chestEntityId: string) => Promise<void>;
  submitAnswer: (submission: AnswerSubmission) => Promise<void>;
  /** One attempt at a 3D Area puzzle; the server grades it, then the region is re-read. */
  solvePuzzle: (puzzleId: string, submission: JsonObject) => Promise<PuzzleOutcome | undefined>;
  /** Pick up a collectible (TR-14); the region is re-read after. */
  collectPickup: (entityId: string) => Promise<void>;
  /** Tell the server the child talked to an NPC (TR-14); the region is re-read after. */
  talkToNpc: (entityId: string) => Promise<void>;
  refresh: () => Promise<void>;
}

const REFRESH_ON_CONFLICT = new Set([
  'attempt_already_answered',
  'chest_already_open',
  'chest_locked',
  'session_not_open',
  'content_unavailable',
  'puzzle_locked',
]);

export function useRegionPlay(
  childId: string,
  regionId: string,
  options: UseRegionPlayOptions = {},
): RegionPlayControls {
  const { createApi = playApiFor, onUnauthenticated, onOutcome } = options;
  const scope = scopeKey(childId, regionId);
  const [state, dispatch] = useReducer(regionPlayReducer, scope, initialRegionPlayState);
  const api = useMemo(() => createApi(childId), [createApi, childId]);

  const controllerRef = useRef<AbortController>(new AbortController());
  const scopeRef = useRef(scope);
  const busyRef = useRef<PlayActionName | null>(null);
  // Read by event handlers, which run after commit; synced in an effect, not during render.
  const stateRef = useRef(state);
  const onUnauthenticatedRef = useRef(onUnauthenticated);
  const onOutcomeRef = useRef(onOutcome);
  useEffect(() => {
    stateRef.current = state;
    onUnauthenticatedRef.current = onUnauthenticated;
    onOutcomeRef.current = onOutcome;
  });
  /** Reports an outcome for the scope it was asked in; one for an older scope is dropped. */
  const report = useCallback((at: string, outcome: PlayOutcome) => {
    if (at !== scopeRef.current) return;
    try {
      onOutcomeRef.current?.(outcome);
    } catch {
      // An observer never breaks play.
    }
  }, []);

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
      (bootstrap) => {
        dispatch({ scope, type: 'loaded', bootstrap });
        // Entering with the session still open is a resume, exactly as a start that returned
        // the existing session (`created: false`) would be; no start call is made in that case,
        // so observers would otherwise never hear of the return visit (QA-D3).
        if (bootstrap.session) {
          report(scope, {
            kind: 'session_upserted',
            result: { value: bootstrap.session, created: false },
          });
        }
      },
      (caught: unknown) => {
        const error = isApiError(caught) ? caught : new ApiError('invalid_response');
        if (error.kind === 'aborted' || controller.signal.aborted) return;
        dispatch({ scope, type: 'failed', action: 'load', error });
        if (error.kind === 'unauthenticated') onUnauthenticatedRef.current?.();
      },
    );
    return () => controller.abort();
  }, [api, regionId, scope, report]);

  const startSession = useCallback(async () => {
    const startedScope = scopeRef.current;
    const result = await run(
      'startSession',
      (signal) => api.startSession(regionId, signal),
      (started, at) => {
        report(at, { kind: 'session_upserted', result: started });
        return [{ scope: at, type: 'sessionChanged', session: started.value }];
      },
    );
    // A new visit pins the content it starts with (LAI-0813): read it back, so what the child
    // sees is exactly what the server grades against.
    if (result?.created) await reload(startedScope);
  }, [api, regionId, run, reload, report]);

  const changeSession = useCallback(
    async (action: SessionAction) => {
      const session = stateRef.current.session;
      if (!session) return;
      await run(
        'changeSession',
        (signal) => api.changeSession(session.sessionId, action, signal),
        (updated, at) => {
          report(at, { kind: 'session_changed', session: updated });
          return [{ scope: at, type: 'sessionChanged', session: updated }];
        },
      );
    },
    [api, run, report],
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
        (result, at) => {
          report(at, { kind: 'challenge_issued', result });
          return [{ scope: at, type: 'challengeIssued', challenge: result.value }];
        },
      );
    },
    [api, run, report],
  );

  const submitAnswer = useCallback(
    async (submission: AnswerSubmission) => {
      const challenge = stateRef.current.challenge;
      if (!challenge) return;
      const startedScope = scopeRef.current;
      const outcome = await run(
        'submitAnswer',
        (signal) => api.submitAnswer(challenge.attemptId, submission, signal),
        (result, at) => {
          report(at, { kind: 'answer', outcome: result });
          return [{ scope: at, type: 'answerAccepted', outcome: result }];
        },
      );
      if (outcome) await reload(startedScope);
    },
    [api, run, reload, report],
  );

  const solvePuzzle = useCallback(
    async (puzzleId: string, submission: JsonObject) => {
      const session = stateRef.current.session;
      if (!session) return undefined;
      const startedScope = scopeRef.current;
      const outcome = await run(
        'solvePuzzle',
        (signal) => api.solvePuzzle(session.sessionId, puzzleId, submission, signal),
        (result, at) => [{ scope: at, type: 'puzzleGraded', puzzleId, outcome: result }],
      );
      if (outcome) await reload(startedScope);
      return outcome;
    },
    [api, run, reload],
  );

  const collectPickup = useCallback(
    async (entityId: string) => {
      const session = stateRef.current.session;
      if (!session) return;
      const startedScope = scopeRef.current;
      const result = await run(
        'collectPickup',
        (signal) => api.collectPickup(session.sessionId, entityId, signal),
        (picked, at) => {
          report(at, { kind: 'pickup', outcome: picked.value });
          return [{ scope: at, type: 'pickedUp', outcome: picked.value }];
        },
      );
      if (result) await reload(startedScope);
    },
    [api, run, reload, report],
  );

  const talkToNpc = useCallback(
    async (entityId: string) => {
      const session = stateRef.current.session;
      if (!session) return;
      const startedScope = scopeRef.current;
      const result = await run(
        'talkToNpc',
        (signal) => api.talkToNpc(session.sessionId, entityId, signal),
        (outcome, at) => {
          report(at, { kind: 'talk', outcome });
          return [{ scope: at, type: 'talked', outcome }];
        },
        // Talking never blocks: Pip's dialogue is usable while it is on its way.
        { exclusive: false },
      );
      if (result && result.questUpdates.length > 0) await reload(startedScope);
    },
    [api, run, reload, report],
  );

  const refresh = useCallback(async () => {
    await run(
      'refresh',
      (signal) => api.getRegion(regionId, signal),
      (bootstrap, at) => [{ scope: at, type: 'loaded', bootstrap }],
      { exclusive: false },
    );
  }, [api, regionId, run]);

  return {
    state,
    startSession,
    changeSession,
    acceptQuest,
    requestChallenge,
    submitAnswer,
    solvePuzzle,
    collectPickup,
    talkToNpc,
    refresh,
  };
}
