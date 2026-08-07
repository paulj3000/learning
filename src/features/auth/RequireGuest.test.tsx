import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { RequireGuest } from './RequireGuest';
import { useAuth } from './AuthContext';
import type { AuthStatus } from './AuthContext';

vi.mock('./AuthContext', () => ({
  useAuth: vi.fn(),
}));

const useAuthMock = vi.mocked(useAuth);

function renderAtSignIn(status: AuthStatus) {
  useAuthMock.mockReturnValue({
    status,
    userId: status === 'authenticated' ? 'parent-1' : null,
    refresh: vi.fn(),
    signOut: vi.fn(),
  });

  return render(
    <MemoryRouter initialEntries={['/sign-in']}>
      <Routes>
        <Route
          path="/sign-in"
          element={
            <RequireGuest>
              <p>Sign-in form</p>
            </RequireGuest>
          }
        />
        <Route path="/parent" element={<p>Parent dashboard</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('RequireGuest', () => {
  it('renders the guarded content when unauthenticated', () => {
    renderAtSignIn('unauthenticated');
    expect(screen.getByText('Sign-in form')).toBeInTheDocument();
  });

  it('renders the guarded content when the backend is unconfigured', () => {
    renderAtSignIn('unconfigured');
    expect(screen.getByText('Sign-in form')).toBeInTheDocument();
  });

  it('shows a loading state instead of the form while auth status is loading', () => {
    renderAtSignIn('loading');
    expect(screen.getByText(/loading your account/i)).toBeInTheDocument();
    expect(screen.queryByText('Sign-in form')).not.toBeInTheDocument();
  });

  it('redirects an already-authenticated parent away from the sign-in form', () => {
    renderAtSignIn('authenticated');
    expect(screen.getByText('Parent dashboard')).toBeInTheDocument();
    expect(screen.queryByText('Sign-in form')).not.toBeInTheDocument();
  });
});
