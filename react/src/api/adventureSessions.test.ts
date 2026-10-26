import { describe, expect, it, vi } from 'vitest';

const catalog = vi.hoisted(() => ({ assertAdventureAvailable: vi.fn() }));
vi.mock('../features/catalog/availabilityApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../features/catalog/availabilityApi')>()),
  assertAdventureAvailable: catalog.assertAdventureAvailable,
}));
const amplify = vi.hoisted(() => ({ getActiveSession: vi.fn(), startSession: vi.fn() }));
vi.mock('./amplify/adventures', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./amplify/adventures')>()),
  ...amplify,
}));
vi.mock('../lib/data-client', () => ({ client: { models: {}, mutations: {} } }));

import { AdventureUnavailableError } from '../features/catalog/availabilityApi';
import type { AdventureDefinition } from '../features/adventures/engine/types';
import { adventuresApi, createDjangoAdventures, type AdventuresApi } from './adventures';
import { selectApi } from './select';
import { djangoTestClient } from '../test/apiFixtures';
import { CHILD_A, SESSION_ID, errorJson, jsonResponse } from '../test/playFixtures';

const DEFINITION = {
  slug: 'repair-the-moonlight-bridge',
  version: 1,
  entryStepId: 'inspect-bridge',
} as AdventureDefinition;
const BASE = `https://lai.example/api/v1/children/${CHILD_A}/adventures/repair-the-moonlight-bridge/`;
const CONTEXT = { childProfileId: CHILD_A, adventureSlug: 'repair-the-moonlight-bridge' };

function viewJson(overrides: Record<string, unknown> = {}) {
  return {
    session: {
      id: SESSION_ID,
      childId: CHILD_A,
      adventureSlug: 'repair-the-moonlight-bridge',
      templateVersion: 1,
      status: 'ACTIVE',
      currentStepId: 'inspect-bridge',
      hintLevel: 0,
      startedAt: '2026-10-26T10:00:00+00:00',
      lastActivityAt: '2026-10-26T10:00:00+00:00',
      completedAt: null,
      ...overrides,
    },
    step: { stepId: 'inspect-bridge', type: 'NARRATIVE', objectiveIds: [], presentation: {} },
    progress: { completedStepIds: [] },
    contentCurrent: true,
    allowedActions: ['ANSWER', 'HINT'],
    canComplete: false,
  };
}

function django(...responses: Array<Response | Error>) {
  const harness = djangoTestClient(...responses);
  return { ...harness, api: createDjangoAdventures(harness.client) as Required<AdventuresApi> };
}

const EXPECTED_SESSION = {
  id: SESSION_ID,
  childProfileId: CHILD_A,
  templateSlug: 'repair-the-moonlight-bridge',
  templateVersion: 1,
  status: 'ACTIVE',
  currentStepId: 'inspect-bridge',
  startedAt: '2026-10-26T10:00:00+00:00',
  lastActivityAt: '2026-10-26T10:00:00+00:00',
  completedAt: null,
};

