import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { listAllWorldChanges, getChildProfile, placeArea } = vi.hoisted(() => ({
  listAllWorldChanges: vi.fn(),
  getChildProfile: vi.fn(),
  placeArea: vi.fn(() => null as null | { regionId: string; title: string; available: boolean }),
}));

vi.mock('../features/adventures/api', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../features/adventures/api');
  return { ...actual, listAllWorldChanges };
});
vi.mock('../features/child-profile/api', () => ({ getChildProfile }));
vi.mock('../features/region-play/usePlaceArea', () => ({ usePlaceArea: placeArea }));

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
    // Engine Phase 9: the forest runs on the generic route now.
    expect(walkIn).toHaveAttribute('href', '/island/child-1/explore/wonderwild-forest');
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

  it('leaves the bay on its own roadmap, still labelled a preview', async () => {
    // Promoting that route belongs to Phase 33, not to WF-2.
    renderLocation('pirate-builder-bay', 'PATHFINDER');
    expect(
      await screen.findByRole('link', { name: /Peek at an early 3D preview/ }),
    ).toHaveAttribute('href', '/island/child-1/explore/pirate-builder-bay');
  });
});

/**
 * #99 (owner playtest 2026-11-26): the child could not enter the castle. Storykeeper Castle has
 * no Django 3D Area (bundled manifest, ADR-033), so the Place page's `area` link never appears
 * for it, and the 3D castle was reachable only through a link labelled an "early 3D preview",
 * below the card tale and the Phaser view. The 3D castle is now the front door for Pathfinders
 * and Explorers; Sprouts keep the card route first (contract C-10, ADR-008).
 */
describe('Storykeeper Castle entry, by age band (#99)', () => {
  const CASTLE_3D = '/island/child-1/explore/storykeeper-castle';
  const CASTLE_PHASER = '/island/child-1/world/storykeeper-castle';

  it.each(['PATHFINDER', 'EXPLORER'] as const)(
    'offers a %s the 3D castle as the first action, not as a preview',
    async (band) => {
      placeArea.mockReturnValue(null);
      renderLocation('storykeeper-castle', band);
      const enter = await screen.findByRole('link', { name: 'Enter the castle' });
      expect(enter).toHaveAttribute('href', CASTLE_3D);
      // Above the card tale and the view from above, so it reads as the way in.
      for (const later of screen.getAllByRole('link', { name: /^Start: |from above/ })) {
        expect(
          enter.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
      }
      expect(screen.queryByText(/preview/i)).not.toBeInTheDocument();
      // The Phaser view stays reachable until SC-R10-03 retires it; it is never the way in.
      expect(
        screen.getByRole('link', { name: 'Explore the castle from above instead' }),
      ).toHaveAttribute('href', CASTLE_PHASER);
    },
  );

  it('keeps the card route first for a Sprout, with the 3D castle plainly offered', async () => {
    placeArea.mockReturnValue(null);
    renderLocation('storykeeper-castle', 'SPROUT');
    const walk = await screen.findByRole('link', { name: 'Walk inside the castle' });
    expect(walk).toHaveAttribute('href', CASTLE_3D);
    expect(screen.queryByRole('link', { name: 'Enter the castle' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Try exploring the castle/ })).toHaveAttribute(
      'href',
      CASTLE_PHASER,
    );
    expect(screen.queryByText(/preview/i)).not.toBeInTheDocument();
    // Second to the Sprouts' own route, never above it.
    const phaser = screen.getByRole('link', { name: /Try exploring the castle/ });
    expect(phaser.compareDocumentPosition(walk) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it.each([
    ['SPROUT', "Start: Quill's Picture Story", '/adventures/quills-picture-story'],
    ['PATHFINDER', "Start: The Storykeeper's Tale", '/adventures/the-storykeepers-tale'],
  ] as const)("offers a %s its own band's castle adventure", async (band, name, path) => {
    // Before #99 every band was offered the first template (a Pathfinder one), so a Sprout
    // was told "not available for your age yet" beside its own Picture Story.
    placeArea.mockReturnValue(null);
    renderLocation('storykeeper-castle', band);
    expect(await screen.findByRole('link', { name })).toHaveAttribute(
      'href',
      `/island/child-1/locations/storykeeper-castle${path}`,
    );
    expect(screen.queryByText(/not available for your age/)).not.toBeInTheDocument();
  });

  it('tells an Explorer their castle adventure starts inside, never "not available"', async () => {
    placeArea.mockReturnValue(null);
    renderLocation('storykeeper-castle', 'EXPLORER');
    expect(await screen.findByText(/Look for the secret door in the Great Library/)).toBeVisible();
    expect(screen.queryByText(/not available for your age/)).not.toBeInTheDocument();
    // No other band's adventure is offered to them.
    expect(screen.queryByRole('link', { name: /^Start: / })).not.toBeInTheDocument();
  });

  it.each(['SPROUT', 'PATHFINDER', 'EXPLORER'] as const)(
    'gives a %s exactly one link into the 3D castle',
    async (band) => {
      placeArea.mockReturnValue(null);
      renderLocation('storykeeper-castle', band);
      await screen.findByRole('link', { name: 'Back to the map' });
      const into3d = screen
        .getAllByRole('link')
        .filter((link) => link.getAttribute('href') === CASTLE_3D);
      expect(into3d).toHaveLength(1);
    },
  );
});

describe('a Place with a published 3D Area (ADR-041)', () => {
  it('offers exploring its 3D Area first, and keeps its adventures', async () => {
    placeArea.mockReturnValue({
      regionId: 'treasure-rush-cove',
      title: 'Treasure Cove',
      available: true,
    });
    renderLocation('pirate-builder-bay', 'PATHFINDER');
    const explore = await screen.findByRole('link', { name: 'Explore Treasure Cove' });
    expect(explore).toHaveAttribute('href', '/island/child-1/explore/treasure-rush-cove');
    expect(screen.getByRole('link', { name: /^Start: / })).toBeInTheDocument();
    expect(placeArea).toHaveBeenCalledWith('child-1', 'pirate-builder-bay');
  });

  it('has no Explore link for a Place without one, which still works', async () => {
    placeArea.mockReturnValue(null);
    renderLocation('pirate-builder-bay', 'PATHFINDER');
    expect(await screen.findByRole('link', { name: /^Start: / })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^Explore / })).not.toBeInTheDocument();
  });
});

describe('the Writing Room offers each band its own story (#99, same cause)', () => {
  it.each(['SPROUT', 'PATHFINDER', 'EXPLORER'] as const)(
    'offers a %s "Write a story", not "not available"',
    async (band) => {
      placeArea.mockReturnValue(null);
      renderLocation('castle-writing-room', band);
      expect(await screen.findByRole('link', { name: 'Write a story' })).toHaveAttribute(
        'href',
        '/island/child-1/locations/castle-writing-room/write',
      );
      expect(screen.queryByText(/not available for your age/)).not.toBeInTheDocument();
    },
  );
});
