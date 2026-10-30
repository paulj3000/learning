import { createApiClient } from '../client';
import { ApiError } from '../errors';
import { createPlayApi, playApiFor } from './playApi';
import type { AnswerSubmission } from './types';
import {
  ATTEMPT_ID,
  CHILD_A,
  SESSION_ID,
  bootstrapJson,
  challengeJson,
  errorJson,
  jsonResponse,
  outcomeJson,
  progressJson,
  questJson,
  sessionJson,
} from '../../test/playFixtures';

function setup(...responses: Response[]) {
  const fetch = vi.fn<typeof globalThis.fetch>();
  for (const response of responses) fetch.mockResolvedValueOnce(response);
  const client = createApiClient({ baseUrl: '', getAccessToken: async () => 'tok', fetch });
  return { api: createPlayApi(client, CHILD_A), fetch };
}

function sent(fetch: ReturnType<typeof setup>['fetch'], index = 0) {
  const [url, init] = fetch.mock.calls[index];
  return {
    url,
    method: init?.method,
    body: init?.body ? JSON.parse(init.body as string) : undefined,
  };
}

const child = `/api/v1/children/${CHILD_A}/`;

describe('play API requests', () => {
  it('reads the region bootstrap', async () => {
    const { api, fetch } = setup(jsonResponse(200, bootstrapJson()));
    const region = await api.getRegion('treasure-rush-cove');
    expect(sent(fetch)).toEqual({
      url: `${child}regions/treasure-rush-cove/`,
      method: 'GET',
      body: undefined,
    });
    expect(region.chests[0]).toMatchObject({
      entityId: 'cove-chest',
      isOpen: false,
      challengeAvailable: true,
    });
    expect(region.npcs[0].npcId).toBe('pirate-pip');
    expect(region.objects[0].kind).toBe('SCENERY');
    expect(region.spawn?.checkpointId).toBe('cove-landing');
    expect(region.quests[0].status).toBe('AVAILABLE');
  });

  it('starts a session and tells created from resumed', async () => {
    const { api, fetch } = setup(
      jsonResponse(201, sessionJson()),
      jsonResponse(200, sessionJson()),
    );
    expect((await api.startSession('treasure-rush-cove')).created).toBe(true);
    expect((await api.startSession('treasure-rush-cove')).created).toBe(false);
    expect(sent(fetch)).toEqual({
      url: `${child}regions/treasure-rush-cove/session/`,
      method: 'POST',
      body: {},
    });
  });

  it('reads a session and changes its status', async () => {
    const { api, fetch } = setup(
      jsonResponse(200, sessionJson()),
      jsonResponse(200, sessionJson({ status: 'PAUSED' })),
    );
    await api.getSession(SESSION_ID);
    const paused = await api.changeSession(SESSION_ID, 'pause');
    expect(paused.status).toBe('PAUSED');
    expect(sent(fetch, 0).url).toBe(`${child}sessions/${SESSION_ID}/`);
    expect(sent(fetch, 1)).toEqual({
      url: `${child}sessions/${SESSION_ID}/pause/`,
      method: 'POST',
      body: {},
    });
  });

  it('refuses an action the API does not have, without calling it', async () => {
    const { api, fetch } = setup();
    await expect(api.changeSession(SESSION_ID, 'explode' as never)).rejects.toMatchObject({
      kind: 'invalid_request',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('accepts a quest', async () => {
    const { api, fetch } = setup(
      jsonResponse(201, questJson({ status: 'ACTIVE', currentStageId: 'open-the-chest' })),
    );
    const accepted = await api.acceptQuest('treasure-rush-cove');
    expect(accepted).toMatchObject({ created: true, value: { status: 'ACTIVE' } });
    expect(sent(fetch).url).toBe(`${child}quests/treasure-rush-cove/accept/`);
  });

  it('requests a chest challenge, which has no answer', async () => {
    const { api, fetch } = setup(jsonResponse(201, challengeJson()));
    const { value } = await api.requestChestChallenge(SESSION_ID, 'cove-chest');
    expect(sent(fetch).url).toBe(`${child}sessions/${SESSION_ID}/chests/cove-chest/challenge/`);
    expect(value.challenge).toEqual({
      skillId: 'addition-within-ten',
      operation: 'ADD',
      operands: [2, 3],
      responseMode: 'CHOICE',
      choices: [3, 4, 5, 6],
    });
    expect(JSON.stringify(value)).not.toContain('"answer"');
  });

  it('submits only the accepted answer fields', async () => {
    const { api, fetch } = setup(jsonResponse(200, outcomeJson(true)));
    const submission = {
      answer: 5,
      hintLevel: 1,
      durationMs: 8400,
      correct: true,
    } as AnswerSubmission;
    const outcome = await api.submitAnswer(ATTEMPT_ID, submission);
    expect(sent(fetch)).toEqual({
      url: `${child}attempts/${ATTEMPT_ID}/answer/`,
      method: 'POST',
      body: { answer: 5, hintLevel: 1, durationMs: 8400 },
    });
    expect(outcome.correct).toBe(true);
    expect(outcome.newItems.map((item) => item.itemId)).toEqual(['golden-doubloon']);
    expect(outcome.questUpdates[0]).toMatchObject({ status: 'COMPLETED', justCompleted: true });
  });

  it('never sends a non-integer answer', async () => {
    const { api, fetch } = setup();
    await expect(api.submitAnswer(ATTEMPT_ID, { answer: 4.5 })).rejects.toMatchObject({
      kind: 'invalid_request',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reads progress', async () => {
    const { api, fetch } = setup(jsonResponse(200, progressJson()));
    const progress = await api.getProgress();
    expect(sent(fetch).url).toBe(`${child}progress/`);
    expect(progress.openedChests).toEqual([
      { regionId: 'treasure-rush-cove', entityId: 'cove-chest' },
    ]);
    expect(progress.inventory[0].item.category).toBe('KEEPSAKE');
    expect(progress.practice).toEqual([
      { objectiveCode: 'addition-within-ten', attempts: 2, correct: 1 },
    ]);
  });

  it('encodes ids so one cannot change the route', async () => {
    const { api, fetch } = setup(jsonResponse(200, bootstrapJson()));
    await api.getRegion('../progress');
    expect(sent(fetch).url).toBe(`${child}regions/..%2Fprogress/`);
    await expect(api.getRegion('')).rejects.toMatchObject({ code: 'empty_id' });
  });

  it('turns gameplay conflicts into typed errors', async () => {
    const { api } = setup(jsonResponse(409, errorJson('attempt_already_answered')));
    const error = await api.submitAnswer(ATTEMPT_ID, { answer: 5 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ kind: 'conflict', code: 'attempt_already_answered' });
  });
});

describe('play API response checking', () => {
  it('rejects a response that breaks the contract, naming where', async () => {
    const broken = bootstrapJson({}, { isOpen: 'yes' });
    const { api } = setup(jsonResponse(200, broken));
    await expect(api.getRegion('treasure-rush-cove')).rejects.toMatchObject({
      kind: 'invalid_response',
      code: 'expected boolean at $.chests[0].isOpen',
    });
  });

  it('rejects an unknown status value', async () => {
    const { api } = setup(jsonResponse(200, sessionJson({ status: 'WON' })));
    await expect(api.getSession(SESSION_ID)).rejects.toMatchObject({ kind: 'invalid_response' });
  });

  it('rejects a float where the contract has an integer', async () => {
    const { api } = setup(jsonResponse(201, challengeJson({ attemptNumber: 1.5 })));
    await expect(api.requestChestChallenge(SESSION_ID, 'cove-chest')).rejects.toMatchObject({
      kind: 'invalid_response',
    });
  });
});

describe('playApiFor', () => {
  it('fails every call as disabled when the build has no Django API', async () => {
    const api = playApiFor(CHILD_A, { enabled: false });
    await expect(api.getRegion('treasure-rush-cove')).rejects.toMatchObject({ kind: 'disabled' });
    await expect(api.submitAnswer(ATTEMPT_ID, { answer: 1 })).rejects.toMatchObject({
      kind: 'disabled',
    });
  });
});
