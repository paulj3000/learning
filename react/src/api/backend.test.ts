import { describe, expect, it, vi } from 'vitest';
import { djangoClient, withProvisioning } from './backend';
import type { ApiClient } from './client';
import { readBackendSelection } from './config';
import { ApiError } from './errors';

describe('readBackendSelection', () => {
  it('is Amplify when VITE_BACKEND is unset, empty or amplify', () => {
    expect(readBackendSelection({})).toEqual({ backend: 'amplify' });
    expect(readBackendSelection({ VITE_BACKEND: '' })).toEqual({ backend: 'amplify' });
    expect(readBackendSelection({ VITE_BACKEND: 'amplify' })).toEqual({ backend: 'amplify' });
  });

  it('is Django with a same-origin or valid https base', () => {
    expect(readBackendSelection({ VITE_BACKEND: 'django' })).toEqual({
      backend: 'django',
      baseUrl: '',
    });
    expect(
      readBackendSelection({ VITE_BACKEND: 'django', VITE_DJANGO_API_BASE: 'https://lai.example' }),
    ).toEqual({ backend: 'django', baseUrl: 'https://lai.example' });
  });

  it('is misconfigured, never Amplify, when Django was asked for with an unusable base', () => {
    expect(
      readBackendSelection({ VITE_BACKEND: 'django', VITE_DJANGO_API_BASE: 'http://lai.example' }),
    ).toEqual({ backend: 'misconfigured', reason: 'invalid_api_base' });
    expect(
      readBackendSelection({ VITE_BACKEND: 'django', VITE_DJANGO_API_BASE: 'not a url' }),
    ).toEqual({ backend: 'misconfigured', reason: 'invalid_api_base' });
  });

  it('is misconfigured for an unknown backend name', () => {
    expect(readBackendSelection({ VITE_BACKEND: 'Django' })).toEqual({
      backend: 'misconfigured',
      reason: 'unknown_backend',
    });
  });
});

describe('djangoClient', () => {
  it('refuses to build a client for an Amplify or misconfigured build', () => {
    expect(() => djangoClient({ backend: 'amplify' })).toThrow(ApiError);
    let caught: unknown;
    try {
      djangoClient({ backend: 'misconfigured', reason: 'invalid_api_base' });
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ kind: 'disabled', code: 'invalid_api_base' });
  });

  it('reuses one client per base URL', () => {
    const first = djangoClient({ backend: 'django', baseUrl: 'https://a.example' });
    expect(djangoClient({ backend: 'django', baseUrl: 'https://a.example' })).toBe(first);
    expect(djangoClient({ backend: 'django', baseUrl: 'https://b.example' })).not.toBe(first);
  });
});

describe('withProvisioning', () => {
  const notProvisioned = () =>
    new ApiError('forbidden', { status: 403, code: 'account_not_provisioned' });

  function fakeClient(...outcomes: Array<ApiError | { status: number; data: unknown }>) {
    const request = vi.fn<ApiClient['request']>();
    for (const outcome of outcomes) {
      if (outcome instanceof ApiError) request.mockRejectedValueOnce(outcome);
      else request.mockResolvedValueOnce(outcome);
    }
    return { client: { request }, request };
  }

  it('provisions once with POST me/ and retries the original request', async () => {
    const { client, request } = fakeClient(
      notProvisioned(),
      { status: 201, data: { id: 'p1' } },
      { status: 200, data: { children: [] } },
    );
    await expect(withProvisioning(client).request('GET', 'children/')).resolves.toEqual({
      status: 200,
      data: { children: [] },
    });
    expect(request.mock.calls.map(([method, path]) => `${method} ${path}`)).toEqual([
      'GET children/',
      'POST me/',
      'GET children/',
    ]);
  });

  it('does not loop: a second account_not_provisioned is returned to the caller', async () => {
    const { client, request } = fakeClient(
      notProvisioned(),
      { status: 200, data: {} },
      notProvisioned(),
    );
    await expect(withProvisioning(client).request('GET', 'children/')).rejects.toMatchObject({
      code: 'account_not_provisioned',
    });
    expect(request).toHaveBeenCalledTimes(3);
  });

  it('leaves every other failure alone', async () => {
    const denied = new ApiError('forbidden', { status: 403, code: 'permission_denied' });
    const { client, request } = fakeClient(denied);
    await expect(withProvisioning(client).request('GET', 'children/')).rejects.toBe(denied);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('never retries me/ itself', async () => {
    const { client, request } = fakeClient(notProvisioned());
    await expect(withProvisioning(client).request('GET', 'me/')).rejects.toMatchObject({
      code: 'account_not_provisioned',
    });
    expect(request).toHaveBeenCalledTimes(1);
  });
});
