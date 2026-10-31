import { describe, expect, it, vi } from 'vitest';
import { createApiClient, type ApiClient } from '../../api/client';
import { ApiError } from '../../api/errors';
import type { SessionAuth } from '../../api/session';
import { createDjangoProfileStore, parseChild, PROFILE_MESSAGES } from './djangoProfiles';
import type { ChildProfileInput } from './profileTypes';

const WIRE_CHILD = {
  id: 'c1',
  nickname: 'Marigold',
  ageBand: 'SPROUT',
  avatarKey: 'OWL',
  hasPhoto: false,
  interests: ['Space'],
  readingMode: 'VOICE_FIRST',
  sessionMinutes: 6,
  active: true,
  aiEnabled: true,
  createdAt: '2026-10-31T10:00:00Z',
  updatedAt: '2026-10-31T10:00:00Z',
};

const INPUT: ChildProfileInput = {
  nickname: 'Marigold',
  ageBand: 'SPROUT',
  avatarKey: 'OWL',
  avatarPhotoKey: 'child-photos/someone/else.jpg',
  interests: ['Space'],
  readingMode: 'VOICE_FIRST',
  sessionMinutes: 6,
};

function fakeClient(respond: (method: string, path: string, body?: unknown) => unknown) {
  const request = vi.fn<ApiClient['request']>(async (method, path, options) => ({
    status: 200,
    data: respond(method, path, options?.body),
  }));
  return { request } satisfies ApiClient;
}

describe('Django profile store', () => {
  it('loads the parent profile from me/', async () => {
    const client = fakeClient(() => ({
      id: 'p1',
      displayName: 'Robin',
      timezone: '',
      django_admin: false,
    }));
    const store = createDjangoProfileStore(client);
    await expect(store.getOrCreateParentProfile()).resolves.toEqual({
      id: 'p1',
      displayName: 'Robin',
      timezone: null,
    });
    expect(client.request).toHaveBeenCalledWith('GET', 'me/', {});
  });

  it('updates only the display name with PATCH me/', async () => {
    const client = fakeClient((_m, _p, body) => ({ id: 'p1', ...(body as object), timezone: '' }));
    const updated = await createDjangoProfileStore(client).updateParentProfileDisplayName(
      'ignored-id',
      'Ada',
    );
    expect(updated.displayName).toBe('Ada');
    expect(client.request).toHaveBeenCalledWith('PATCH', 'me/', { body: { displayName: 'Ada' } });
  });

  it('lists the children Django returns and drops malformed rows', async () => {
    const client = fakeClient(() => ({ children: [WIRE_CHILD, { id: 'bad' }] }));
    const children = await createDjangoProfileStore(client).listChildProfiles();
    expect(children.map((child) => child.id)).toEqual(['c1']);
    expect(children[0]?.avatarPhotoKey).toBeNull();
  });

  it('creates a child without sending ownership or a photo path', async () => {
    const client = fakeClient(() => WIRE_CHILD);
    const created = await createDjangoProfileStore(client).createChildProfile('any-parent', INPUT);
    expect(created.id).toBe('c1');
    const [method, path, options] = client.request.mock.calls[0]!;
    expect([method, path]).toEqual(['POST', 'children/']);
    expect(options?.body).toEqual({
      nickname: 'Marigold',
      ageBand: 'SPROUT',
      avatarKey: 'OWL',
      interests: ['Space'],
      readingMode: 'VOICE_FIRST',
      sessionMinutes: 6,
    });
  });

  it('edits, deactivates and switches AI off with PATCH on the child', async () => {
    const client = fakeClient((_m, _p, body) => ({ ...WIRE_CHILD, ...(body as object) }));
    const store = createDjangoProfileStore(client);
    expect((await store.updateChildProfile('c1', { ...INPUT, nickname: 'Goldie' })).nickname).toBe(
      'Goldie',
    );
    expect((await store.setChildProfileActive('c1', false)).active).toBe(false);
    expect((await store.setChildProfileAIEnabled('c1', false)).aiEnabled).toBe(false);
    expect(client.request.mock.calls.map(([m, p]) => `${m} ${p}`)).toEqual([
      'PATCH children/c1/',
      'PATCH children/c1/',
      'PATCH children/c1/',
    ]);
    expect(client.request.mock.calls[1]?.[2]).toEqual({ body: { active: false } });
  });

  it('reads another family’s or an unknown child as null', async () => {
    const client: ApiClient = {
      request: vi.fn(async () => {
        throw new ApiError('not_found', { status: 404, code: 'not_found' });
      }),
    };
    await expect(createDjangoProfileStore(client).getChildProfile('c-foreign')).resolves.toBeNull();
  });

  it('turns API failures into safe messages', async () => {
    const failing = (error: ApiError): ApiClient => ({
      request: vi.fn(async () => {
        throw error;
      }),
    });
    const limit = createDjangoProfileStore(
      failing(new ApiError('conflict', { status: 409, code: 'child_profile_limit_reached' })),
    );
    await expect(limit.createChildProfile('p', INPUT)).rejects.toThrow(PROFILE_MESSAGES.limit);
    const invalid = createDjangoProfileStore(
      failing(new ApiError('invalid_request', { status: 400, code: 'validation_error' })),
    );
    await expect(invalid.updateChildProfile('c1', INPUT)).rejects.toThrow(PROFILE_MESSAGES.invalid);
    const blocked = createDjangoProfileStore(
      failing(new ApiError('forbidden', { status: 403, code: 'sensitive_action_unavailable' })),
    );
    await expect(blocked.deleteChildProfileData('c1')).rejects.toThrow(
      PROFILE_MESSAGES.deletionUnavailable,
    );
    const offline = createDjangoProfileStore(failing(new ApiError('network')));
    await expect(offline.listChildProfiles()).rejects.toThrow('Could not load the child profiles.');
  });

  it('never deletes the account from here', async () => {
    const client = fakeClient(() => null);
    await expect(createDjangoProfileStore(client).deleteAccountAndAllData()).rejects.toThrow(
      PROFILE_MESSAGES.accountDeletionUnavailable,
    );
    expect(client.request).not.toHaveBeenCalled();
  });

  it('has nothing to backfill and keeps no photos', async () => {
    const client = fakeClient(() => null);
    const store = createDjangoProfileStore(client);
    await store.ensureChildProfileOwnerSub('c1');
    expect(client.request).not.toHaveBeenCalled();
    expect(store.supportsPhotos).toBe(false);
  });
});

