import { beforeEach, describe, expect, it, vi } from 'vitest';

const amplify = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  fetchUserAttributes: vi.fn(),
}));

vi.mock('../lib/data-client', () => ({
  client: {
    models: {
      ParentProfile: { list: amplify.list, create: amplify.create, update: amplify.update },
    },
  },
}));
vi.mock('aws-amplify/auth', () => ({ fetchUserAttributes: amplify.fetchUserAttributes }));

import { withProvisioning } from './backend';
import { createApiClient } from './client';
import { ParentFacingError } from './errors';
import { createDjangoParentsApi, parentsApiFor } from './parents';
import { errorJson, jsonResponse } from '../test/playFixtures';

function django(responses: Response[], displayName = async () => 'Robin') {
  const fetch = vi.fn<typeof globalThis.fetch>();
  for (const response of responses) fetch.mockResolvedValueOnce(response);
  const client = withProvisioning(
    createApiClient({ baseUrl: '', getAccessToken: async () => 'token', fetch }),
  );
  return { api: createDjangoParentsApi(client, displayName), fetch };
}

beforeEach(() => {
  for (const mock of Object.values(amplify)) mock.mockReset();
});

describe('Django parent account', () => {
  it('provisions or reads the account with POST me/ and shows the Cognito name', async () => {
    const { api, fetch } = django([jsonResponse(201, { id: 'p1', django_admin: false })]);
    await expect(api.getOrCreateCurrentParent()).resolves.toEqual({
      id: 'p1',
      displayName: 'Robin',
      timezone: null,
    });
    expect(fetch.mock.calls[0][0]).toBe('/api/v1/me/');
    expect(fetch.mock.calls[0][1]?.method).toBe('POST');
  });

  it('falls back to the email, then to "Parent", like the Amplify record', async () => {
    amplify.fetchUserAttributes.mockResolvedValueOnce({ email: 'robin@example.com' });
    amplify.fetchUserAttributes.mockResolvedValueOnce({});
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async () => jsonResponse(200, { id: 'p1', django_admin: false }));
    const api = createDjangoParentsApi(
      createApiClient({ baseUrl: '', getAccessToken: async () => 'token', fetch }),
    );
    await expect(api.getOrCreateCurrentParent()).resolves.toMatchObject({
      displayName: 'robin@example.com',
    });
    await expect(api.getOrCreateCurrentParent()).resolves.toMatchObject({ displayName: 'Parent' });
  });

  it('reports a deactivated account as a parent-facing error', async () => {
    const { api } = django([jsonResponse(403, errorJson('permission_denied'))]);
    const error = await api.getOrCreateCurrentParent().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ParentFacingError);
    expect(error).toMatchObject({ kind: 'forbidden', message: 'Could not load your account.' });
  });

  it('treats a response without an id as invalid', async () => {
    const { api } = django([jsonResponse(200, { django_admin: false })]);
    await expect(api.getOrCreateCurrentParent()).rejects.toMatchObject({
      kind: 'invalid_response',
    });
  });

  it('cannot change the display name yet, and sends nothing', async () => {
    const { api, fetch } = django([]);
    await expect(api.updateDisplayName('p1', 'Sam')).rejects.toMatchObject({
      kind: 'unsupported',
      code: 'display_name_unavailable',
      message: 'Changing your name is not available yet.',
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('Amplify parent profile', () => {
  const api = parentsApiFor({ backend: 'amplify' });

  it('returns the existing owner-scoped record', async () => {
    amplify.list.mockResolvedValue({ data: [{ id: 'p1', displayName: 'Robin' }] });
    await expect(api.getOrCreateCurrentParent()).resolves.toEqual({
      id: 'p1',
      displayName: 'Robin',
    });
    expect(amplify.create).not.toHaveBeenCalled();
  });

  it('creates the record from the Cognito name when it is missing', async () => {
    amplify.list.mockResolvedValue({ data: [] });
    amplify.fetchUserAttributes.mockResolvedValue({ name: 'Robin', email: 'r@example.com' });
    amplify.create.mockResolvedValue({ data: { id: 'p1', displayName: 'Robin' } });
    await api.getOrCreateCurrentParent();
    expect(amplify.create).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: 'Robin', timezone: expect.any(String) }),
    );
  });

  it('updates the display name', async () => {
    amplify.update.mockResolvedValue({ data: { id: 'p1', displayName: 'Sam' } });
    await expect(api.updateDisplayName('p1', 'Sam')).resolves.toMatchObject({ displayName: 'Sam' });
    expect(amplify.update).toHaveBeenCalledWith({ id: 'p1', displayName: 'Sam' });
  });
});

describe('misconfigured build', () => {
  it('never reaches Amplify', async () => {
    const api = parentsApiFor({ backend: 'misconfigured', reason: 'unknown_backend' });
    await expect(api.getOrCreateCurrentParent()).rejects.toMatchObject({ kind: 'disabled' });
    expect(amplify.list).not.toHaveBeenCalled();
  });
});
