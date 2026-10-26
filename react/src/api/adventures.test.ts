import { describe, expect, it, vi } from 'vitest';

const amplify = vi.hoisted(() => ({
  submitAdventureAnswer: vi.fn(),
  startSession: vi.fn(),
  recordWorldChangeOnce: vi.fn(),
}));
vi.mock('./amplify/adventures', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./amplify/adventures')>()),
  ...amplify,
}));
vi.mock('../lib/data-client', () => ({ client: { models: {}, mutations: {} } }));

import { createDjangoAdventures, type AdventuresApi } from './adventures';
import { selectApi } from './select';
import { djangoTestClient } from '../test/apiFixtures';
import { CHILD_A, SESSION_ID, errorJson, jsonResponse, progressJson } from '../test/playFixtures';

const ANSWER = { kind: 'number-input', value: 4 } as const;

function answerJson(overrides: Record<string, unknown> = {}) {
  return {
    correctness: 'correct',
    supportLevel: 0,
    action: 'ADVANCE',
    nextStepId: 'step-2',
    attemptNumber: 1,
    replayed: false,
    session: { id: SESSION_ID },
    ...overrides,
  };
}

function django(...responses: Response[]) {
  const harness = djangoTestClient(...responses);
  const api = createDjangoAdventures(harness.client, () => 'request-1') as Required<AdventuresApi>;
  return { ...harness, api };
}

