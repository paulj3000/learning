import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { RequireAdmin } from './RequireAdmin';
import { useAuth } from './AuthContext';
import type { AuthStatus } from './AuthContext';

vi.mock('./AuthContext', () => ({
  useAuth: vi.fn(),
}));

const useAuthMock = vi.mocked(useAuth);

function renderAtAdmin(status: AuthStatus, isAdmin: boolean) {
  useAuthMock.mockReturnValue({
    status,
    userId: status === 'authenticated' ? 'user-1' : null,
    isAdmin,
    refresh: vi.fn(),
    signOut: vi.fn(),
  });

  return render(
    <MemoryRouter initialEntries={['/admin']}>
      <Routes>
        <Route
          path="/admin"
          element={
            <RequireAdmin>
              <p>Admin dashboard</p>
            </RequireAdmin>
          }
        />
        <Route path="/sign-in" element={<p>Sign-in form</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('RequireAdmin', () => {
  it('renders the guarded content for an authenticated admin', () => {
    renderAtAdmin('authenticated', true);
    expect(screen.getByText('Admin dashboard')).toBeInTheDocument();
  });

  it('shows a not-authorized message for an authenticated non-admin', () => {
    renderAtAdmin('authenticated', false);
    expect(screen.getByText(/not authorized/i)).toBeInTheDocument();
    expect(screen.queryByText('Admin dashboard')).not.toBeInTheDocument();
  });

  it('redirects an unauthenticated visitor to sign-in', () => {
    renderAtAdmin('unauthenticated', false);
    expect(screen.getByText('Sign-in form')).toBeInTheDocument();
    expect(screen.queryByText('Admin dashboard')).not.toBeInTheDocument();
  });

  it('shows a loading state while auth status is loading', () => {
    renderAtAdmin('loading', false);
    expect(screen.getByText(/loading your account/i)).toBeInTheDocument();
    expect(screen.queryByText('Admin dashboard')).not.toBeInTheDocument();
  });

  it('shows a backend-not-connected message when unconfigured', () => {
    renderAtAdmin('unconfigured', false);
    expect(screen.getByText(/not connected yet/i)).toBeInTheDocument();
  });
});
