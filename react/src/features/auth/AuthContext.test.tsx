import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchAuthSession, getCurrentUser } from 'aws-amplify/auth';
import { Hub } from 'aws-amplify/utils';
import { AuthProvider, useAuth } from './AuthContext';
import { endReauthentication, verifyRecentSignIn } from './recentSignIn/recentSignIn';

vi.mock('../../lib/amplify-config', () => ({ isAmplifyConfigured: true }));
vi.mock('aws-amplify/auth', () => ({
  fetchAuthSession: vi.fn(),
  getCurrentUser: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock('aws-amplify/utils', () => ({ Hub: { listen: vi.fn() } }));

type HubCallback = (capsule: { payload: { event: string } }) => void;
let hubCallback: HubCallback = () => undefined;

function Probe() {
  const { status } = useAuth();
  return <p>status:{status}</p>;
}

beforeEach(() => {
  endReauthentication();
  vi.mocked(Hub.listen).mockImplementation(((_channel: string, callback: HubCallback) => {
    hubCallback = callback;
    return () => undefined;
  }) as unknown as typeof Hub.listen);
  vi.mocked(getCurrentUser).mockResolvedValue({ userId: 'u1', username: 'u1' });
  vi.mocked(fetchAuthSession).mockResolvedValue({ tokens: undefined } as never);
});

describe('AuthContext during a recent sign-in verification (LAI-0209)', () => {
  it('ignores the deliberate sign-out and re-reads the session quietly when it ends', async () => {
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    expect(await screen.findByText('status:authenticated')).toBeInTheDocument();
    const deps = {
      getCurrentUser: vi.fn(async () => ({ userId: 'u1', username: 'u1' })),
      signOut: vi.fn(async () => undefined),
      signIn: vi.fn(async () => ({ isSignedIn: true, nextStep: { signInStep: 'DONE' } })),
    };
    await verifyRecentSignIn({ userId: 'u1', loginId: 'p@example.com' }, 'pw', deps);

    vi.mocked(getCurrentUser).mockClear();
    act(() => hubCallback({ payload: { event: 'signedOut' } }));
    act(() => hubCallback({ payload: { event: 'signedIn' } }));
    expect(getCurrentUser).not.toHaveBeenCalled();
    expect(screen.getByText('status:authenticated')).toBeInTheDocument();

    act(() => endReauthentication());
    await waitFor(() => expect(getCurrentUser).toHaveBeenCalledTimes(1));
    expect(screen.getByText('status:authenticated')).toBeInTheDocument();
    expect(screen.queryByText('status:loading')).not.toBeInTheDocument();
  });

  it('signs the page out when the verification ends without a session', async () => {
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    expect(await screen.findByText('status:authenticated')).toBeInTheDocument();
    await verifyRecentSignIn({ userId: 'u1', loginId: 'p' }, 'pw', {
      getCurrentUser: vi.fn(async () => ({ userId: 'u1', username: 'u1' })),
      signOut: vi.fn(async () => undefined),
      signIn: vi.fn(async () => {
        throw Object.assign(new Error('no'), { name: 'NotAuthorizedException' });
      }),
    });
    vi.mocked(getCurrentUser).mockRejectedValue(new Error('signed out'));
    act(() => endReauthentication());
    expect(await screen.findByText('status:unauthenticated')).toBeInTheDocument();
  });

  it('still follows ordinary sign-in and sign-out events', async () => {
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    expect(await screen.findByText('status:authenticated')).toBeInTheDocument();
    vi.mocked(getCurrentUser).mockRejectedValue(new Error('signed out'));
    act(() => hubCallback({ payload: { event: 'signedOut' } }));
    expect(await screen.findByText('status:unauthenticated')).toBeInTheDocument();
  });
});
