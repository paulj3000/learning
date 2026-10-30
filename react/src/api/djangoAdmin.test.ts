import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from './client';
import { ApiError } from './errors';
import { provisionDjangoAccount, readDjangoAdminUrl } from './djangoAdmin';

describe('readDjangoAdminUrl', () => {
  it('is off unless configured', () => {
    expect(readDjangoAdminUrl({})).toBeNull();
    expect(readDjangoAdminUrl({ VITE_DJANGO_ADMIN_URL: '  ' })).toBeNull();
  });

  it('accepts an https admin URL ending in a slash', () => {
    expect(readDjangoAdminUrl({ VITE_DJANGO_ADMIN_URL: 'https://api.example.test/admin/' })).toBe(
      'https://api.example.test/admin/',
    );
  });

  it.each([
    'http://api.example.test/admin/',
    'https://api.example.test/admin',
    'https://api.example.test/admin/?next=/x',
    'https://api.example.test/admin/#top',
    'https://user:pw@api.example.test/admin/',
    'javascript:alert(1)//',
    'not a url',
  ])('rejects %s in a production build', (value) => {
    expect(readDjangoAdminUrl({ VITE_DJANGO_ADMIN_URL: value })).toBeNull();
  });

  it('allows http only under vite dev', () => {
    expect(
      readDjangoAdminUrl({ VITE_DJANGO_ADMIN_URL: 'http://localhost:8000/admin/', DEV: true }),
    ).toBe('http://localhost:8000/admin/');
  });
});

function clientReturning(result: () => Promise<{ status: number; data: unknown }>): ApiClient {
  return { request: vi.fn(result) };
}

describe('provisionDjangoAccount', () => {
  it('POSTs me/ and returns the account with Django\'s staff flag', async () => {
    const client = clientReturning(async () => ({
      status: 201,
      data: { id: 'account-1', django_admin: true },
    }));
    await expect(provisionDjangoAccount(client)).resolves.toEqual({
      id: 'account-1',
      djangoAdmin: true,
    });
    expect(client.request).toHaveBeenCalledWith('POST', 'me/', { signal: undefined });
  });

  it.each([
    [{ id: 'account-1', django_admin: false }, { id: 'account-1', djangoAdmin: false }],
    [{ id: 'account-1', django_admin: 'true' }, { id: 'account-1', djangoAdmin: false }],
    [{ id: 'account-1' }, { id: 'account-1', djangoAdmin: false }],
    [{ django_admin: true }, null],
    [{ id: '', django_admin: true }, null],
    [null, null],
  ])('reads %j as %j', async (data, expected) => {
    await expect(
      provisionDjangoAccount(clientReturning(async () => ({ status: 200, data }))),
    ).resolves.toEqual(expected);
  });

  it('is null on any API error', async () => {
    for (const kind of ['unauthenticated', 'forbidden', 'network', 'unavailable'] as const) {
      const client = clientReturning(() => Promise.reject(new ApiError(kind)));
      await expect(provisionDjangoAccount(client)).resolves.toBeNull();
    }
  });
});
