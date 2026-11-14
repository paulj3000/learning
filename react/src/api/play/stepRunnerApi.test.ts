import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../client';
import { ApiError } from '../errors';
import { createStepRunnerApi } from './stepRunnerApi';
import { jsonResponse } from '../../test/playFixtures';
import { SESSION_ID as SESSION, sessionJson, viewJson } from '../../test/stepRunnerFixtures';

const CHILD = '6f1c0d9e-6a53-4c63-bd7b-0d3a2b1d9c11';

function setup(...responses: Response[]) {
  const fetch = vi.fn<typeof globalThis.fetch>();
  for (const response of responses) fetch.mockResolvedValueOnce(response);
  const client = createApiClient({ baseUrl: '', getAccessToken: async () => 'tok', fetch });
  return { api: createStepRunnerApi(client, CHILD), fetch };
}

function sent(fetch: ReturnType<typeof setup>['fetch'], index = 0) {
  const [url, init] = fetch.mock.calls[index];
  return {
    url,
    method: init?.method,
    body: init?.body ? JSON.parse(init.body as string) : undefined,
  };
}

describe('the Django step runner API (LAI-0816)', () => {
  it('starts an adventure by slug and reads the step, revisions and progress', async () => {
    const { api, fetch } = setup(jsonResponse(201, viewJson()));
    const view = await api.start('mend-bridge');
    expect(sent(fetch)).toMatchObject({
      url: `/api/v1/children/${CHILD}/content/adventures/mend-bridge/start/`,
      method: 'POST',
    });
    expect(view.created).toBe(true);
    expect(view.step).toMatchObject({ id: 'count', hasHints: true });
    expect(view.adventureRevision).toEqual({ id: 'rev-adv', number: 3 });
    expect(view.session.status).toBe('ACTIVE');
  });

  it('reads a finished session whose closing step is shown', async () => {
    const { api } = setup(
      jsonResponse(
        200,
        viewJson({
          session: sessionJson({ status: 'COMPLETED', currentStepId: 'done' }),
          step: {
            id: 'done',
            type: 'COMPLETE',
            objectiveIds: [],
            presentation: { kind: 'complete', text: 'Well done' },
            hasHints: false,
          },
          created: undefined,
        }),
      ),
    );
    const view = await api.getStep(SESSION);
    expect(view.created).toBe(false);
    expect(view.session.status).toBe('COMPLETED');
  });

  it('sends only what the child did: the step, the answer and a request id', async () => {
    const { api, fetch } = setup(
      jsonResponse(200, {
        correctness: 'CORRECT',
        supportLevel: 0,
        action: 'ADVANCE',
        nextStepId: 'mark',
        attemptNumber: 1,
        replayed: false,
        session: sessionJson(),
        worldChangeKeys: ['BRIDGE_MENDED'],
        completion: {
          rewards: [{ ruleId: 'r', message: 'Nice', granted: true, newItemIds: ['badge'] }],
          questsCompleted: ['repair'],
        },
      }),
    );
    const verdict = await api.submitAnswer(
      SESSION,
      'count',
      { kind: 'number-input', value: 3 },
      'req-1',
    );
    expect(sent(fetch).body).toEqual({
      stepId: 'count',
      answer: { kind: 'number-input', value: 3 },
      requestId: 'req-1',
    });
    expect(verdict.correctness).toBe('CORRECT');
    expect(verdict.completion?.rewards[0]).toMatchObject({ granted: true, newItemIds: ['badge'] });
    expect(verdict.worldChangeKeys).toEqual(['BRIDGE_MENDED']);
  });

  it('asks for a hint from the level the child saw', async () => {
    const { api, fetch } = setup(
      jsonResponse(200, { hintLevel: 1, hintText: 'Count again', session: sessionJson() }),
    );
    expect(await api.requestHint(SESSION, 'count', 0)).toEqual({
      hintLevel: 1,
      hintText: 'Count again',
    });
    expect(sent(fetch).body).toEqual({ stepId: 'count', fromLevel: 0 });
  });

  it('refuses a response that does not match the contract', async () => {
    const { api } = setup(jsonResponse(200, viewJson({ step: { id: 'x' } })));
    await expect(api.getStep(SESSION)).rejects.toMatchObject({ kind: 'invalid_response' });
    const bad = setup(
      jsonResponse(200, {
        correctness: 'MAYBE',
        supportLevel: 0,
        action: 'ADVANCE',
        nextStepId: null,
        replayed: false,
        session: sessionJson(),
        worldChangeKeys: [],
        completion: null,
      }),
    );
    await expect(
      bad.api.submitAnswer(SESSION, 'count', { kind: 'reflection' }, 'r'),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it('never puts an id into a path unencoded, or sends an empty one', async () => {
    const { api, fetch } = setup(jsonResponse(201, viewJson()));
    await api.start('a/b');
    expect(sent(fetch).url).toContain('content/adventures/a%2Fb/start/');
    await expect(api.getStep('')).rejects.toMatchObject({ kind: 'invalid_request' });
  });
});
