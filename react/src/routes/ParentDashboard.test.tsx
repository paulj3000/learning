import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getOrCreateParentProfile, listChildProfiles, setChildProfileActive, listAllWorldChanges } =
  vi.hoisted(() => ({
    getOrCreateParentProfile: vi.fn(),
    listChildProfiles: vi.fn(),
    setChildProfileActive: vi.fn(),
    listAllWorldChanges: vi.fn(),
  }));

vi.mock('../features/child-profile/api', () => ({
  getOrCreateParentProfile,
  listChildProfiles,
  setChildProfileActive,
}));
vi.mock('../features/adventures/api', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../features/adventures/api');
  return { ...actual, listAllWorldChanges };
});
vi.mock('../features/auth/AuthContext', () => ({
  useAuth: () => ({
    status: 'authenticated',
    userId: 'parent-1',
    isAdmin: false,
    refresh: vi.fn(),
    signOut: vi.fn(),
  }),
}));

import { ParentDashboard } from './ParentDashboard';
import { ISLAND_LOCATIONS } from '../features/island/locations';
import { listDashboardSections } from '../features/parent-dashboard/dashboardSections';

const ROBIN = {
  id: 'child-1',
  nickname: 'Robin',
  ageBand: 'SPROUT',
  avatarKey: 'FOX',
  interests: [],
  readingMode: 'VOICE_FIRST',
  sessionMinutes: 6,
  active: true,
  parentProfileId: 'parent-1',
};
const SAM = { ...ROBIN, id: 'child-2', nickname: 'Sam', ageBand: 'EXPLORER' };

beforeEach(() => {
  vi.clearAllMocks();
  getOrCreateParentProfile.mockResolvedValue({ id: 'parent-1', displayName: 'Alex' });
  listChildProfiles.mockResolvedValue([ROBIN, SAM]);
  listAllWorldChanges.mockResolvedValue([]);
});

function renderDashboard() {
  return render(
    <MemoryRouter>
      <ParentDashboard />
    </MemoryRouter>,
  );
}

describe('ParentDashboard', () => {
  it('puts child selection in the header dropdown and titles the page for the first child', async () => {
    renderDashboard();

    expect(
      await screen.findByRole('heading', { level: 1, name: "Robin's dashboard" }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /choose a child/i })).toHaveTextContent('Robin');
  });

  it('retitles the page and re-scopes the links when another child is chosen', async () => {
    const user = userEvent.setup();
    renderDashboard();
    await screen.findByRole('heading', { level: 1, name: "Robin's dashboard" });

    await user.click(screen.getByRole('button', { name: /choose a child/i }));
    await user.click(screen.getByRole('menuitemradio', { name: /Sam/ }));

    expect(
      await screen.findByRole('heading', { level: 1, name: "Sam's dashboard" }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'This week' })).toHaveAttribute(
      'href',
      '/home/children/child-2/dashboard#this-week',
    );
  });

  it('lists every island region, linking the ones this child has opened', async () => {
    renderDashboard();
    const regions = await screen.findByRole('region', { name: /island places/i });

    expect(within(regions).getAllByRole('listitem')).toHaveLength(ISLAND_LOCATIONS.length);
    expect(within(regions).getByRole('link', { name: 'Clockwork Harbor' })).toHaveAttribute(
      'href',
      '/island/child-1/locations/clockwork-harbor',
    );
  });

  it("shows a secret region as not discovered until the child's world changes unlock it", async () => {
    renderDashboard();
    const regions = await screen.findByRole('region', { name: /island places/i });

    expect(
      within(regions).queryByRole('link', { name: "The Dragon's Sanctuary" }),
    ).not.toBeInTheDocument();
    expect(within(regions).getAllByText(/not discovered yet/i).length).toBeGreaterThan(0);
  });

  it("opens a secret region once the child's world changes include its key", async () => {
    listAllWorldChanges.mockResolvedValue([{ changeKey: 'DRAGON_OF_EMBER_MOUNTAIN_COMPLETE' }]);
    renderDashboard();
    const regions = await screen.findByRole('region', { name: /island places/i });

    expect(
      await within(regions).findByRole('link', { name: "The Dragon's Sanctuary" }),
    ).toHaveAttribute('href', '/island/child-1/locations/dragons-sanctuary');
  });

  it('lists every dashboard section for the selected child', async () => {
    renderDashboard();
    const sections = await screen.findByRole('region', { name: /dashboard sections/i });

    for (const section of listDashboardSections('child-1')) {
      expect(within(sections).getByRole('link', { name: section.title })).toHaveAttribute(
        'href',
        section.to,
      );
    }
  });

  it('invites a first child profile when the account has none', async () => {
    listChildProfiles.mockResolvedValue([]);
    renderDashboard();

    expect(await screen.findByRole('link', { name: /add your first child/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: /welcome, alex/i })).toBeInTheDocument();
    // Nothing is child-scoped yet, so the sections list has nothing to point at.
    expect(screen.queryByRole('region', { name: /dashboard sections/i })).not.toBeInTheDocument();
  });
});