describe('the same store under either sign-in', () => {
  function respondingFetch() {
    return vi.fn<typeof fetch>(async () =>
      Response.json({ children: [WIRE_CHILD] }, { status: 200 }),
    );
  }

  it('sends the Cognito token, and no cookie credentials, in a Cognito build', async () => {
    const fetchMock = respondingFetch();
    const store = createDjangoProfileStore(
      createApiClient({ baseUrl: '', fetch: fetchMock, getAccessToken: async () => 'jwt' }),
    );
    await store.listChildProfiles();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/v1/children/');
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer jwt');
  });

  it('sends the session cookie and CSRF token, and no bearer token, in a local build', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json(WIRE_CHILD, { status: 200 }));
    const session: SessionAuth = { csrfToken: async () => 'csrf-1', reset: () => undefined };
    const store = createDjangoProfileStore(
      createApiClient({ baseUrl: '', fetch: fetchMock, session }),
    );
    await store.setChildProfileActive('c1', false);
    const [url, init] = fetchMock.mock.calls[0]!;
    const headers = init?.headers as Record<string, string>;
    expect([url, init?.method, init?.credentials]).toEqual([
      '/api/v1/children/c1/',
      'PATCH',
      'same-origin',
    ]);
    expect(headers['X-CSRFToken']).toBe('csrf-1');
    expect(headers.Authorization).toBeUndefined();
    expect(init?.body).toBe(JSON.stringify({ active: false }));
  });

  it('sends the CSRF token on DELETE too, with no body', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    const session: SessionAuth = { csrfToken: async () => 'csrf-2', reset: () => undefined };
    await createDjangoProfileStore(
      createApiClient({ baseUrl: '', fetch: fetchMock, session }),
    ).deleteChildProfileData('c1');
    const init = fetchMock.mock.calls[0]![1];
    expect((init!.headers as Record<string, string>)['X-CSRFToken']).toBe('csrf-2');
    expect(init?.body).toBeUndefined();
  });
});

describe('parseChild', () => {
  it('rejects an unknown age band or reading mode', () => {
    expect(parseChild({ ...WIRE_CHILD, ageBand: 'TEEN' })).toBeNull();
    expect(parseChild({ ...WIRE_CHILD, readingMode: 'SKIM' })).toBeNull();
    expect(parseChild(null)).toBeNull();
  });
});
