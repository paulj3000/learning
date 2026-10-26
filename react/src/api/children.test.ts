import { beforeEach, describe, expect, it, vi } from 'vitest';

const amplify = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  getCurrentUser: vi.fn(),
  fetchAuthSession: vi.fn(),
}));

vi.mock('../lib/data-client', () => ({
  client: {
    models: {
      ChildProfile: {
        list: amplify.list,
        get: amplify.get,
        create: amplify.create,
        update: amplify.update,
      },
    },
  },
}));
vi.mock('aws-amplify/auth', () => ({
  getCurrentUser: amplify.getCurrentUser,
  fetchAuthSession: amplify.fetchAuthSession,
}));

import { withProvisioning } from './backend';
import { childrenApiFor, createDjangoChildrenApi, deleteDjangoChild, type ChildrenApi } from './children';
import { createApiClient } from './client';
import { ParentFacingError } from './errors';
import type { ChildProfileInput } from './types';
import { errorJson, jsonResponse } from '../test/playFixtures';

const DJANGO_CHILD = {
  id: '8d1f0c2e-5a7b-4c1d-9e2f-3a4b5c6d7e8f',
  nickname: 'Bramble',
  ageBand: 'SPROUT',
  avatarKey: 'OWL',
  hasPhoto: false,
  interests: ['Space', 'Ocean'],
  readingMode: 'VOICE_FIRST',
  sessionMinutes: 6,
  active: true,
  aiEnabled: true,
  createdAt: '2026-10-25T10:00:00Z',
  updatedAt: '2026-10-25T10:00:00Z',
};

const INPUT: ChildProfileInput = {
  nickname: 'Bramble',
  ageBand: 'SPROUT',
  avatarKey: 'OWL',
  avatarPhotoKey: null,
  interests: ['Space'],
  readingMode: 'VOICE_FIRST',
  sessionMinutes: 6,
};

function django(...responses: Array<Response | Error>) {
  const fetch = vi.fn<typeof globalThis.fetch>();
  for (const response of responses) {
    if (response instanceof Response) fetch.mockResolvedValueOnce(response);
    else fetch.mockRejectedValueOnce(response);
  }
  const client = withProvisioning(
    createApiClient({ baseUrl: 'https://lai.example', getAccessToken: async () => 'token', fetch }),
  );
  return { api: createDjangoChildrenApi(client), fetch };
}

function call(fetch: ReturnType<typeof vi.fn<typeof globalThis.fetch>>, index = 0) {
  const [url, init] = fetch.mock.calls[index];
  return {
    url: String(url),
    method: init?.method,
    body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
  };
}

async function failure(promise: Promise<unknown>): Promise<ParentFacingError> {
  const error = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(ParentFacingError);
  return error as ParentFacingError;
}

