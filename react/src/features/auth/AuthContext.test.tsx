import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, adminAccessFromGroups, useAuth } from './AuthContext';
import { endReauthentication, verifyRecentSignIn } from './recentSignIn/recentSignIn';

const fake = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getTokens: vi.fn(),
  onEvent: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock('../../lib/cognito', () => ({ cognitoAuth: () => fake, isCognitoConfigured: true }));
const getCurrentUser = fake.getCurrentUser;

type EventCallback = (event: string) => void;
let eventCallback: EventCallback = () => undefined;
const hubCallback = ({ payload }: { payload: { event: string } }) => eventCallback(payload.event);

function Probe() {
  const { status } = useAuth();
  return <p>status:{status}</p>;
}

beforeEach(() => {
  endReauthentication();
  fake.onEvent.mockImplementation((callback: EventCallback) => {
    eventCallback = callback;
    return () => undefined;
  });
  getCurrentUser.mockReset();
  getCurrentUser.mockResolvedValue({ userId: 'u1', username: 'u1' });
  fake.getTokens.mockResolvedValue(null);
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

    getCurrentUser.mockClear();
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
    getCurrentUser.mockRejectedValue(new Error('signed out'));
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
    getCurrentUser.mockRejectedValue(new Error('signed out'));
    act(() => hubCallback({ payload: { event: 'signedOut' } }));
    expect(await screen.findByText('status:unauthenticated')).toBeInTheDocument();
  });
});

describe('AuthContext admin flags', () => {
  it('reads the groups from the ID token claims', async () => {
    fake.getTokens.mockResolvedValue({ idClaims: { 'cognito:groups': ['Admins', 'Superusers'] } });
    function Flags() {
      const { isAdmin, isSuperuser } = useAuth();
      return <p>{`admin:${isAdmin} super:${isSuperuser}`}</p>;
    }
    render(
      <AuthProvider>
        <Flags />
      </AuthProvider>,
    );
    expect(await screen.findByText('admin:true super:true')).toBeInTheDocument();
  });

  it('a Superuser outside Admins gets neither flag', () => {
    expect(adminAccessFromGroups(['Superusers'])).toEqual({ isAdmin: false, isSuperuser: false });
    expect(adminAccessFromGroups(undefined)).toEqual({ isAdmin: false, isSuperuser: false });
  });
});
