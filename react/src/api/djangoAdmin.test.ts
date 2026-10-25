import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from './client';
import { ApiError } from './errors';
import { fetchDjangoAdminAccess, readDjangoAdminUrl } from './djangoAdmin';

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

describe('fetchDjangoAdminAccess', () => {
  it('is true only when Django reports django_admin: true', async () => {
    const client = clientReturning(async () => ({
      status: 200,
      data: { id: 'p', django_admin: true },
    }));
    await expect(fetchDjangoAdminAccess(client)).resolves.toBe(true);
    expect(client.request).toHaveBeenCalledWith('GET', 'me/', { signal: undefined });
  });

  it.each([{ id: 'p', django_admin: false }, { id: 'p', django_admin: 'true' }, { id: 'p' }, null])(
    'is false for %j',
    async (data) => {
      await expect(
        fetchDjangoAdminAccess(clientReturning(async () => ({ status: 200, data }))),
      ).resolves.toBe(false);
    },
  );

  it('is false on any API error (signed out, not provisioned, offline)', async () => {
    for (const kind of ['unauthenticated', 'forbidden', 'network'] as const) {
      const client = clientReturning(() => Promise.reject(new ApiError(kind)));
      await expect(fetchDjangoAdminAccess(client)).resolves.toBe(false);
    }
  });
});
