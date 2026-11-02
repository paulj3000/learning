import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../client';
import { ApiError } from '../errors';
import { createDjangoAiApi, djangoAiApiFor, templateIdFor } from './djangoAi';

function fakeClient(data: unknown = { turn: { spokenText: 'Hi' }, source: 'AI', requestId: 'r1' }) {
  const request = vi.fn(async (_method: string, _path: string, _options?: unknown) => ({
    status: 200,
    data,
  }));
  return { client: { request } as unknown as ApiClient, request };
}

describe('djangoAiApiFor', () => {
  it('is null for a build without the Django API, so callers keep using Amplify', () => {
    expect(djangoAiApiFor({ enabled: false })).toBeNull();
  });

  it('exists for a Django build', () => {
    expect(djangoAiApiFor({ enabled: true, baseUrl: '' })).not.toBeNull();
  });
});

describe('createDjangoAiApi', () => {
  it('posts a companion turn to the child-scoped route with only accepted fields', async () => {
    const { client, request } = fakeClient();
    const api = createDjangoAiApi(client);
    const result = await api.companionTurn('child 1', {
      intent: 'HINT',
      templateId: 'repair-the-moonlight-bridge',
      stepSummary: 'counting planks',
      authoredBaseText: '',
      sessionId: 'Not A Slug!',
      allowedChoiceIds: ['knight', 'BAD ID', 'wizard'],
    });
    expect(request).toHaveBeenCalledWith('POST', 'children/child%201/ai/companion-turns/', {
      body: {
        intent: 'HINT',
        templateId: 'repair-the-moonlight-bridge',
        stepSummary: 'counting planks',
        allowedChoiceIds: ['knight', 'wizard'],
      },
      signal: undefined,
    });
    expect(result).toEqual({ turn: { spokenText: 'Hi' }, source: 'AI', requestId: 'r1' });
  });

  it('posts a tutor turn to the tutor route', async () => {
    const { client, request } = fakeClient();
    await createDjangoAiApi(client).tutorTurn('c1', {
      skillId: 'counting-sets',
      templateId: 't',
      hintLevel: 3,
    });
    expect(request.mock.calls[0][1]).toBe('children/c1/ai/tutor-turns/');
  });

  it.each([null, {}, { turn: 'x', source: 'AI' }, { turn: {}, source: 'MODEL' }])(
    'rejects a response that is not the documented shape: %j',
    async (data) => {
      const { client } = fakeClient(data);
      await expect(
        createDjangoAiApi(client).companionTurn('c1', {
          intent: 'ASK',
          templateId: 't',
          stepSummary: 's',
        }),
      ).rejects.toMatchObject({ kind: 'invalid_response' });
    },
  );

  it('passes API errors through (the feature module turns them into fallbacks)', async () => {
    const client = {
      request: vi.fn(async () => {
        throw new ApiError('not_found', { status: 404 });
      }),
    } as unknown as ApiClient;
    await expect(
      createDjangoAiApi(client).companionTurn('other-family-child', {
        intent: 'ASK',
        templateId: 't',
        stepSummary: 's',
      }),
    ).rejects.toMatchObject({ kind: 'not_found' });
  });

  it('refuses an empty child id without a network call', async () => {
    const { client, request } = fakeClient();
    await expect(
      createDjangoAiApi(client).tutorTurn('', { skillId: 's', templateId: 't', hintLevel: 1 }),
    ).rejects.toMatchObject({ kind: 'invalid_request' });
    expect(request).not.toHaveBeenCalled();
  });
});

describe('templateIdFor', () => {
  it.each([
    ['repair-the-moonlight-bridge', 'repair-the-moonlight-bridge'],
    ['npc:captain-pip', 'npc:captain-pip'],
    ['Story Chapter 1', 'story-chapter-1'],
    [undefined, 'island'],
    ['!!!', 'island'],
  ])('%s -> %s', (raw, expected) => {
    expect(templateIdFor(raw)).toBe(expected);
  });
});
