import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AdminMoved } from '../../routes/AdminMoved';
import { AdminLayout } from './AdminLayout';

function renderAt(path: string, adminUrl: string | null = 'https://api.example.test/admin/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<AdminMoved adminUrl={adminUrl} />} />
          <Route path="*" element={<AdminMoved adminUrl={adminUrl} />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('AdminLayout and the retired React admin (AMP-03)', () => {
  it('renders the page inside the skip-link target and the .admin-root scope', () => {
    const { container } = renderAt('/admin');
    const main = screen.getByRole('main');
    expect(main).toHaveAttribute('id', 'main-content');
    expect(container.firstElementChild).toHaveClass('admin-root');
  });

  it.each(['/admin', '/admin/islands', '/admin/adventures/a1/edit', '/admin/children/c1'])(
    'points %s to Django Admin and links no React admin section',
    (path) => {
      renderAt(path);
      const main = screen.getByRole('main');
      expect(
        within(main).getByRole('heading', { name: 'Administration has moved' }),
      ).toBeInTheDocument();
      expect(
        within(main).getByRole('link', { name: 'Open the administration site' }),
      ).toHaveAttribute('href', 'https://api.example.test/admin/');
      expect(screen.queryByRole('navigation', { name: 'Admin sections' })).toBeNull();
    },
  );

  it('says where to ask when no administration site is configured', () => {
    renderAt('/admin', null);
    expect(screen.queryByRole('link', { name: 'Open the administration site' })).toBeNull();
    expect(screen.getByText(/ask the team/i)).toBeInTheDocument();
  });

  it('links back to the parent dashboard', () => {
    renderAt('/admin');
    expect(screen.getByRole('link', { name: 'Back to my dashboard' })).toHaveAttribute(
      'href',
      '/home',
    );
  });
});
