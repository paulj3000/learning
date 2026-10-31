import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getChildProfile } = vi.hoisted(() => ({ getChildProfile: vi.fn() }));

vi.mock('../features/child-profile/api', () => ({ getChildProfile }));
// The runner owns the session; here only where its finish link points matters.
vi.mock('../features/adventures/AdventureRunner', () => ({
  AdventureRunner: ({ backToMapHref, backToMapLabel }: Record<string, string | undefined>) => (
    <a href={backToMapHref}>{backToMapLabel ?? 'Back to the map'}</a>
  ),
}));

import { AdventurePage, BACK_TO_AREA_LABEL } from './AdventurePage';

/** ADR-041's return flow: an Adventure begun from a 3D Area ends back in it. */

const CHILD = 'child-1';
const ADVENTURE =
  '/island/child-1/locations/pirate-builder-bay/adventures/repair-the-moonlight-bridge';

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route
          path="/island/:childId/locations/:locationSlug/adventures/:templateSlug"
          element={<AdventurePage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  getChildProfile.mockResolvedValue({ id: CHILD, ageBand: 'PATHFINDER', aiEnabled: false });
});

describe('the finish link', () => {
  it('goes back to the 3D Area the Adventure was begun in', async () => {
    const back = `/island/${CHILD}/explore/treasure-rush-cove`;
    renderAt(`${ADVENTURE}?returnTo=${encodeURIComponent(back)}`);
    const link = await screen.findByRole('link', { name: BACK_TO_AREA_LABEL });
    expect(link).toHaveAttribute('href', back);
  });

  it('goes back to the Place without one', async () => {
    renderAt(ADVENTURE);
    const link = await screen.findByRole('link', { name: 'Back to the map' });
    expect(link).toHaveAttribute('href', `/island/${CHILD}/locations/pirate-builder-bay`);
  });

  it.each([
    'https://example.com/',
    '/island/someone-else/explore/treasure-rush-cove',
    `/island/${CHILD}/log`,
  ])('ignores an unsafe return path (%s)', async (value) => {
    renderAt(`${ADVENTURE}?returnTo=${encodeURIComponent(value)}`);
    const link = await screen.findByRole('link', { name: 'Back to the map' });
    expect(link).toHaveAttribute('href', `/island/${CHILD}/locations/pirate-builder-bay`);
  });
});
