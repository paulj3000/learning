import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { listAllWorldChanges, getChildProfile } = vi.hoisted(() => ({
  listAllWorldChanges: vi.fn(),
  getChildProfile: vi.fn(),
}));

vi.mock('../features/adventures/api', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../features/adventures/api');
  return { ...actual, listAllWorldChanges };
});
vi.mock('../features/child-profile/api', () => ({ getChildProfile }));

import { IslandLocationPage } from './IslandLocationPage';
import type { AgeBandValue } from '../features/child-profile/constants';

/**
 * Covers WF-2's route decision
 * (`docs/WONDERWILD_FOREST_3D_ROADMAP.md`): the 3D forest is the **front
 * door** for Pathfinders and Explorers, and Sprouts keep the card-based route
 * as their default per ADR-008 until the accessibility playtest owed from
 * Phase 32 has run.
 *
 * Both halves are asserted, because "primary for two bands, not the third"
 * is exactly the kind of thing that quietly becomes "primary for everyone".
 */

function renderLocation(slug: string, ageBand: AgeBandValue) {
  getChildProfile.mockResolvedValue({
    id: 'child-1',
    nickname: 'Robin',
    ageBand,
    interests: [],
    sessionMinutes: 10,
    avatarKey: 'fox',
  });
  listAllWorldChanges.mockResolvedValue([]);
  return render(
    <MemoryRouter initialEntries={[`/island/child-1/locations/${slug}`]}>
      <Routes>
        <Route path="/island/:childId/locations/:locationSlug" element={<IslandLocationPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Wonderwild Forest route, by age band', () => {
  it('offers the 3D forest first to a Pathfinder, unlabelled as a preview', async () => {
    renderLocation('wonderwild-forest', 'PATHFINDER');
    const walkIn = await screen.findByRole('link', { name: 'Walk into the forest' });
    expect(walkIn).toHaveAttribute('href', '/island/child-1/world/wonderwild-forest-3d');
    // The framing this replaces. A front door is not a "preview".
    expect(screen.queryByText(/preview/i)).not.toBeInTheDocument();
  });

  it('offers the 3D forest to an Explorer too', async () => {
    renderLocation('wonderwild-forest', 'EXPLORER');
    expect(await screen.findByRole('link', { name: 'Walk into the forest' })).toBeInTheDocument();
  });

  it('never offers the 3D forest first to a Sprout, per ADR-008', async () => {
    renderLocation('wonderwild-forest', 'SPROUT');
    expect(await screen.findByRole('link', { name: /Try exploring the forest/ })).toHaveAttribute(
      'href',
      '/island/child-1/world/wonderwild-forest',
    );
    expect(screen.queryByRole('link', { name: 'Walk into the forest' })).not.toBeInTheDocument();
  });

  it.each(['SPROUT', 'PATHFINDER', 'EXPLORER'] as const)(
    'keeps the card-based route reachable for a %s',
    async (band) => {
      // Being the default is not retirement: nothing is retired before WF-10.
      renderLocation('wonderwild-forest', band);
      const cardRoute = await screen.findByRole('link', {
        name: band === 'SPROUT' ? /Try exploring the forest/ : /Explore the forest from above/,
      });
      expect(cardRoute).toHaveAttribute('href', '/island/child-1/world/wonderwild-forest');
    },
  );

  it('leaves the castle and the bay on their own roadmaps, still labelled previews', async () => {
    // Promoting those routes belongs to SC-11 and Phase 33, not to WF-2.
    renderLocation('storykeeper-castle', 'PATHFINDER');
    expect(
      await screen.findByRole('link', { name: /Peek at an early 3D preview/ }),
    ).toHaveAttribute('href', '/island/child-1/world/storykeeper-castle-3d');
  });
});