describe('Django step answers (LAI-0601)', () => {
  it('posts only what the child did, with a request id, to the child-scoped route', async () => {
    const { api, call } = django(jsonResponse(200, answerJson()));
    await expect(
      api.submitAdventureAnswer(SESSION_ID, ANSWER, 2, { childProfileId: CHILD_A, stepId: 'step-1' }),
    ).resolves.toEqual({
      correctness: 'correct',
      supportLevel: 0,
      action: 'ADVANCE',
      nextStepId: 'step-2',
    });
    const sent = call();
    expect(sent.url).toBe(
      `https://lai.example/api/v1/children/${CHILD_A}/sessions/${SESSION_ID}/answers/`,
    );
    expect(sent.method).toBe('POST');
    expect(sent.authorization).toBe('Bearer token');
    // No hint level, correctness, next step or reward: the server decides all of them.
    expect(sent.body).toEqual({ stepId: 'step-1', answer: ANSWER, requestId: 'request-1' });
  });

  it('drops the next step on a retry', async () => {
    const { api } = django(
      jsonResponse(200, answerJson({ correctness: 'incorrect', action: 'RETRY', nextStepId: 'x' })),
    );
    await expect(
      api.submitAdventureAnswer(SESSION_ID, ANSWER, 0, { childProfileId: CHILD_A, stepId: 's' }),
    ).resolves.toMatchObject({ action: 'RETRY', nextStepId: null, correctness: 'incorrect' });
  });

  it('refuses to send without the child and step, rather than guessing them', async () => {
    const { api, fetch } = django();
    await expect(api.submitAdventureAnswer(SESSION_ID, ANSWER, 0)).rejects.toMatchObject({
      kind: 'invalid_request',
      code: 'answer_context_missing',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps the server’s conflict code (stale step) and not-found (another family)', async () => {
    const { api } = django(
      jsonResponse(409, errorJson('step_not_current')),
      jsonResponse(404, errorJson('not_found')),
    );
    const context = { childProfileId: CHILD_A, stepId: 's' };
    await expect(api.submitAdventureAnswer(SESSION_ID, ANSWER, 0, context)).rejects.toMatchObject({
      kind: 'conflict',
      code: 'step_not_current',
    });
    await expect(api.submitAdventureAnswer(SESSION_ID, ANSWER, 0, context)).rejects.toMatchObject({
      kind: 'not_found',
    });
  });

  it('reports a refused token as unauthenticated after one refresh', async () => {
    const { api } = django(
      jsonResponse(401, errorJson('authentication_failed')),
      jsonResponse(401, errorJson('authentication_failed')),
    );
    await expect(
      api.submitAdventureAnswer(SESSION_ID, ANSWER, 0, { childProfileId: CHILD_A, stepId: 's' }),
    ).rejects.toMatchObject({ kind: 'unauthenticated' });
  });

  it('rejects an answer response off the contract', async () => {
    const { api } = django(jsonResponse(200, answerJson({ correctness: 'CORRECT' })));
    await expect(
      api.submitAdventureAnswer(SESSION_ID, ANSWER, 0, { childProfileId: CHILD_A, stepId: 's' }),
    ).rejects.toMatchObject({ kind: 'invalid_response' });
  });
});

describe('Django world-change reads', () => {
  it('reads every world change from progress/, keyed by location and change key', async () => {
    const { api, call } = django(jsonResponse(200, progressJson()));
    const changes = await api.listWorldChanges(CHILD_A, 'pirate-builder-bay');
    expect(call().url).toBe(`https://lai.example/api/v1/children/${CHILD_A}/progress/`);
    expect(changes).toEqual([
      expect.objectContaining({
        id: 'pirate-builder-bay:TREASURE_RUSH_COVE_CHEST_OPENED',
        changeKey: 'TREASURE_RUSH_COVE_CHEST_OPENED',
        changeType: 'UNLOCK',
      }),
    ]);
  });

  it('filters by location and sorts newest first', async () => {
    const progress = progressJson();
    progress.worldChanges.push({
      ...progress.worldChanges[0],
      locationSlug: 'wonderwild-forest',
      changeKey: 'LATER',
      createdAt: '2026-10-25T09:00:00Z',
    });
    const { api } = django(jsonResponse(200, progress), jsonResponse(200, progress));
    await expect(api.listWorldChanges(CHILD_A, 'wonderwild-forest')).resolves.toHaveLength(1);
    const all = await api.listAllWorldChanges(CHILD_A);
    expect(all.map((change) => change.changeKey)).toEqual([
      'LATER',
      'TREASURE_RUSH_COVE_CHEST_OPENED',
    ]);
  });
});

describe('adventures area selection', () => {
  const DJANGO = { backend: 'django', baseUrl: 'https://lai.example' } as const;
  const amplifyApi = {
    ...amplify,
  } as unknown as AdventuresApi;

  it('has no Django session start, and never writes world changes from the client', async () => {
    const api = selectApi<AdventuresApi>('adventures', {
      amplify: { ...amplifyApi, getActiveSession: vi.fn(), listSessions: vi.fn() } as AdventuresApi,
      django: (client) => createDjangoAdventures(client),
    }, DJANGO);
    await expect(api.startSession(CHILD_A, 'slug', 1, 'step-1')).rejects.toMatchObject({
      kind: 'unsupported',
      code: 'adventures_unavailable',
    });
    await expect(
      api.recordWorldChangeOnce(CHILD_A, 'pirate-builder-bay', 'UNLOCK', 'KEY', SESSION_ID),
    ).rejects.toMatchObject({ kind: 'unsupported' });
    expect(amplify.startSession).not.toHaveBeenCalled();
    expect(amplify.recordWorldChangeOnce).not.toHaveBeenCalled();
  });

  it('passes the answer straight to the Amplify Lambda on an Amplify build', async () => {
    const { adventuresApi } = await import('./adventures');
    amplify.submitAdventureAnswer.mockResolvedValueOnce({ correctness: 'correct' });
    await adventuresApi.submitAdventureAnswer(SESSION_ID, ANSWER, 1, {
      childProfileId: CHILD_A,
      stepId: 's',
    });
    expect(amplify.submitAdventureAnswer).toHaveBeenCalledWith(SESSION_ID, ANSWER, 1, {
      childProfileId: CHILD_A,
      stepId: 's',
    });
  });
});
