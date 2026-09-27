import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AdminLayout } from './AdminLayout';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<p>Families page</p>} />
          <Route path="assets/models" element={<p>Models page</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('AdminLayout', () => {
  it('renders the page inside the skip-link target and the .admin-root scope', () => {
    const { container } = renderAt('/admin');
    const main = screen.getByRole('main');
    expect(main).toHaveAttribute('id', 'main-content');
    expect(within(main).getByText('Families page')).toBeInTheDocument();
    expect(container.firstElementChild).toHaveClass('admin-root');
  });

  it('marks only the matching section as current, including on nested pages', () => {
    renderAt('/admin/assets/models');
    const nav = screen.getByRole('navigation', { name: 'Admin sections' });
    expect(within(nav).getByRole('link', { name: 'Game assets' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(nav).getByRole('link', { name: 'Families' })).not.toHaveAttribute('aria-current');
    expect(screen.getByText('Models page')).toBeInTheDocument();
  });

  it('links back to the parent dashboard', () => {
    renderAt('/admin');
    expect(screen.getByRole('link', { name: 'Back to my dashboard' })).toHaveAttribute(
      'href',
      '/home',
    );
  });
});
