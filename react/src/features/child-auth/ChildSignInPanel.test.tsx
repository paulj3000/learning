import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/errors';
import { ChildSignInPanel } from './ChildSignInPanel';
import type { SignInManagement, SignInOverview } from './signInManagementApi';

vi.mock('../../lib/cognito', () => ({
  cognitoAuth: () => ({
    getCurrentUser: async () => ({
      userId: 'u1',
      username: 'u1',
      signInDetails: { loginId: 'p@example.com' },
    }),
    signIn: vi.fn(),
    signOut: vi.fn(),
  }),
  isCognitoConfigured: true,
}));

const NONE: SignInOverview = {
  consent: { given: false, available: true },
  signIn: null,
  recentChanges: [],
};
const CONSENTED: SignInOverview = { ...NONE, consent: { given: true, available: true } };
const ACTIVE: SignInOverview = {
  consent: { given: true, available: true },
  signIn: {
    status: 'ACTIVE',
    username: 'bramble.fox',
    createdAt: '2026-11-20T10:00:00Z',
    passwordSetAt: '2026-11-20T10:00:00Z',
    activeSessions: 1,
    rememberedDevices: 1,
  },
  recentChanges: [{ action: 'sign_in_enabled', occurredAt: '2026-11-20T10:00:00Z' }],
};

function makeApi(
  initial: SignInOverview,
): SignInManagement & Record<string, ReturnType<typeof vi.fn>> {
  return {
    overview: vi.fn(async () => initial),
    giveConsent: vi.fn(async () => CONSENTED),
    withdrawConsent: vi.fn(async () => NONE),
    enable: vi.fn(async () => ACTIVE),
    changeUsername: vi.fn(async () => ACTIVE),
    resetPassword: vi.fn(async () => ACTIVE),
    suspend: vi.fn(async () => ({
      ...ACTIVE,
      signIn: { ...ACTIVE.signIn!, status: 'SUSPENDED' as const },
    })),
    resume: vi.fn(async () => ACTIVE),
    signOutEverywhere: vi.fn(async () => ACTIVE),
    remove: vi.fn(async () => CONSENTED),
    devices: vi.fn(async () => [
      {
        id: 'd1',
        rememberedAt: '2026-11-21T10:00:00Z',
        lastUsedAt: null,
        expiresAt: '2026-12-21T10:00:00Z',
      },
    ]),
    forgetDevice: vi.fn(async () => undefined),
  } as never;
}

function renderPanel(api: SignInManagement) {
  return render(
    <MemoryRouter>
      <ChildSignInPanel childId="c1" nickname="Bramble" management={api} />
    </MemoryRouter>,
  );
}

