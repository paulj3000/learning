import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { UserMenu } from './UserMenu';
import { useAuth } from '../features/auth/AuthContext';

vi.mock('../features/auth/AuthContext', () => ({
  useAuth: vi.fn(),
}));

const useAuthMock = vi.mocked(useAuth);

describe('UserMenu', () => {
  it('opens the menu on click and shows Settings and Sign out, with Sign out last', async () => {
    const signOut = vi.fn();
    useAuthMock.mockReturnValue({
      status: 'authenticated',
      userId: 'parent-1',
      isAdmin: false,
      refresh: vi.fn(),
      signOut,
    });
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <UserMenu />
      </MemoryRouter>,
    );

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /account menu/i }));

    const items = screen.getAllByRole('menuitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Settings');
    expect(items[1]).toHaveTextContent('Sign out');
  });

  it('calls signOut and closes the menu when Sign out is clicked', async () => {
    const signOut = vi.fn();
    useAuthMock.mockReturnValue({
      status: 'authenticated',
      userId: 'parent-1',
      isAdmin: false,
      refresh: vi.fn(),
      signOut,
    });
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <UserMenu />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: /account menu/i }));
    await user.click(screen.getByRole('menuitem', { name: /sign out/i }));

    expect(signOut).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('shows an Admin item first for an admin user, with Sign out still last', async () => {
    const signOut = vi.fn();
    useAuthMock.mockReturnValue({
      status: 'authenticated',
      userId: 'admin-1',
      isAdmin: true,
      refresh: vi.fn(),
      signOut,
    });
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <UserMenu />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: /account menu/i }));

    const items = screen.getAllByRole('menuitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('Admin');
    expect(items[1]).toHaveTextContent('Settings');
    expect(items[2]).toHaveTextContent('Sign out');
  });

  it('closes the menu when clicking outside', async () => {
    const signOut = vi.fn();
    useAuthMock.mockReturnValue({
      status: 'authenticated',
      userId: 'parent-1',
      isAdmin: false,
      refresh: vi.fn(),
      signOut,
    });
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <div>
          <UserMenu />
          <p>Outside</p>
        </div>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: /account menu/i }));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    await user.click(screen.getByText('Outside'));
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  });
});
