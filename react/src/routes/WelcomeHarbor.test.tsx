import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getChildProfile, getCompanionProfile, listAllWorldChanges, loadCatalogSnapshot } =
  vi.hoisted(() => ({
    getChildProfile: vi.fn(),
    getCompanionProfile: vi.fn(),
    listAllWorldChanges: vi.fn(),
    loadCatalogSnapshot: vi.fn(),
  }));

vi.mock('../features/child-profile/api', () => ({ getChildProfile }));
vi.mock('../features/island/api', () => ({
  getCompanionProfile,
  getOrCreateCompanionProfile: vi.fn(),
}));
vi.mock('../features/adventures/api', () => ({ listAllWorldChanges }));
vi.mock('../features/catalog/availabilityApi', () => ({ loadCatalogSnapshot }));
vi.mock('../features/session/useSessionClock', () => ({
  useSessionClock: () => ({ elapsedMinutes: 0, limitMinutes: null, limitReached: false }),
}));

import { WelcomeHarbor } from './WelcomeHarbor';

/** LAI-0808: the child's homepage is an Island Explorer. */

function renderHome() {
  return render(
    <MemoryRouter initialEntries={['/island/child-1']}>
      <Routes>
        <Route path="/island/:childId" element={<WelcomeHarbor />} />
        <Route path="/island/:childId/locations/:slug" element={<p>Place page</p>} />
        <Route path="/island/:childId/worlds/:worldSlug" element={<p>Island hub</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

function changes(...keys: string[]) {
  return keys.map((changeKey) => ({ changeKey }));
}

beforeEach(() => {
  getChildProfile.mockResolvedValue({
    id: 'child-1',
    nickname: 'Robin',
    ageBand: 'PATHFINDER',
    avatarKey: 'fox',
  });
  getCompanionProfile.mockResolvedValue({ id: 'companion-1' });
  listAllWorldChanges.mockResolvedValue([]);
  loadCatalogSnapshot.mockResolvedValue({ islands: [], adventures: [] });
});

describe('WelcomeHarbor Island Explorer (LAI-0808)', () => {
  it('shows the home island first with its places, and a locked island with its hint', async () => {
    renderHome();
    const explorer = await screen.findByRole('region', { name: 'Where to next?' });
    const islands = within(explorer)
      .getAllByRole('listitem')
      .filter((item) => item.parentElement?.parentElement === explorer);
    expect(islands).toHaveLength(2);
    expect(within(islands[0]).getByText('Learning Adventure Island')).toBeInTheDocument();
    expect(within(islands[0]).getByText('You are here')).toBeInTheDocument();
    expect(within(islands[0]).getByRole('link', { name: /Pirate Builder Bay/ })).toHaveAttribute(
      'href',
      '/island/child-1/locations/pirate-builder-bay',
    );

    expect(within(islands[1]).getByText('Creature Care Cove')).toBeInTheDocument();
    expect(within(islands[1]).getByText('Not open yet')).toBeInTheDocument();
    expect(within(islands[1]).getByText(/Help Pip at Pirate Builder Bay/)).toBeInTheDocument();
    expect(within(islands[1]).queryByRole('link')).not.toBeInTheDocument();
    expect(within(islands[1]).queryByRole('button')).not.toBeInTheDocument();
  });

  it('opens the cove once the bridge is repaired, and sailing there navigates to its hub', async () => {
    listAllWorldChanges.mockResolvedValue(changes('BRIDGE_REPAIRED'));
    renderHome();
    const sail = await screen.findByRole('link', { name: /Creature Care Cove/ });
    expect(sail).toHaveAttribute('href', '/island/child-1/worlds/creature-care-cove');
    expect(screen.queryByText('Not open yet')).not.toBeInTheDocument();
    await userEvent.click(sail);
    expect(await screen.findByText('Island hub')).toBeInTheDocument();
  });

  it('navigates to a place when its card is chosen', async () => {
    renderHome();
    await userEvent.click(await screen.findByRole('link', { name: /Wonderwild Forest/ }));
    expect(await screen.findByText('Place page')).toBeInTheDocument();
  });

  it('respects the age band: an Explorer opens the cove with the tide gate', async () => {
    getChildProfile.mockResolvedValue({
      id: 'child-1',
      nickname: 'Robin',
      ageBand: 'EXPLORER',
      avatarKey: 'fox',
    });
    listAllWorldChanges.mockResolvedValue(changes('TIDE_GATE_SET'));
    renderHome();
    expect(await screen.findByRole('link', { name: /Creature Care Cove/ })).toBeInTheDocument();
  });

  it('hides a place an admin has switched off', async () => {
    loadCatalogSnapshot.mockResolvedValue({
      islands: [{ id: 'i-1', slug: 'wonderwild-forest', active: false }],
      adventures: [],
    });
    renderHome();
    await screen.findByRole('region', { name: 'Where to next?' });
    expect(screen.queryByRole('link', { name: /Wonderwild Forest/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Pirate Builder Bay/ })).toBeInTheDocument();
  });

  it('shows a calm error when the island cannot load', async () => {
    listAllWorldChanges.mockRejectedValue(new Error('offline'));
    renderHome();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Something went wrong loading the island.',
    );
  });
});
