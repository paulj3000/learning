import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getChildProfile, loadTravelDeck, loadTravelPack } = vi.hoisted(() => ({
  getChildProfile: vi.fn(),
  loadTravelDeck: vi.fn(),
  loadTravelPack: vi.fn(),
}));

vi.mock('../features/child-profile/api', () => ({ getChildProfile }));
vi.mock('../features/worlds/api', () => ({ loadTravelDeck, loadTravelPack }));

import { getHomeWorld } from '../features/worlds/worlds';
import { TravelDeck } from './TravelDeck';

/** ADR-041: with one Island to sail to there is nothing to choose; with several, the child picks. */

const home = getHomeWorld();
const cove = { ...home, slug: 'creature-care-cove', title: 'Creature Care Cove', tagline: '' };

function destination(world: typeof home, isUnlocked = true) {
  return { world, isUnlocked, lockedHint: 'Finish the bridge first.', isCurrent: false };
}

function renderDeck() {
  return render(
    <MemoryRouter initialEntries={['/island/child-1/travel']}>
      <Routes>
        <Route path="/island/:childId/travel" element={<TravelDeck />} />
        <Route path="/island/:childId" element={<p>Harbor map</p>} />
        <Route path="/island/:childId/worlds/:worldSlug" element={<p>Island map</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  getChildProfile.mockResolvedValue({ id: 'child-1', ageBand: 'PATHFINDER' });
  loadTravelPack.mockRejectedValue(new Error('not needed'));
});

describe('choosing an Island', () => {
  it('goes straight to the only Island', async () => {
    loadTravelDeck.mockResolvedValue({ destinations: [destination(home)] });
    renderDeck();
    await waitFor(() => expect(screen.getByText('Harbor map')).toBeInTheDocument());
    expect(screen.queryByRole('heading', { name: 'The Sailing Dock' })).not.toBeInTheDocument();
  });

  it('lets the child choose when there are several', async () => {
    loadTravelDeck.mockResolvedValue({ destinations: [destination(home), destination(cove)] });
    renderDeck();
    expect(await screen.findByRole('heading', { name: 'The Sailing Dock' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Creature Care Cove/ })).toHaveAttribute(
      'href',
      '/island/child-1/worlds/creature-care-cove',
    );
  });

  it('still shows the dock when the only other Island is not open yet', async () => {
    loadTravelDeck.mockResolvedValue({ destinations: [destination(cove, false)] });
    renderDeck();
    expect(await screen.findByText('Finish the bridge first.')).toBeInTheDocument();
  });
});
