import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../api/client';
import { ApiError } from '../../api/errors';
import { createDjangoAuthAdapter, LocalSignInError } from './authAdapters';

vi.mock('aws-amplify/auth', () => ({
  fetchAuthSession: vi.fn(),
  getCurrentUser: vi.fn(),
  signOut: vi.fn(),
}));

function setup(request: ApiClient['request']) {
  const client: ApiClient = { request: vi.fn(request) };
  const session = { csrfToken: vi.fn(async () => 'csrf'), reset: vi.fn() };
  const adapter = createDjangoAuthAdapter({ client, session });
  return { adapter, client, session };
}

describe('createDjangoAuthAdapter', () => {
  it('reads the signed-in parent from GET me/', async () => {
    const { adapter, client } = setup(async () => ({ status: 200, data: { id: 'acct-1' } }));
    expect(adapter.mode).toBe('django');
    expect(adapter.configured).toBe(true);
    await expect(adapter.getCurrentUser()).resolves.toEqual({
      userId: 'acct-1',
      isAdmin: false,
      isSuperuser: false,
    });
    expect(client.request).toHaveBeenCalledWith('GET', 'me/');
  });

  it('reports nobody when Django says not signed in', async () => {
    const { adapter } = setup(async () => {
      throw new ApiError('unauthenticated', { status: 401 });
    });
    await expect(adapter.getCurrentUser()).resolves.toBeNull();
  });

  it('signs in with the credentials, resets the CSRF token and tells listeners', async () => {
    const { adapter, client, session } = setup(async () => ({ status: 200, data: {} }));
    const onChange = vi.fn();
    const stop = adapter.listen(onChange);
    await adapter.login?.('dev-parent', 'secret-password');
    expect(client.request).toHaveBeenCalledWith('POST', 'auth/login/', {
      body: { username: 'dev-parent', password: 'secret-password' },
    });
    expect(session.reset).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenCalledTimes(1);
    stop();
    await adapter.login?.('dev-parent', 'secret-password');
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('turns refused credentials into invalid_credentials and nothing else', async () => {
    const refused = setup(async () => {
      throw new ApiError('invalid_request', { status: 400, code: 'invalid_credentials' });
    });
    await expect(refused.adapter.login?.('a', 'b')).rejects.toMatchObject({
      reason: 'invalid_credentials',
    });
    const offline = setup(async () => {
      throw new ApiError('network');
    });
    const error = await offline.adapter.login?.('a', 'b').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LocalSignInError);
    expect((error as LocalSignInError).reason).toBe('unavailable');
  });

  it('signs out through POST auth/logout/ and forgets the CSRF token', async () => {
    const { adapter, client, session } = setup(async () => ({ status: 204, data: null }));
    const onChange = vi.fn();
    adapter.listen(onChange);
    await adapter.logout();
    expect(client.request).toHaveBeenCalledWith('POST', 'auth/logout/');
    expect(session.reset).toHaveBeenCalled();
    expect(onChange).toHaveBeenCalled();
  });
});
