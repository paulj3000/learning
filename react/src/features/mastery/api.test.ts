import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeDjangoClient, type FakeDjangoClient } from '../../test/fakeDjangoClient';

const holder = vi.hoisted(() => ({ client: null as FakeDjangoClient | null }));
vi.mock('../../api/djangoClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/djangoClient')>()),
  djangoClient: () => holder.client,
}));

import * as masteryApi from './api';

const SKILLS = 'children/child-1/skill-progress/';
let api: FakeDjangoClient;

beforeEach(() => {
  api = fakeDjangoClient();
  holder.client = api;
});

describe('mastery on Django (AMP-03)', () => {
  it('reads the server-derived rows', async () => {
    api.on('GET', SKILLS, {
      skills: [
        {
          learningObjectiveCode: 'counting-sets',
          exposureCount: 2,
          independentSuccessCount: 1,
          supportedSuccessCount: 1,
          consecutiveIndependentCorrect: 1,
          recentLevel: 'DEVELOPING',
          errorPattern: null,
          lastPracticedAt: '2026-11-01T10:00:00+00:00',
        },
      ],
    });
    expect(await masteryApi.listSkillProgress('child-1')).toEqual([
      {
        childProfileId: 'child-1',
        learningObjectiveCode: 'counting-sets',
        exposureCount: 2,
        independentSuccessCount: 1,
        supportedSuccessCount: 1,
        consecutiveIndependentCorrect: 1,
        recentLevel: 'DEVELOPING',
        errorPattern: null,
        lastPracticedAt: '2026-11-01T10:00:00+00:00',
      },
    ]);
  });

  it('rejects a level the client does not know', async () => {
    api.on('GET', SKILLS, {
      skills: [
        {
          learningObjectiveCode: 'x',
          exposureCount: 1,
          independentSuccessCount: 0,
          supportedSuccessCount: 0,
          consecutiveIndependentCorrect: 0,
          recentLevel: 'GENIUS',
          errorPattern: null,
          lastPracticedAt: null,
        },
      ],
    });
    await expect(masteryApi.listSkillProgress('child-1')).rejects.toMatchObject({
      kind: 'invalid_response',
    });
  });

  it('has no client write: mastery is derived on the server from graded evidence', () => {
    expect(Object.keys(masteryApi)).toEqual(['listSkillProgress']);
  });
});
