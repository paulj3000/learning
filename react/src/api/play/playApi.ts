import { djangoClient } from '../backend';
import type { ApiClient } from '../client';
import { DJANGO_API_CONFIG, type DjangoApiConfig } from '../config';
import { ApiError } from '../errors';
import { read, type Reader } from '../parse';
import * as parse from './parse';
import type {
  AnswerOutcome,
  AnswerSubmission,
  IssuedChallenge,
  PlayerProgress,
  PlaySession,
  QuestEntry,
  RegionBootstrap,
  SessionAction,
  Upserted,
} from './types';

/**
 * Typed functions for every play API route (docs/PLAY_API.md), all scoped to
 * one child. The child id is the one the route selected (`/island/:childId`);
 * the server resolves it through the signed-in parent, so a stale or foreign
 * id is a 404, never another family's data.
 *
 * Nothing here decides an outcome. Bodies carry only what the contract
 * accepts (an answer, hints used, duration); correctness, rewards, and world
 * changes come back from the server.
 */

export interface PlayApi {
  getRegion(regionId: string, signal?: AbortSignal): Promise<RegionBootstrap>;
  startSession(regionId: string, signal?: AbortSignal): Promise<Upserted<PlaySession>>;
  getSession(sessionId: string, signal?: AbortSignal): Promise<PlaySession>;
  changeSession(
    sessionId: string,
    action: SessionAction,
    signal?: AbortSignal,
  ): Promise<PlaySession>;
  acceptQuest(questId: string, signal?: AbortSignal): Promise<Upserted<QuestEntry>>;
  requestChestChallenge(
    sessionId: string,
    chestEntityId: string,
    signal?: AbortSignal,
  ): Promise<Upserted<IssuedChallenge>>;
  submitAnswer(
    attemptId: string,
    submission: AnswerSubmission,
    signal?: AbortSignal,
  ): Promise<AnswerOutcome>;
  getProgress(signal?: AbortSignal): Promise<PlayerProgress>;
}

const SESSION_ACTIONS: readonly SessionAction[] = ['pause', 'resume', 'complete', 'abandon'];

export function createPlayApi(client: ApiClient, childId: string): PlayApi {
  const child = `children/${segment(childId)}/`;

  async function get<T>(path: string, parser: (r: Reader) => T, signal?: AbortSignal): Promise<T> {
    const response = await client.request('GET', `${child}${path}`, { signal });
    return read(response.data, parser);
  }

  async function post<T>(
    path: string,
    parser: (r: Reader) => T,
    body: Record<string, unknown> = {},
    signal?: AbortSignal,
  ): Promise<Upserted<T>> {
    const response = await client.request('POST', `${child}${path}`, { body, signal });
    return { value: read(response.data, parser), created: response.status === 201 };
  }

  return {
    getRegion: async (regionId, signal) =>
      get(`regions/${segment(regionId)}/`, parse.regionBootstrap, signal),
    startSession: async (regionId, signal) =>
      post(`regions/${segment(regionId)}/session/`, parse.session, {}, signal),
    getSession: async (sessionId, signal) =>
      get(`sessions/${segment(sessionId)}/`, parse.session, signal),
    async changeSession(sessionId, action, signal) {
      if (!SESSION_ACTIONS.includes(action))
        throw new ApiError('invalid_request', { code: 'unknown_action' });
      const result = await post(
        `sessions/${segment(sessionId)}/${action}/`,
        parse.session,
        {},
        signal,
      );
      return result.value;
    },
    acceptQuest: async (questId, signal) =>
      post(`quests/${segment(questId)}/accept/`, parse.quest, {}, signal),
    requestChestChallenge: async (sessionId, chestEntityId, signal) =>
      post(
        `sessions/${segment(sessionId)}/chests/${segment(chestEntityId)}/challenge/`,
        parse.issuedChallenge,
        {},
        signal,
      ),
    async submitAnswer(attemptId, submission, signal) {
      if (!Number.isInteger(submission.answer)) {
        throw new ApiError('invalid_request', { code: 'answer_not_integer' });
      }
      // Exactly the accepted fields: the server refuses anything else.
      const body: Record<string, unknown> = { answer: submission.answer };
      if (submission.hintLevel !== undefined) body.hintLevel = submission.hintLevel;
      if (submission.durationMs !== undefined) body.durationMs = submission.durationMs;
      const result = await post(
        `attempts/${segment(attemptId)}/answer/`,
        parse.answerOutcome,
        body,
        signal,
      );
      return result.value;
    },
    getProgress: async (signal) => get('progress/', parse.playerProgress, signal),
  };
}

/** One path segment, encoded, and never empty (an empty id would change the route). */
function segment(id: string): string {
  if (!id) throw new ApiError('invalid_request', { code: 'empty_id' });
  return encodeURIComponent(id);
}

/**
 * The app's play API for a child, or a `disabled` error when this build has
 * no Django API. Uses the shared Django client (LAI-0501B), so play requests
 * get the same token handling and account-provisioning retry as every other
 * Django call.
 */
export function playApiFor(childId: string, config: DjangoApiConfig = DJANGO_API_CONFIG): PlayApi {
  if (!config.enabled) {
    const disabled = () => Promise.reject(new ApiError('disabled'));
    return {
      getRegion: disabled,
      startSession: disabled,
      getSession: disabled,
      changeSession: disabled,
      acceptQuest: disabled,
      requestChestChallenge: disabled,
      submitAnswer: disabled,
      getProgress: disabled,
    };
  }
  return createPlayApi(djangoClient({ backend: 'django', baseUrl: config.baseUrl }), childId);
}
