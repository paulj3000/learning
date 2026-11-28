import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthStatus } from '../auth/AuthContext';
import { RequireParent } from '../auth/RequireParent';
import { RequireChildOrParent } from './RequireChildOrParent';

const state = vi.hoisted(() => ({
  auth: 'unauthenticated' as AuthStatus,
  child: { status: 'signedOut', child: null as null | { id: string } },
}));
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ status: state.auth, refresh: vi.fn() }),
}));
vi.mock('./ChildSessionContext', () => ({
  useChildSession: () => state.child,
}));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/island/:childId/library"
          element={
            <RequireChildOrParent>
              <p>Gameplay</p>
            </RequireChildOrParent>
          }
        />
        <Route path="/island/:childId/realms" element={<p>Own island</p>} />
        <Route
          path="/home"
          element={
            <RequireParent>
              <p>Parent dashboard</p>
            </RequireParent>
          }
        />
        <Route path="/sign-in" element={<p>Sign-in page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('guards with a child session', () => {
  beforeEach(() => {
    state.auth = 'unauthenticated';
    state.child = { status: 'signedOut', child: null };
  });

  it('lets a child session into their own gameplay route', () => {
    state.child = { status: 'signedIn', child: { id: 'c1' } };
    renderAt('/island/c1/library');
    expect(screen.getByText('Gameplay')).toBeInTheDocument();
  });

  it('redirects a child to their own island when the URL names another child', () => {
    state.child = { status: 'signedIn', child: { id: 'c1' } };
    renderAt('/island/someone-else/library');
    expect(screen.queryByText('Gameplay')).not.toBeInTheDocument();
    expect(screen.getByText('Own island')).toBeInTheDocument();
  });

  it('does not let a child session satisfy RequireParent', () => {
    state.child = { status: 'signedIn', child: { id: 'c1' } };
    renderAt('/home');
    expect(screen.queryByText('Parent dashboard')).not.toBeInTheDocument();
    expect(screen.getByText('Sign-in page')).toBeInTheDocument();
  });

  it('sends a visitor with no session to sign in', () => {
    renderAt('/island/c1/library');
    expect(screen.getByText('Sign-in page')).toBeInTheDocument();
  });

  it('still lets a signed-in parent in, as before', () => {
    state.auth = 'authenticated';
    renderAt('/island/c1/library');
    expect(screen.getByText('Gameplay')).toBeInTheDocument();
  });
});
