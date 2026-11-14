import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { RequireAdmin } from './RequireAdmin';
import { adminAccessFromGroups, useAuth } from './AuthContext';
import type { AuthStatus } from './AuthContext';

vi.mock('./AuthContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./AuthContext')>()),
  useAuth: vi.fn(),
}));

const useAuthMock = vi.mocked(useAuth);

function renderAt(path: string, status: AuthStatus, isAdmin: boolean, isSuperuser = false) {
  useAuthMock.mockReturnValue({
    status,
    userId: status === 'authenticated' ? 'user-1' : null,
    isAdmin,
    isSuperuser,
    refresh: vi.fn(),
    signOut: vi.fn(),
  });

  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/admin/*"
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
    renderAt('/admin', 'authenticated', true);
    expect(screen.getByText('Admin dashboard')).toBeInTheDocument();
  });

  it('renders the guarded content for a superuser', () => {
    renderAt('/admin', 'authenticated', true, true);
    expect(screen.getByText('Admin dashboard')).toBeInTheDocument();
  });

  it.each(['/admin', '/admin/islands', '/admin/islands/123', '/admin/adventures/456'])(
    'shows the standard 404 page to an authenticated non-admin at %s',
    (path) => {
      renderAt(path, 'authenticated', false);
      expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
      expect(screen.queryByText('Admin dashboard')).not.toBeInTheDocument();
      expect(screen.queryByText(/not authorized|access denied|forbidden|permission/i)).toBeNull();
    },
  );

  it('redirects an unauthenticated visitor to sign-in', () => {
    renderAt('/admin', 'unauthenticated', false);
    expect(screen.getByText('Sign-in form')).toBeInTheDocument();
    expect(screen.queryByText('Admin dashboard')).not.toBeInTheDocument();
  });

  it('shows a loading state, and no admin content, while auth status is loading', () => {
    renderAt('/admin', 'loading', false);
    expect(screen.getByText(/loading your account/i)).toBeInTheDocument();
    expect(screen.queryByText('Admin dashboard')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Page not found' })).toBeNull();
  });

  it('shows a friendly sign-in-unavailable message, never setup commands, when unconfigured', () => {
    renderAt('/admin', 'unconfigured', false);
    expect(
      screen.getByRole('heading', { name: /parent sign-in is not available/i }),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/amplify|sandbox|npm run/i);
  });

  it('offers to try again when Cognito did not answer in time', () => {
    renderAt('/admin', 'unavailable', false);
    expect(
      screen.getByRole('heading', { name: /could not reach parent sign-in/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.queryByText('Admin dashboard')).not.toBeInTheDocument();
  });
});

describe('adminAccessFromGroups', () => {
  it.each([
    [undefined, false, false],
    [[], false, false],
    [['Admins'], true, false],
    [['Admins', 'Superusers'], true, true],
    // Superusers alone cannot use an Admins-gated section, so neither flag is set.
    [['Superusers'], false, false],
    ['Admins', false, false],
  ])('groups %j -> isAdmin %s, isSuperuser %s', (groups, isAdmin, isSuperuser) => {
    expect(adminAccessFromGroups(groups)).toEqual({ isAdmin, isSuperuser });
  });
});