describe('Django step-adventure sessions (LAI-0608)', () => {
  it('starts with an empty POST to the adventure’s sessions route', async () => {
    const { api, call } = django(jsonResponse(201, viewJson()));
    await expect(api.resumeOrStartSession(CHILD_A, DEFINITION)).resolves.toEqual(EXPECTED_SESSION);
    expect(call()).toMatchObject({ url: `${BASE}sessions/`, method: 'POST', body: {} });
  });

  it('resumes: a 200 is the same session, not a new one', async () => {
    const { api } = django(jsonResponse(200, viewJson({ currentStepId: 'count-planks' })));
    await expect(api.resumeOrStartSession(CHILD_A, DEFINITION)).resolves.toMatchObject({
      id: SESSION_ID,
      currentStepId: 'count-planks',
    });
  });

  it('shows a refused start with the calm catalog message', async () => {
    for (const code of ['adventure_unavailable', 'child_inactive', 'content_version_changed']) {
      const { api } = django(jsonResponse(409, errorJson(code)));
      await expect(api.resumeOrStartSession(CHILD_A, DEFINITION)).rejects.toBeInstanceOf(
        AdventureUnavailableError,
      );
    }
    const { api } = django(jsonResponse(404, errorJson('not_found')));
    await expect(api.resumeOrStartSession(CHILD_A, DEFINITION)).rejects.toBeInstanceOf(
      AdventureUnavailableError,
    );
  });

  it('keeps other failures typed (network, unauthenticated)', async () => {
    const { api } = django(new TypeError('Failed to fetch'));
    await expect(api.resumeOrStartSession(CHILD_A, DEFINITION)).rejects.toMatchObject({
      kind: 'network',
    });
    const second = django(
      jsonResponse(401, errorJson('authentication_failed')),
      jsonResponse(401, errorJson('authentication_failed')),
    );
    await expect(second.api.resumeOrStartSession(CHILD_A, DEFINITION)).rejects.toMatchObject({
      kind: 'unauthenticated',
    });
  });

  it('reads a session through its adventure, null when it is not this child’s', async () => {
    const { api, call } = django(
      jsonResponse(200, viewJson()),
      jsonResponse(404, errorJson('not_found')),
    );
    await expect(api.getSession(SESSION_ID, CONTEXT)).resolves.toEqual(EXPECTED_SESSION);
    expect(call()).toMatchObject({ url: `${BASE}sessions/${SESSION_ID}/`, method: 'GET' });
    await expect(api.getSession(SESSION_ID, CONTEXT)).resolves.toBeNull();
  });

  it('finds the active session from availability, then reads it', async () => {
    const { api, call } = django(
      jsonResponse(200, {
        adventureId: 'repair-the-moonlight-bridge',
        available: true,
        reasons: [],
        status: 'IN_PROGRESS',
        resumeSessionId: SESSION_ID,
      }),
      jsonResponse(200, viewJson()),
    );
    await expect(api.getActiveSession(CHILD_A, 'repair-the-moonlight-bridge')).resolves.toEqual(
      EXPECTED_SESSION,
    );
    expect(call(0).url).toBe(`${BASE}availability/`);
    expect(call(1).url).toBe(`${BASE}sessions/${SESSION_ID}/`);
  });

  it('has no active session when there is none to resume, or the adventure is not visible', async () => {
    const { api, fetch } = django(
      jsonResponse(200, { available: true, reasons: [], status: 'AVAILABLE', resumeSessionId: null }),
      jsonResponse(404, errorJson('not_found')),
    );
    await expect(api.getActiveSession(CHILD_A, 'x')).resolves.toBeNull();
    await expect(api.getActiveSession(CHILD_A, 'x')).resolves.toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('completes with an empty POST; the server refuses an early finish', async () => {
    const { api, call } = django(
      jsonResponse(200, viewJson({ status: 'COMPLETED', completedAt: '2026-10-26T10:05:00+00:00' })),
      jsonResponse(409, errorJson('session_not_complete')),
    );
    await expect(api.completeSession(SESSION_ID, CONTEXT)).resolves.toMatchObject({
      status: 'COMPLETED',
    });
    expect(call()).toMatchObject({ url: `${BASE}sessions/${SESSION_ID}/complete/`, method: 'POST' });
    await expect(api.completeSession(SESSION_ID, CONTEXT)).rejects.toMatchObject({
      kind: 'conflict',
      code: 'session_not_complete',
    });
  });

  it('refuses to complete without knowing the child and adventure', async () => {
    const { api, fetch } = django();
    await expect(api.completeSession(SESSION_ID)).rejects.toMatchObject({
      code: 'session_context_missing',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects a session body off the contract', async () => {
    const { api } = django(jsonResponse(201, viewJson({ status: 'DONE' })));
    await expect(api.resumeOrStartSession(CHILD_A, DEFINITION)).rejects.toMatchObject({
      kind: 'invalid_response',
    });
  });
});

describe('selection and Amplify compatibility', () => {
  it('never starts a session from the client alone on Django, and never falls back', async () => {
    const api = selectApi<AdventuresApi>(
      'adventures',
      {
        amplify: { ...adventuresApi },
        django: (client) => createDjangoAdventures(client),
      },
      { backend: 'django', baseUrl: 'https://lai.example' },
    );
    await expect(api.startSession(CHILD_A, 'slug', 1, 'step')).rejects.toMatchObject({
      kind: 'unsupported',
    });
    await expect(api.advanceSession(SESSION_ID, 'next')).rejects.toMatchObject({
      kind: 'unsupported',
    });
    expect(amplify.startSession).not.toHaveBeenCalled();
  });

  it('keeps the Amplify start path: catalog gate, then resume or start', async () => {
    amplify.getActiveSession.mockResolvedValueOnce(null);
    amplify.startSession.mockResolvedValueOnce({ id: 'amplify-session' });
    await expect(adventuresApi.resumeOrStartSession(CHILD_A, DEFINITION)).resolves.toEqual({
      id: 'amplify-session',
    });
    expect(catalog.assertAdventureAvailable).toHaveBeenCalledWith(DEFINITION);
    expect(amplify.startSession).toHaveBeenCalledWith(
      CHILD_A,
      'repair-the-moonlight-bridge',
      1,
      'inspect-bridge',
    );
  });
});