describe('ChildSignInPanel', () => {
  beforeEach(() => vi.clearAllMocks());

  it('explains that sign-in is unavailable when no consent text is approved', async () => {
    renderPanel(makeApi({ ...NONE, consent: { given: false, available: false } }));
    expect(await screen.findByText(/not available yet/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Give consent' })).not.toBeInTheDocument();
  });

  it('gives consent, then creates the sign-in with a confirmed password and clears the fields', async () => {
    const api = makeApi(NONE);
    vi.mocked(api.overview).mockResolvedValueOnce(NONE);
    const user = userEvent.setup();
    renderPanel(api);
    await user.click(await screen.findByRole('button', { name: 'Give consent' }));
    expect(api.giveConsent).toHaveBeenCalledWith('c1');

    await user.type(await screen.findByLabelText('Username'), 'Bramble.Fox');
    await user.type(screen.getByLabelText('Password'), 'sunny day 77');
    await user.type(screen.getByLabelText('Confirm password'), 'sunny day 77');
    await user.click(screen.getByRole('button', { name: 'Turn on sign-in' }));
    await waitFor(() =>
      expect(api.enable).toHaveBeenCalledWith('c1', 'bramble.fox', 'sunny day 77'),
    );
    expect(await screen.findByText('bramble.fox')).toBeInTheDocument();
    expect(screen.getByText(/On: can sign in/)).toBeInTheDocument();
  });

  it('rejects a mismatched confirmation and a password containing the username before calling', async () => {
    const api = makeApi(CONSENTED);
    const user = userEvent.setup();
    renderPanel(api);
    await user.type(await screen.findByLabelText('Username'), 'bramble.fox');
    await user.type(screen.getByLabelText('Password'), 'sunny day 77');
    await user.type(screen.getByLabelText('Confirm password'), 'different 77');
    await user.click(screen.getByRole('button', { name: 'Turn on sign-in' }));
    expect(await screen.findByText(/do not match/i)).toBeInTheDocument();
    expect(api.enable).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Password')).toHaveValue('');
  });

  it('shows the server error for a taken username', async () => {
    const api = makeApi(CONSENTED);
    vi.mocked(api.enable).mockRejectedValueOnce(
      new ApiError('conflict', { status: 409, code: 'login_name_unavailable' }),
    );
    const user = userEvent.setup();
    renderPanel(api);
    await user.type(await screen.findByLabelText('Username'), 'bramble.fox');
    await user.type(screen.getByLabelText('Password'), 'sunny day 77');
    await user.type(screen.getByLabelText('Confirm password'), 'sunny day 77');
    await user.click(screen.getByRole('button', { name: 'Turn on sign-in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/already taken/i);
  });

  it('pauses, signs out everywhere, and forgets a device', async () => {
    const api = makeApi(ACTIVE);
    const user = userEvent.setup();
    renderPanel(api);
    await user.click(await screen.findByRole('button', { name: 'Pause sign-in' }));
    expect(api.suspend).toHaveBeenCalledWith('c1');
    expect(await screen.findByRole('button', { name: 'Resume sign-in' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sign out everywhere' }));
    expect(api.signOutEverywhere).toHaveBeenCalledWith('c1');
    await user.click(await screen.findByRole('button', { name: 'Forget device 1' }));
    expect(api.forgetDevice).toHaveBeenCalledWith('c1', 'd1');
  });

  it('asks to confirm before removing the sign-in', async () => {
    const api = makeApi(ACTIVE);
    const user = userEvent.setup();
    renderPanel(api);
    await user.click(await screen.findByRole('button', { name: 'Remove sign-in' }));
    expect(api.remove).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Keep sign-in' }));
    expect(api.remove).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Remove sign-in' }));
    await user.click(screen.getByRole('button', { name: 'Yes, remove sign-in' }));
    await waitFor(() => expect(api.remove).toHaveBeenCalledWith('c1'));
  });

  it('opens the recent sign-in dialog when Django asks, and does not change anything on cancel', async () => {
    const api = makeApi(ACTIVE);
    vi.mocked(api.resetPassword).mockRejectedValueOnce(
      new ApiError('forbidden', { status: 403, code: 'recent_auth_required' }),
    );
    const user = userEvent.setup();
    renderPanel(api);
    await user.type(await screen.findByLabelText('New password'), 'another day 88');
    await user.type(screen.getByLabelText('Confirm new password'), 'another day 88');
    await user.click(screen.getByRole('button', { name: 'Reset password' }));
    expect(await screen.findByText('Please confirm it is you')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(screen.queryByText('Please confirm it is you')).not.toBeInTheDocument(),
    );
    expect(api.resetPassword).toHaveBeenCalledTimes(1);
  });

  it('lists recent changes and links to the existing controls', async () => {
    renderPanel(makeApi(ACTIVE));
    expect(await screen.findByText(/Sign-in turned on/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /voice and AI settings/i })).toHaveAttribute(
      'href',
      '/home/children/c1/edit',
    );
    expect(screen.getByRole('link', { name: /deletion/i })).toHaveAttribute(
      'href',
      '/home/children/c1/dashboard',
    );
  });
});
