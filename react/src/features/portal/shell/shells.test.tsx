import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { CHILD_NAV_ITEMS, ChildShell } from './ChildShell';
import { ParentShell } from './ParentShell';

function renderChildShell(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ChildShell childId="child-1" actions={<button type="button">Leave island</button>}>
        <p>Page</p>
      </ChildShell>
    </MemoryRouter>,
  );
}

describe('ChildShell', () => {
  it('has one navigation landmark with every link exactly once (bottom bar and sidebar are one nav)', () => {
    renderChildShell('/island/child-1');
    const navs = screen.getAllByRole('navigation');
    expect(navs).toHaveLength(1);
    const links = within(navs[0]).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual(
      CHILD_NAV_ITEMS.map((item) => `${item.icon}${item.label}`),
    );
  });

  it('is a bottom bar on phones and a sidebar from md up', () => {
    renderChildShell('/island/child-1');
    const nav = screen.getByRole('navigation', { name: 'Island' });
    expect(nav.className).toMatch(/\bbottom-0\b/);
    expect(nav.className).toMatch(/\bmd:left-0\b/);
    expect(nav.className).toMatch(/\bmd:w-56\b/);
  });

  it('marks the current page and hides the pictures from screen readers', () => {
    renderChildShell('/island/child-1/log');
    expect(screen.getByRole('link', { name: 'Adventure log' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: 'Island Explorer' })).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('gives each nav item a 56px touch target', () => {
    renderChildShell('/island/child-1');
    for (const link of screen.getAllByRole('link')) {
      expect(link.className).toContain('min-h-14');
    }
  });

  it('owns the main landmark the skip link targets, and keeps the exits in the top bar', () => {
    renderChildShell('/island/child-1');
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content');
    const banner = screen.getByRole('banner');
    expect(within(banner).getByRole('button', { name: 'Leave island' })).toBeInTheDocument();
    expect(
      within(screen.getByRole('navigation')).queryByRole('button', { name: 'Leave island' }),
    ).not.toBeInTheDocument();
  });

  it('links point at the child’s own routes', () => {
    renderChildShell('/island/child-1');
    expect(screen.getByRole('link', { name: 'Island Explorer' })).toHaveAttribute(
      'href',
      '/island/child-1',
    );
    expect(screen.getByRole('link', { name: 'Sailing dock' })).toHaveAttribute(
      'href',
      '/island/child-1/travel',
    );
  });
});

describe('ParentShell', () => {
  it('is labelled as the parent space and has no picture navigation', () => {
    render(
      <ParentShell actions={<button type="button">Account</button>}>
        <p>Dashboard</p>
      </ParentShell>,
    );
    expect(screen.getByText('Parent space')).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content');
    expect(
      within(screen.getByRole('banner')).getByRole('button', { name: 'Account' }),
    ).toBeInTheDocument();
  });

  it('is visually distinct from the child shell', () => {
    const { container } = render(<ParentShell>x</ParentShell>);
    expect(container.querySelector('[data-shell="parent"]')).not.toBeNull();
    expect(container.querySelector('[data-shell="child"]')).toBeNull();
  });
});
