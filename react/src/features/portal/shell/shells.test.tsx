import type React from 'react';
import { act, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHILD_NAV_ITEMS, ChildShell } from './ChildShell';
import { ParentShell } from './ParentShell';

function renderChildShell(path: string, profile?: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ChildShell
        childId="child-1"
        actions={<button type="button">Leave island</button>}
        profile={profile}
      >
        <p>Page</p>
      </ChildShell>
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

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

  it('publishes the nav insets on the shell, for fixed game layers', () => {
    const { container } = renderChildShell('/island/child-1');
    const shell = container.querySelector('[data-shell="child"]');
    expect(shell?.className).toMatch(/shell/);
    expect(shell?.className).not.toMatch(/\bpb-20\b|\bmd:pl-56\b/);
  });

  it('publishes how far down the top bar reaches, and keeps the bar above game layers', () => {
    const rect = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        return { bottom: this.tagName === 'HEADER' ? 168.4 : 0 } as DOMRect;
      });
    const { container } = renderChildShell('/island/child-1');
    const shell = container.querySelector<HTMLElement>('[data-shell="child"]')!;
    expect(shell.style.getPropertyValue('--child-header-inset')).toBe('168px');
    expect(screen.getByRole('banner').className).toMatch(/\brelative\b.*\bz-30\b/);
    rect.mockRestore();
  });

  it('follows the top bar when the page scrolls, never below zero', async () => {
    let bottom = 120;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      return { bottom: this.tagName === 'HEADER' ? bottom : 0 } as DOMRect;
    });
    const { container } = renderChildShell('/island/child-1');
    const shell = container.querySelector<HTMLElement>('[data-shell="child"]')!;
    bottom = -40; // scrolled past the bar
    await act(async () => {
      window.dispatchEvent(new Event('scroll'));
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    });
    expect(shell.style.getPropertyValue('--child-header-inset')).toBe('0px');
  });

  it('marks the current page and hides the pictures from screen readers', () => {
    renderChildShell('/island/child-1/log');
    expect(screen.getByRole('link', { name: 'Treasures' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current');
  });

  it('offers Home, Realms, Quests and Treasures (AP-03)', () => {
    renderChildShell('/island/child-1');
    const nav = screen.getByRole('navigation', { name: 'Island' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['🏠Home', '🧭Realms', '🗺️Quests', '💎Treasures']);
  });

  it.each(['/island/child-1/realms', '/island/child-1/realms/creature-care-cove'])(
    'keeps Realms current on %s, and only Realms',
    (path) => {
      renderChildShell(path);
      expect(screen.getByRole('link', { name: 'Realms' })).toHaveAttribute('aria-current', 'page');
      expect(screen.getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current');
    },
  );

  it('shows the branding and, when given, the child in the top bar', () => {
    renderChildShell('/island/child-1', <span>Mia</span>);
    const banner = screen.getByRole('banner');
    expect(within(banner).getByText('Learning Adventure Island')).toBeInTheDocument();
    expect(within(banner).getByText('Mia')).toBeInTheDocument();
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
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/island/child-1');
    expect(screen.getByRole('link', { name: 'Realms' })).toHaveAttribute(
      'href',
      '/island/child-1/realms',
    );
    expect(screen.getByRole('link', { name: 'Quests' })).toHaveAttribute(
      'href',
      '/island/child-1/quests',
    );
    expect(screen.getByRole('link', { name: 'Treasures' })).toHaveAttribute(
      'href',
      '/island/child-1/log',
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
