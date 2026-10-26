import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  getCurrentAuthSession: vi.fn(),
  onAuthChange: vi.fn(),
  signOut: vi.fn(),
  listener: null as null | ((change: 'signedIn' | 'signedOut') => void),
}));

vi.mock('../../api/auth', () => ({
  isAuthConfigured: true,
  getCurrentAuthSession: auth.getCurrentAuthSession,
  onAuthChange: (listener: (change: 'signedIn' | 'signedOut') => void) => {
    auth.listener = listener;
    return auth.onAuthChange;
  },
  signOut: auth.signOut,
}));

import { AuthProvider, useAuth } from './AuthContext';

function Probe() {
  const { status, userId, isAdmin, signOut } = useAuth();
  return (
    <div>
      <p>{`${status}:${userId ?? 'none'}:${isAdmin ? 'admin' : 'parent'}`}</p>
      <button type="button" onClick={() => void signOut()}>
        Sign out
      </button>
    </div>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AuthProvider on the API auth module (LAI-0501A)', () => {
  it('reports the signed-in parent and their admin group', async () => {
    auth.getCurrentAuthSession.mockResolvedValue({ userId: 'sub-1', groups: ['Admins'] });
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    expect(await screen.findByText('authenticated:sub-1:admin')).toBeInTheDocument();
  });

  it('is unauthenticated when there is no session', async () => {
    auth.getCurrentAuthSession.mockResolvedValue(null);
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    expect(await screen.findByText('unauthenticated:none:parent')).toBeInTheDocument();
  });

  it('re-reads the session on a sign-in event and after signing out', async () => {
    auth.getCurrentAuthSession.mockResolvedValueOnce(null);
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText('unauthenticated:none:parent');

    auth.getCurrentAuthSession.mockResolvedValueOnce({ userId: 'sub-1', groups: undefined });
    act(() => auth.listener?.('signedIn'));
    expect(await screen.findByText('authenticated:sub-1:parent')).toBeInTheDocument();

    auth.getCurrentAuthSession.mockResolvedValueOnce(null);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(auth.signOut).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('unauthenticated:none:parent')).toBeInTheDocument();
  });
});
