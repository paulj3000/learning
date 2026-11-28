import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from './client';
import type { ChildPrincipalAccess } from './childPrincipal';
import { ApiError } from './errors';
import { errorJson, jsonResponse } from '../test/playFixtures';

function setup(responses: Response[], principal: ChildPrincipalAccess) {
  const fetch = vi.fn<typeof globalThis.fetch>();
  for (const response of responses) fetch.mockResolvedValueOnce(response);
  const getAccessToken = vi.fn(async () => 'parent-token');
  const client = createApiClient({
    baseUrl: '',
    getAccessToken,
    fetch,
    childPrincipal: principal,
  });
  return { client, fetch, getAccessToken };
}

function principal(initial: string | null, restored: string | null = null) {
  let csrf = initial;
  const access = {
    csrfToken: () => csrf,
    restore: vi.fn(async () => {
      csrf = restored;
      return restored;
    }),
    expired: vi.fn(),
  } satisfies ChildPrincipalAccess;
  return access;
}

describe('createApiClient in child mode', () => {
  it('sends no Authorization header, same-origin credentials, and no CSRF on reads', async () => {
    const access = principal('csrf-1');
    const { client, fetch, getAccessToken } = setup([jsonResponse(200, { ok: true })], access);
    await client.request('GET', 'children/c1/home/');
    const init = fetch.mock.calls[0][1];
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
    expect(headers['X-LAI-Child-CSRF']).toBeUndefined();
    expect(init?.credentials).toBe('same-origin');
    expect(getAccessToken).not.toHaveBeenCalled();
  });

  it('adds the CSRF header on every non-GET request', async () => {
    const access = principal('csrf-1');
    const { client, fetch } = setup(
      [jsonResponse(200, {}), jsonResponse(200, {}), jsonResponse(200, {})],
      access,
    );
    await client.request('POST', 'children/c1/world-changes/', { body: { a: 1 } });
    await client.request('PUT', 'children/c1/companion/', { body: {} });
    await client.request('PATCH', 'children/c1/world-state/', { body: {} });
    for (const call of fetch.mock.calls) {
      expect((call[1]?.headers as Record<string, string>)['X-LAI-Child-CSRF']).toBe('csrf-1');
    }
  });

  it('restores once on a refused session, retries with the new CSRF token, and does not loop', async () => {
    const access = principal('old', 'new');
    const { client, fetch } = setup(
      [jsonResponse(401, errorJson('authentication_failed')), jsonResponse(200, { ok: 1 })],
      access,
    );
    const response = await client.request('POST', 'children/c1/world-changes/', { body: {} });
    expect(response.status).toBe(200);
    expect(access.restore).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect((fetch.mock.calls[1][1]?.headers as Record<string, string>)['X-LAI-Child-CSRF']).toBe(
      'new',
    );
  });

  it('expires the session when restore fails, as an unauthenticated error', async () => {
    const access = principal('old', null);
    const { client, fetch } = setup(
      [jsonResponse(401, errorJson('authentication_failed'))],
      access,
    );
    await expect(client.request('GET', 'children/c1/home/')).rejects.toMatchObject({
      kind: 'unauthenticated',
    });
    expect(access.expired).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not restore on a route that never reads the child session', async () => {
    const access = principal('old', 'new');
    const { client, fetch } = setup([jsonResponse(401, errorJson('not_authenticated'))], access);
    await expect(client.request('GET', 'me/')).rejects.toMatchObject({
      kind: 'unauthenticated',
      code: 'not_authenticated',
    });
    expect(access.restore).not.toHaveBeenCalled();
    expect(access.expired).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('stays in parent mode (bearer token, no CSRF) when no child session is active', async () => {
    const access = principal(null);
    const { client, fetch } = setup([jsonResponse(200, {})], access);
    await client.request('POST', 'children/c1/world-changes/', { body: {} });
    const headers = fetch.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer parent-token');
    expect(headers['X-LAI-Child-CSRF']).toBeUndefined();
    expect(fetch.mock.calls[0][1]?.credentials).toBeUndefined();
    expect(new ApiError('aborted')).toBeInstanceOf(Error);
  });
});
