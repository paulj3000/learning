import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChildSession, ChildSessionApi } from './childSessionApi';
import { ChildSignInForm } from './ChildSignInForm';

const cognito = vi.hoisted(() => ({
  signIn: vi.fn(),
  getTokens: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock('../../lib/cognito', () => ({
  isChildCognitoConfigured: true,
  createChildCognitoAuth: () => cognito,
}));
const adopt = vi.fn();
vi.mock('./ChildSessionContext', () => ({
  useChildSession: () => ({ status: 'signedOut', child: null, csrfToken: null, adopt }),
}));

const SESSION: ChildSession = {
  child: { id: 'child-9', nickname: 'Bramble', ageBand: 'PATHFINDERS', avatarKey: 'fox' },
  csrfToken: 'csrf',
  expiresAt: '2026-12-01T00:00:00Z',
  remembered: false,
};

function api(overrides: Partial<ChildSessionApi> = {}): ChildSessionApi {
  return {
    read: vi.fn(),
    restore: vi.fn(),
    end: vi.fn(),
    create: vi.fn(async () => ({ ok: true as const, session: SESSION })),
    ...overrides,
  };
}

function renderForm(sessionApi: ChildSessionApi) {
  return render(
    <MemoryRouter initialEntries={['/sign-in']}>
      <Routes>
        <Route path="/sign-in" element={<ChildSignInForm headingId="h" api={sessionApi} />} />
        <Route path="/island/:childId/realms" element={<p>Realm Explorer</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function fill(user: ReturnType<typeof userEvent.setup>, name = 'Bramble.fox') {
  await user.type(screen.getByLabelText('Username'), name);
  await user.type(screen.getByLabelText('Password'), 'correct horse');
}

describe('ChildSignInForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    cognito.signIn.mockResolvedValue({ isSignedIn: true, nextStep: { signInStep: 'DONE' } });
    cognito.getTokens.mockResolvedValue({ accessToken: 'child-access' });
    cognito.signOut.mockResolvedValue(undefined);
  });

  it('signs in, opens the server session, and routes to the session child', async () => {
    const sessionApi = api();
    const user = userEvent.setup();
    renderForm(sessionApi);
    await fill(user);
    await user.click(screen.getByLabelText('Remember me on this device'));
    await user.click(screen.getByRole('button', { name: 'Start my adventure' }));

    expect(await screen.findByText('Realm Explorer')).toBeInTheDocument();
    expect(cognito.signIn).toHaveBeenCalledWith({
      username: 'bramble.fox',
      password: 'correct horse',
    });
    expect(sessionApi.create).toHaveBeenCalledWith('child-access', true);
    expect(adopt).toHaveBeenCalledWith(SESSION);
    // The child's Cognito session is discarded, and nothing was written to localStorage.
    expect(cognito.signOut).toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
  });

  it('shows ask-your-grown-up copy and clears the password when sign-in fails', async () => {
    cognito.signIn.mockRejectedValueOnce(
      Object.assign(new Error('x'), { name: 'NotAuthorizedException' }),
    );
    const user = userEvent.setup();
    renderForm(api());
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Start my adventure' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/ask your grown-up/i);
    expect(screen.getByLabelText('Password')).toHaveValue('');
    expect(adopt).not.toHaveBeenCalled();
  });

  it('treats any challenge other than DONE as an error', async () => {
    cognito.signIn.mockResolvedValueOnce({
      isSignedIn: false,
      nextStep: { signInStep: 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED' },
    });
    const sessionApi = api();
    const user = userEvent.setup();
    renderForm(sessionApi);
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Start my adventure' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/ask your grown-up/i);
    expect(sessionApi.create).not.toHaveBeenCalled();
  });

  it('says to ask a grown-up when the server refuses the sign-in', async () => {
    const user = userEvent.setup();
    renderForm(
      api({ create: vi.fn(async () => ({ ok: false as const, failure: 'unavailable' as const })) }),
    );
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Start my adventure' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/ask your grown-up/i);
    await waitFor(() => expect(screen.getByLabelText('Password')).toHaveValue(''));
  });

  it('does not call Cognito without a username and password', async () => {
    const user = userEvent.setup();
    renderForm(api());
    await user.click(screen.getByRole('button', { name: 'Start my adventure' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/username and your password/i);
    expect(cognito.signIn).not.toHaveBeenCalled();
  });

  it('tells a child to ask their grown-up if they forgot their password', () => {
    renderForm(api());
    expect(screen.getByText(/forgot your password\? ask your grown-up/i)).toBeInTheDocument();
  });
});
