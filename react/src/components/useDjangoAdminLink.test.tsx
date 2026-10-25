import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from '../features/auth/AuthContext';
import { useDjangoAdminLink } from './useDjangoAdminLink';

vi.mock('../features/auth/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../api/auth', () => ({ getAccessToken: vi.fn(async () => 'access-token') }));

const useAuthMock = vi.mocked(useAuth);
const ADMIN_URL = 'https://api.example.test/admin/';
const DJANGO = { enabled: true as const, baseUrl: 'https://api.example.test' };

function signedIn(status: 'authenticated' | 'unauthenticated' = 'authenticated') {
  useAuthMock.mockReturnValue({
    status,
    userId: status === 'authenticated' ? 'parent-1' : null,
    // Even an Amplify Admins-group flag must not show the Django link on its own.
    isAdmin: true,
    isSuperuser: true,
    refresh: vi.fn(),
    signOut: vi.fn(),
  });
}

function djangoReplies(body: unknown, status = 200) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('useDjangoAdminLink', () => {
  beforeEach(() => signedIn());
  afterEach(() => vi.unstubAllGlobals());

  it('returns the admin URL once Django confirms staff', async () => {
    const fetchMock = djangoReplies({ id: 'p', django_admin: true });
    const { result } = renderHook(() => useDjangoAdminLink(DJANGO, ADMIN_URL));
    await waitFor(() => expect(result.current).toBe(ADMIN_URL));
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/api/v1/me/',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: 'Bearer access-token' }),
      }),
    );
  });

  it('stays null when Django says the account is not staff', async () => {
    const fetchMock = djangoReplies({ id: 'p', django_admin: false });
    const { result } = renderHook(() => useDjangoAdminLink(DJANGO, ADMIN_URL));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });

  it('stays null when Django refuses the request', async () => {
    const fetchMock = djangoReplies({ error: { code: 'account_not_provisioned' } }, 403);
    const { result } = renderHook(() => useDjangoAdminLink(DJANGO, ADMIN_URL));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });

  it('never asks Django when the build has no Django API or no admin URL, or nobody is signed in', () => {
    const fetchMock = djangoReplies({ django_admin: true });
    expect(renderHook(() => useDjangoAdminLink({ enabled: false }, ADMIN_URL)).result.current).toBe(
      null,
    );
    expect(renderHook(() => useDjangoAdminLink(DJANGO, null)).result.current).toBeNull();
    signedIn('unauthenticated');
    expect(renderHook(() => useDjangoAdminLink(DJANGO, ADMIN_URL)).result.current).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
