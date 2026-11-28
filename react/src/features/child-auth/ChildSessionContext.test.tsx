import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { childPrincipal, setChildPrincipal } from '../../api/childPrincipal';
import type { AuthStatus } from '../auth/AuthContext';
import { ChildSessionProvider, useChildSession } from './ChildSessionContext';
import type { ChildSession, ChildSessionApi, SessionResult } from './childSessionApi';

const auth = vi.hoisted(() => ({ status: 'unauthenticated' as AuthStatus }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ status: auth.status }) }));

const session = (csrf: string): ChildSession => ({
  child: { id: 'c1', nickname: 'Bramble', ageBand: 'SPROUTS', avatarKey: 'fox' },
  csrfToken: csrf,
  expiresAt: '',
  remembered: true,
});
const ok = (csrf: string): SessionResult => ({ ok: true, session: session(csrf) });
const none: SessionResult = { ok: false, failure: 'no_session' };

function makeApi(read: SessionResult, restore: SessionResult): ChildSessionApi {
  return {
    read: vi.fn(async () => read),
    restore: vi.fn(async () => restore),
    create: vi.fn(),
    end: vi.fn(async () => undefined),
  };
}

function Probe() {
  const { status, child, signOut } = useChildSession();
  return (
    <div>
      <p>status:{status}</p>
      <p>child:{child?.id ?? 'none'}</p>
      <button onClick={() => void signOut()}>out</button>
    </div>
  );
}

function renderWith(api: ChildSessionApi) {
  return render(
    <ChildSessionProvider api={api}>
      <Probe />
    </ChildSessionProvider>,
  );
}

describe('ChildSessionProvider', () => {
  beforeEach(() => {
    auth.status = 'unauthenticated';
    setChildPrincipal(null);
  });

  it('takes the server session and arms the API principal', async () => {
    const api = makeApi(ok('csrf-a'), none);
    renderWith(api);
    expect(await screen.findByText('status:signedIn')).toBeInTheDocument();
    expect(screen.getByText('child:c1')).toBeInTheDocument();
    expect(childPrincipal.csrfToken()).toBe('csrf-a');
    expect(api.restore).not.toHaveBeenCalled();
  });

  it('tries to restore a remembered device once when there is no session', async () => {
    const api = makeApi(none, ok('csrf-r'));
    renderWith(api);
    expect(await screen.findByText('status:signedIn')).toBeInTheDocument();
    expect(api.restore).toHaveBeenCalledTimes(1);
    expect(childPrincipal.csrfToken()).toBe('csrf-r');
  });

  it('is signed out when both the read and the restore fail', async () => {
    const api = makeApi(none, none);
    renderWith(api);
    expect(await screen.findByText('status:signedOut')).toBeInTheDocument();
    expect(api.restore).toHaveBeenCalledTimes(1);
    expect(childPrincipal.csrfToken()).toBeNull();
  });

  it('does not restore after a network failure', async () => {
    const api = makeApi({ ok: false, failure: 'network' }, ok('x'));
    renderWith(api);
    expect(await screen.findByText('status:signedOut')).toBeInTheDocument();
    expect(api.restore).not.toHaveBeenCalled();
  });

  it('never reads a child session while a parent is signed in', async () => {
    auth.status = 'authenticated';
    const api = makeApi(ok('csrf-a'), ok('csrf-b'));
    renderWith(api);
    await waitFor(() => expect(screen.getByText('status:signedOut')).toBeInTheDocument());
    expect(api.read).not.toHaveBeenCalled();
    expect(childPrincipal.csrfToken()).toBeNull();
  });

  it('signs out on the server with the CSRF token, then clears the principal', async () => {
    const api = makeApi(ok('csrf-a'), none);
    renderWith(api);
    await screen.findByText('status:signedIn');
    await act(async () => screen.getByRole('button', { name: 'out' }).click());
    expect(api.end).toHaveBeenCalledWith('csrf-a');
    expect(await screen.findByText('status:signedOut')).toBeInTheDocument();
    expect(childPrincipal.csrfToken()).toBeNull();
  });

  it('shares one restore between concurrent callers (the API client path)', async () => {
    const api = makeApi(ok('csrf-a'), ok('csrf-new'));
    renderWith(api);
    await screen.findByText('status:signedIn');
    const [first, second] = await Promise.all([childPrincipal.restore(), childPrincipal.restore()]);
    expect([first, second]).toEqual(['csrf-new', 'csrf-new']);
    expect(api.restore).toHaveBeenCalledTimes(1);
  });
});
