import { createApiClient } from './client';
import { readDjangoApiConfig } from './config';
import { ApiError } from './errors';
import { errorJson, jsonResponse } from '../test/playFixtures';

function setup(
  responses: Array<Response | Error | DOMException>,
  token: string | null = 'token-1',
) {
  const fetch = vi.fn<typeof globalThis.fetch>();
  for (const response of responses) {
    if (response instanceof Response) fetch.mockResolvedValueOnce(response);
    else fetch.mockRejectedValueOnce(response);
  }
  const getAccessToken = vi.fn(async (options?: { forceRefresh?: boolean }) =>
    token === null ? null : options?.forceRefresh ? `${token}-refreshed` : token,
  );
  const client = createApiClient({ baseUrl: 'https://lai.example', getAccessToken, fetch });
  return { client, fetch, getAccessToken };
}

async function failure(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    return error as ApiError;
  }
  throw new Error('expected the request to fail');
}

describe('createApiClient', () => {
  it('sends a GET to the versioned path with the bearer token and no body', async () => {
    const { client, fetch } = setup([jsonResponse(200, { ok: true })]);
    const response = await client.request('GET', 'children/c/progress/');
    expect(response).toEqual({ status: 200, data: { ok: true } });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://lai.example/api/v1/children/c/progress/');
    expect(init?.method).toBe('GET');
    expect(init?.body).toBeUndefined();
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer token-1');
  });

  it('sends a POST as JSON, with an empty object when there is no body', async () => {
    const { client, fetch } = setup([jsonResponse(201, {}), jsonResponse(200, {})]);
    await client.request('POST', 'x/', { body: { answer: 5 } });
    await client.request('POST', 'y/');
    const headers = fetch.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(fetch.mock.calls[0][1]?.body).toBe('{"answer":5}');
    expect(fetch.mock.calls[1][1]?.body).toBe('{}');
  });

  it('retries a 401 once with a refreshed token', async () => {
    const { client, fetch, getAccessToken } = setup([
      jsonResponse(401, errorJson('not_authenticated')),
      jsonResponse(200, { ok: true }),
    ]);
    await expect(client.request('GET', 'p/')).resolves.toEqual({ status: 200, data: { ok: true } });
    expect(getAccessToken).toHaveBeenLastCalledWith({ forceRefresh: true });
    const retried = fetch.mock.calls[1][1]?.headers as Record<string, string>;
    expect(retried.Authorization).toBe('Bearer token-1-refreshed');
  });

  it('reports unauthenticated when the refreshed token is refused too', async () => {
    const { client, fetch } = setup([
      jsonResponse(401, errorJson('authentication_failed')),
      jsonResponse(401, errorJson('authentication_failed')),
    ]);
    const error = await failure(client.request('GET', 'p/'));
    expect(error.kind).toBe('unauthenticated');
    expect(error.code).toBe('authentication_failed');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not call the API at all without a signed-in parent', async () => {
    const { client, fetch } = setup([], null);
    expect((await failure(client.request('GET', 'p/'))).kind).toBe('unauthenticated');
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    [400, 'validation_error', 'invalid_request'],
    [403, 'account_not_provisioned', 'forbidden'],
    [404, 'not_found', 'not_found'],
    [409, 'attempt_already_answered', 'conflict'],
    [503, 'authentication_unavailable', 'unavailable'],
    [500, 'server_error', 'server'],
  ])('maps %i %s to %s', async (status, code, kind) => {
    const { client } = setup([jsonResponse(status, errorJson(code))]);
    const error = await failure(client.request('POST', 'p/'));
    expect([error.kind, error.code, error.status, error.requestId]).toEqual([
      kind,
      code,
      status,
      'req-12345678',
    ]);
  });

  it('keeps validation details', async () => {
    const details = { answer: [{ message: 'Not a possible answer.', code: 'invalid_answer' }] };
    const { client } = setup([jsonResponse(400, errorJson('validation_error', details))]);
    const error = await failure(client.request('POST', 'p/'));
    expect(error.details.answer[0].code).toBe('invalid_answer');
  });

  it('treats a 503 as unavailable and retryable, never as signed out', async () => {
    const { client } = setup([jsonResponse(503, errorJson('authentication_unavailable'))]);
    const error = await failure(client.request('GET', 'p/'));
    expect(error.kind).toBe('unavailable');
    expect(error.retryable).toBe(true);
  });

  it('reports a network failure', async () => {
    const { client } = setup([new TypeError('Failed to fetch')]);
    const error = await failure(client.request('GET', 'p/'));
    expect(error.kind).toBe('network');
    expect(error.retryable).toBe(true);
  });

  it('reports an aborted request as aborted', async () => {
    const { client } = setup([new DOMException('aborted', 'AbortError')]);
    expect((await failure(client.request('GET', 'p/'))).kind).toBe('aborted');
  });

  it('handles a non-JSON error page and a non-JSON success', async () => {
    const html = (status: number) => new Response('<html>bad gateway</html>', { status });
    const { client } = setup([html(502), html(200)]);
    expect((await failure(client.request('GET', 'p/'))).kind).toBe('server');
    expect((await failure(client.request('GET', 'p/'))).kind).toBe('invalid_response');
  });
});

