import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from './AuthContext';
import { LocalSignInError, type AuthAdapter, type AuthUser } from './authAdapters';
import { LOCAL_SIGN_IN_COPY } from './LocalSignInForm';
import { SignIn } from '../../routes/SignIn';

vi.mock('aws-amplify/auth', () => ({
  fetchAuthSession: vi.fn(),
  getCurrentUser: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

/** An in-memory Django-mode adapter: one valid username and password. */
function fakeDjangoAdapter(options: { offline?: boolean } = {}) {
  let user: AuthUser | null = null;
  const listeners = new Set<() => void>();
  const adapter: AuthAdapter = {
    mode: 'django',
    configured: true,
    getCurrentUser: vi.fn(async () => user),
    login: vi.fn(async (username: string, password: string) => {
      if (options.offline) throw new LocalSignInError('unavailable');
      if (username !== 'dev-parent' || password !== 'right-password') {
        throw new LocalSignInError('invalid_credentials');
      }
      user = { userId: 'acct-1', isAdmin: false, isSuperuser: false };
    }),
    logout: vi.fn(async () => {
      user = null;
    }),
    listen: (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
  };
  return adapter;
}

function Home() {
  const { status, userId, signOut } = useAuth();
  return (
    <div>
      <p>
        {status}:{userId}
      </p>
      <button type="button" onClick={() => void signOut()}>
        Sign out
      </button>
    </div>
  );
}

function renderSignIn(adapter: AuthAdapter) {
  return render(
    <AuthProvider adapter={adapter}>
      <MemoryRouter initialEntries={['/sign-in']}>
        <Routes>
          <Route path="/sign-in" element={<SignIn />} />
          <Route path="/home" element={<Home />} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
}

describe('local Django sign-in (ADR-038)', () => {
  it('shows the username form, not the Amplify email form, in Django mode', async () => {
    renderSignIn(fakeDjangoAdapter());
    expect(await screen.findByLabelText(LOCAL_SIGN_IN_COPY.username)).toBeInTheDocument();
    expect(screen.queryByLabelText(/email address/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/create an account/i)).not.toBeInTheDocument();
  });

  it('signs in, lands on the home page and signs out again', async () => {
    const adapter = fakeDjangoAdapter();
    const user = userEvent.setup();
    renderSignIn(adapter);
    await user.type(await screen.findByLabelText(LOCAL_SIGN_IN_COPY.username), ' dev-parent ');
    await user.type(screen.getByLabelText(LOCAL_SIGN_IN_COPY.password), 'right-password');
    await user.click(screen.getByRole('button', { name: LOCAL_SIGN_IN_COPY.submit }));
    expect(await screen.findByText('authenticated:acct-1')).toBeInTheDocument();
    expect(adapter.login).toHaveBeenCalledWith('dev-parent', 'right-password');
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(screen.getByText('unauthenticated:')).toBeInTheDocument());
    expect(adapter.logout).toHaveBeenCalled();
  });

  it('says so when the credentials are refused', async () => {
    const user = userEvent.setup();
    renderSignIn(fakeDjangoAdapter());
    await user.type(await screen.findByLabelText(LOCAL_SIGN_IN_COPY.username), 'dev-parent');
    await user.type(screen.getByLabelText(LOCAL_SIGN_IN_COPY.password), 'wrong');
    await user.click(screen.getByRole('button', { name: LOCAL_SIGN_IN_COPY.submit }));
    expect(await screen.findByRole('alert')).toHaveTextContent(LOCAL_SIGN_IN_COPY.refused);
  });

  it('tells a developer when Django cannot be reached', async () => {
    const user = userEvent.setup();
    renderSignIn(fakeDjangoAdapter({ offline: true }));
    await user.type(await screen.findByLabelText(LOCAL_SIGN_IN_COPY.username), 'dev-parent');
    await user.type(screen.getByLabelText(LOCAL_SIGN_IN_COPY.password), 'right-password');
    await user.click(screen.getByRole('button', { name: LOCAL_SIGN_IN_COPY.submit }));
    expect(await screen.findByRole('alert')).toHaveTextContent(LOCAL_SIGN_IN_COPY.unavailable);
  });

  it('asks for both fields before calling Django', async () => {
    const adapter = fakeDjangoAdapter();
    const user = userEvent.setup();
    renderSignIn(adapter);
    await user.click(await screen.findByRole('button', { name: LOCAL_SIGN_IN_COPY.submit }));
    expect(screen.getByRole('alert')).toHaveTextContent(LOCAL_SIGN_IN_COPY.missing);
    expect(adapter.login).not.toHaveBeenCalled();
  });
});
