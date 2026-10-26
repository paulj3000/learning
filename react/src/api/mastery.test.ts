import { describe, expect, it, vi } from 'vitest';

const amplify = vi.hoisted(() => ({ listSkillProgress: vi.fn(), upsertSkillProgress: vi.fn() }));
vi.mock('./amplify/mastery', () => amplify);

import { createDjangoMastery, masteryApi, toSkillProgress, type MasteryApi } from './mastery';
import { selectApi } from './select';
import { djangoTestClient } from '../test/apiFixtures';
import { CHILD_A, errorJson, jsonResponse } from '../test/playFixtures';

function entryJson(overrides: Record<string, unknown> = {}) {
  return {
    objectiveId: 'addition-within-ten',
    title: 'Addition within ten',
    domain: 'numeracy',
    hasEvidence: true,
    status: 'PROFICIENT',
    rawStatus: 'MASTERED',
    errorPattern: 'NONE',
    exposureCount: 6,
    independentSuccessCount: 5,
    supportedSuccessCount: 1,
    consecutiveIndependentCorrect: 3,
    lastPracticedAt: '2026-09-20T10:00:00+00:00',
    ...overrides,
  };
}

function django(...responses: Array<Response | Error>) {
  const harness = djangoTestClient(...responses);
  return { ...harness, api: createDjangoMastery(harness.client) as Required<MasteryApi> };
}

describe('Django mastery reads (LAI-0603)', () => {
  it('lists the server’s mastery from the child-scoped route', async () => {
    const { api, call } = django(jsonResponse(200, { objectives: [entryJson()] }));
    const [entry] = await api.listMastery(CHILD_A);
    expect(call()).toMatchObject({
      url: `https://lai.example/api/v1/children/${CHILD_A}/mastery/`,
      method: 'GET',
    });
    // The server's status (review decay applied) is kept as sent, never recomputed here.
    expect(entry).toMatchObject({ status: 'PROFICIENT', rawStatus: 'MASTERED', exposureCount: 6 });
  });

  it('reads one objective, null for an objective the server does not hold', async () => {
    const { api, call } = django(
      jsonResponse(
        200,
        entryJson({ hasEvidence: false, status: null, rawStatus: null, errorPattern: null }),
      ),
      jsonResponse(404, errorJson('not_found')),
    );
    await expect(api.getMastery(CHILD_A, 'addition-within-ten')).resolves.toMatchObject({
      hasEvidence: false,
      status: null,
    });
    expect(call().url).toBe(
      `https://lai.example/api/v1/children/${CHILD_A}/mastery/addition-within-ten/`,
    );
    await expect(api.getMastery(CHILD_A, 'nope')).resolves.toBeNull();
  });

  it('adapts the server rows to the row shape the screens read', async () => {
    const { api } = django(jsonResponse(200, { objectives: [entryJson()] }));
    await expect(api.listSkillProgress(CHILD_A)).resolves.toEqual([
      {
        id: 'addition-within-ten',
        learningObjectiveCode: 'addition-within-ten',
        exposureCount: 6,
        independentSuccessCount: 5,
        supportedSuccessCount: 1,
        consecutiveIndependentCorrect: 3,
        recentLevel: 'MASTERED',
        errorPattern: 'NONE',
        lastPracticedAt: '2026-09-20T10:00:00+00:00',
      },
    ]);
    expect(toSkillProgress(entryJson() as never).recentLevel).toBe('MASTERED');
  });

  it('keeps failures typed: refused token, another family, an off-contract body', async () => {
    const unauthenticated = django(
      jsonResponse(401, errorJson('authentication_failed')),
      jsonResponse(401, errorJson('authentication_failed')),
    );
    await expect(unauthenticated.api.listMastery(CHILD_A)).rejects.toMatchObject({
      kind: 'unauthenticated',
    });
    const foreign = django(jsonResponse(404, errorJson('not_found')));
    await expect(foreign.api.listMastery(CHILD_A)).rejects.toMatchObject({ kind: 'not_found' });
    const drifted = django(jsonResponse(200, { objectives: [entryJson({ status: 'GENIUS' })] }));
    await expect(drifted.api.listMastery(CHILD_A)).rejects.toMatchObject({
      kind: 'invalid_response',
    });
  });
});

describe('mastery backend selection', () => {
  const DJANGO = { backend: 'django', baseUrl: 'https://lai.example' } as const;

  it('never writes mastery from a Django client and never falls back to Amplify', async () => {
    const api = selectApi<MasteryApi>(
      'mastery',
      { amplify: masteryApi, django: (client) => createDjangoMastery(client) },
      DJANGO,
    );
    await expect(api.upsertSkillProgress(CHILD_A, 'addition-within-ten', 'correct', 0)).rejects.toMatchObject(
      { kind: 'unsupported', code: 'mastery_unavailable' },
    );
    expect(amplify.upsertSkillProgress).not.toHaveBeenCalled();
    expect(amplify.listSkillProgress).not.toHaveBeenCalled();
  });

  it('keeps Amplify rows unchanged and evaluates them with the shared rules', async () => {
    const row = {
      id: 'row-1',
      learningObjectiveCode: 'addition-within-ten',
      exposureCount: 5,
      independentSuccessCount: 5,
      supportedSuccessCount: 0,
      consecutiveIndependentCorrect: 5,
      recentLevel: 'MASTERED',
      errorPattern: 'NONE',
      lastPracticedAt: new Date().toISOString(),
    };
    amplify.listSkillProgress.mockResolvedValue([row]);

    await expect(masteryApi.listSkillProgress(CHILD_A)).resolves.toEqual([row]);
    const [entry] = await masteryApi.listMastery(CHILD_A);
    expect(entry).toMatchObject({
      objectiveId: 'addition-within-ten',
      title: 'Addition within ten',
      status: 'MASTERED',
      hasEvidence: true,
    });
    await expect(masteryApi.getMastery(CHILD_A, 'counting-sets')).resolves.toMatchObject({
      hasEvidence: false,
      status: null,
    });
    await expect(masteryApi.getMastery(CHILD_A, 'not-an-objective')).resolves.toBeNull();
  });
});