describe('readDjangoApiConfig', () => {
  it('is off unless the backend is django', () => {
    expect(readDjangoApiConfig({})).toEqual({ enabled: false });
    expect(readDjangoApiConfig({ VITE_BACKEND: 'amplify' })).toEqual({ enabled: false });
  });

  it('defaults to same-origin', () => {
    expect(readDjangoApiConfig({ VITE_BACKEND: 'django' })).toEqual({ enabled: true, baseUrl: '' });
  });

  it('accepts https anywhere and http only in dev', () => {
    const https = { VITE_BACKEND: 'django', VITE_DJANGO_API_BASE: 'https://api.lai.example/' };
    expect(readDjangoApiConfig(https)).toEqual({
      enabled: true,
      baseUrl: 'https://api.lai.example',
    });
    const http = { VITE_BACKEND: 'django', VITE_DJANGO_API_BASE: 'http://localhost:8000' };
    expect(readDjangoApiConfig(http)).toEqual({ enabled: false });
    expect(readDjangoApiConfig({ ...http, DEV: true })).toEqual({
      enabled: true,
      baseUrl: 'http://localhost:8000',
    });
  });

  it('refuses a base with a path or that is not a URL', () => {
    expect(
      readDjangoApiConfig({
        VITE_BACKEND: 'django',
        VITE_DJANGO_API_BASE: 'https://x.example/api',
      }),
    ).toEqual({
      enabled: false,
    });
    expect(
      readDjangoApiConfig({ VITE_BACKEND: 'django', VITE_DJANGO_API_BASE: 'not a url' }),
    ).toEqual({
      enabled: false,
    });
  });
});

describe('account provisioning (POST me/)', () => {
  function provisioning(responses: Response[]) {
    const fetch = vi.fn<typeof globalThis.fetch>();
    for (const response of responses) fetch.mockResolvedValueOnce(response);
    const client = createApiClient({
      baseUrl: '',
      getAccessToken: async () => 'tok',
      fetch,
      provisionAccount: true,
    });
    const calls = () => fetch.mock.calls.map(([url, init]) => `${init?.method} ${String(url)}`);
    return { client, fetch, calls };
  }

  it('sets up the parent account once and retries the request', async () => {
    const { client, calls } = provisioning([
      jsonResponse(403, errorJson('account_not_provisioned')),
      jsonResponse(201, { id: 'parent' }),
      jsonResponse(200, { ok: true }),
    ]);
    await expect(client.request('GET', 'children/c/progress/')).resolves.toEqual({
      status: 200,
      data: { ok: true },
    });
    expect(calls()).toEqual([
      'GET /api/v1/children/c/progress/',
      'POST /api/v1/me/',
      'GET /api/v1/children/c/progress/',
    ]);
  });

  it('shares one setup call between requests that both found the account missing', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    fetch.mockImplementation(async (url, init) => {
      const path = String(url);
      if (path.endsWith('/me/')) return jsonResponse(201, { id: 'parent' });
      const provisioned = fetch.mock.calls.some(([u]) => String(u).endsWith('/me/'));
      return provisioned
        ? jsonResponse(200, { path, method: init?.method })
        : jsonResponse(403, errorJson('account_not_provisioned'));
    });
    const client = createApiClient({
      baseUrl: '',
      getAccessToken: async () => 'tok',
      fetch,
      provisionAccount: true,
    });
    await Promise.all([client.request('GET', 'a/'), client.request('GET', 'b/')]);
    expect(fetch.mock.calls.filter(([u]) => String(u).endsWith('/me/'))).toHaveLength(1);
  });

  it('reports a failed setup as an account problem, never as signed out', async () => {
    const { client } = provisioning([
      jsonResponse(403, errorJson('account_not_provisioned')),
      jsonResponse(500, errorJson('server_error')),
    ]);
    const error = await failure(client.request('GET', 'p/'));
    expect([error.kind, error.code]).toEqual(['forbidden', 'account_setup_failed']);
  });

  it('does not set up an account for any other 403', async () => {
    const { client, calls } = provisioning([jsonResponse(403, errorJson('permission_denied'))]);
    const error = await failure(client.request('GET', 'p/'));
    expect(error.code).toBe('permission_denied');
    expect(calls()).toEqual(['GET /api/v1/p/']);
  });

  it('retries only once, and never provisions while provisioning', async () => {
    const { client, calls } = provisioning([
      jsonResponse(403, errorJson('account_not_provisioned')),
      jsonResponse(200, { id: 'parent' }),
      jsonResponse(403, errorJson('account_not_provisioned')),
    ]);
    const error = await failure(client.request('GET', 'p/'));
    expect(error.code).toBe('account_not_provisioned');
    expect(calls()).toHaveLength(3);
  });

  it('is off unless asked for', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(jsonResponse(403, errorJson('account_not_provisioned')));
    const client = createApiClient({ baseUrl: '', getAccessToken: async () => 'tok', fetch });
    expect((await failure(client.request('GET', 'p/'))).code).toBe('account_not_provisioned');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