describe('Django children API', () => {
  it('lists the parent’s children from GET children/', async () => {
    const { api, fetch } = django(jsonResponse(200, { children: [DJANGO_CHILD] }));
    const children = await api.list();
    expect(call(fetch)).toMatchObject({
      url: 'https://lai.example/api/v1/children/',
      method: 'GET',
    });
    expect(children).toEqual([
      expect.objectContaining({
        id: DJANGO_CHILD.id,
        nickname: 'Bramble',
        ageBand: 'SPROUT',
        avatarPhotoKey: null,
        hasPhoto: false,
      }),
    ]);
  });

  it('gets one child by its encoded id', async () => {
    const { api, fetch } = django(jsonResponse(200, DJANGO_CHILD));
    await expect(api.get(DJANGO_CHILD.id)).resolves.toMatchObject({ id: DJANGO_CHILD.id });
    expect(call(fetch).url).toBe(`https://lai.example/api/v1/children/${DJANGO_CHILD.id}/`);
  });

  it('returns null for an unknown or another family’s child (both are 404)', async () => {
    const { api } = django(jsonResponse(404, errorJson('not_found')));
    await expect(api.get('someone-elses-child')).resolves.toBeNull();
  });

  it('creates with a closed body: no parent id, no owner, no photo path', async () => {
    const { api, fetch } = django(jsonResponse(201, DJANGO_CHILD));
    await api.create('amplify-parent-id-ignored', INPUT);
    const sent = call(fetch);
    expect(sent).toMatchObject({ url: 'https://lai.example/api/v1/children/', method: 'POST' });
    expect(sent.body).toEqual({
      nickname: 'Bramble',
      ageBand: 'SPROUT',
      avatarKey: 'OWL',
      interests: ['Space'],
      readingMode: 'VOICE_FIRST',
      sessionMinutes: 6,
    });
  });

  it('updates with PATCH, and toggles active and AI with one field each', async () => {
    const { api, fetch } = django(
      jsonResponse(200, DJANGO_CHILD),
      jsonResponse(200, { ...DJANGO_CHILD, active: false }),
      jsonResponse(200, { ...DJANGO_CHILD, aiEnabled: false }),
    );
    await api.update(DJANGO_CHILD.id, INPUT);
    await expect(api.setActive(DJANGO_CHILD.id, false)).resolves.toMatchObject({ active: false });
    await expect(api.setAIEnabled(DJANGO_CHILD.id, false)).resolves.toMatchObject({
      aiEnabled: false,
    });
    expect([0, 1, 2].map((index) => call(fetch, index).method)).toEqual([
      'PATCH',
      'PATCH',
      'PATCH',
    ]);
    expect(call(fetch, 1).body).toEqual({ active: false });
    expect(call(fetch, 2).body).toEqual({ aiEnabled: false });
  });

  it('refuses a photo path before sending anything', async () => {
    const { api, fetch } = django();
    const error = await failure(api.create('p', { ...INPUT, avatarPhotoKey: 'child-photos/x.jpg' }));
    expect(error).toMatchObject({ kind: 'unsupported', code: 'child_photo_unavailable' });
    expect(error.message).toBe('Profile photos are not available yet.');
    expect(fetch).not.toHaveBeenCalled();
    expect(api.photoUploadsSupported).toBe(false);
  });

  it('gives the profile limit a parent-facing message', async () => {
    const { api } = django(jsonResponse(409, errorJson('child_profile_limit_reached')));
    const error = await failure(api.create('p', INPUT));
    expect(error.code).toBe('child_profile_limit_reached');
    expect(error.message).toBe('You already have the most child profiles allowed.');
  });

  it('keeps validation details reachable through the typed error', async () => {
    const { api } = django(
      jsonResponse(
        400,
        errorJson('validation_error', {
          sessionMinutes: [{ message: 'Out of range.', code: 'session_minutes_out_of_range' }],
        }),
      ),
    );
    const error = await failure(api.update(DJANGO_CHILD.id, INPUT));
    expect(error.kind).toBe('invalid_request');
    expect(error.apiError.details.sessionMinutes?.[0]?.code).toBe('session_minutes_out_of_range');
  });

  it('asks the parent to sign in again when the token is refused after a refresh', async () => {
    const { api } = django(
      jsonResponse(401, errorJson('authentication_failed')),
      jsonResponse(401, errorJson('authentication_failed')),
    );
    const error = await failure(api.list());
    expect(error.kind).toBe('unauthenticated');
    expect(error.message).toBe('Please sign in again.');
  });

  it('provisions the Django account when it does not exist yet, then retries', async () => {
    const { api, fetch } = django(
      jsonResponse(403, errorJson('account_not_provisioned')),
      jsonResponse(201, { id: 'p1', django_admin: false }),
      jsonResponse(200, { children: [] }),
    );
    await expect(api.list()).resolves.toEqual([]);
    expect(call(fetch, 1)).toMatchObject({ url: 'https://lai.example/api/v1/me/', method: 'POST' });
  });

  it('reports a network failure without falling back to Amplify', async () => {
    const { api } = django(new TypeError('Failed to fetch'));
    const error = await failure(api.list());
    expect(error.kind).toBe('network');
    expect(amplify.list).not.toHaveBeenCalled();
  });

  it('treats a response off the contract as invalid', async () => {
    const { api } = django(jsonResponse(200, { children: [{ ...DJANGO_CHILD, ageBand: 'ADULT' }] }));
    expect((await failure(api.list())).kind).toBe('invalid_response');
  });

  it('has no ownerSub backfill to do', async () => {
    const { api, fetch } = django();
    await api.ensureOwnerSub(DJANGO_CHILD.id);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('deleteDjangoChild', () => {
  it('asks Django, which refuses until LAI-0602, and says so to the parent', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(jsonResponse(403, errorJson('sensitive_action_unavailable')));
    vi.stubGlobal('fetch', fetch);
    amplify.fetchAuthSession.mockResolvedValue({
      tokens: { accessToken: { toString: () => 'token' } },
    });
    try {
      const error = await failure(
        deleteDjangoChild({ backend: 'django', baseUrl: 'https://del.example' }, DJANGO_CHILD.id),
      );
      expect(error.code).toBe('sensitive_action_unavailable');
      expect(error.message).toBe('Deleting profiles is not available yet.');
      expect(fetch.mock.calls[0][1]?.method).toBe('DELETE');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('Amplify children API', () => {
  const api = childrenApiFor({ backend: 'amplify' });

  beforeEach(() => {
    for (const mock of Object.values(amplify)) mock.mockReset();
  });

  it('keeps using the owner-scoped Amplify model', async () => {
    amplify.list.mockResolvedValue({ data: [{ id: 'a1' }] });
    await expect(api.list()).resolves.toEqual([{ id: 'a1' }]);
    expect(api.photoUploadsSupported).toBe(true);
  });

  it('creates with the parent profile id and the signed-in sub as ownerSub', async () => {
    amplify.getCurrentUser.mockResolvedValue({ userId: 'sub-1', username: 'parent' });
    amplify.create.mockResolvedValue({ data: { id: 'a1' } });
    await api.create('parent-1', INPUT);
    expect(amplify.create).toHaveBeenCalledWith({
      parentProfileId: 'parent-1',
      active: true,
      ownerSub: 'sub-1',
      ...INPUT,
    });
  });

  it('keeps the Amplify error message when a write is refused', async () => {
    amplify.update.mockResolvedValue({ data: null, errors: [{ message: 'Not Authorized' }] });
    await expect(api.setActive('a1', false)).rejects.toThrow('Not Authorized');
  });
});

describe('backend selection', () => {
  it('fails every call on a misconfigured build, with a parent-facing message', async () => {
    const api = childrenApiFor({ backend: 'misconfigured', reason: 'invalid_api_base' });
    const error = await failure(api.list());
    expect(error).toMatchObject({ kind: 'disabled', code: 'invalid_api_base' });
    expect(error.message).toBe('This part of the app is not set up yet.');
    expect(amplify.list).not.toHaveBeenCalled();
  });

  it('exposes the same operations on both backends', () => {
    const keys = (api: ChildrenApi) => Object.keys(api).sort();
    const { api: djangoApi } = django();
    expect(keys(djangoApi)).toEqual(keys(childrenApiFor({ backend: 'amplify' })));
  });
});
