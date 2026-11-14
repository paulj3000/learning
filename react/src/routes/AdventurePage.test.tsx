import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getChildProfile } = vi.hoisted(() => ({ getChildProfile: vi.fn() }));

vi.mock('../features/child-profile/api', () => ({ getChildProfile }));
// The runner owns the session; here only where its finish link points matters.
vi.mock('../features/adventures/DjangoAdventureRunner', () => ({
  DjangoAdventureRunner: ({
    backToMapHref,
    backToMapLabel,
  }: Record<string, string | undefined>) => (
    <a href={backToMapHref} data-runner="django">
      {backToMapLabel ?? 'Back to the map'}
    </a>
  ),
}));
vi.mock('../features/adventures/AdventureRunner', () => ({
  AdventureRunner: ({ backToMapHref, coopSessionId }: Record<string, string | undefined>) => (
    <a href={backToMapHref} data-runner="classic" data-coop={coopSessionId}>
      Back to the map
    </a>
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

describe('which runner plays it (Django is the only backend)', () => {
  it('plays a solo adventure through the Django step runner', async () => {
    renderAt(ADVENTURE);
    const link = await screen.findByRole('link', { name: 'Back to the map' });
    expect(link).toHaveAttribute('data-runner', 'django');
  });

  it('keeps a co-op launch on the classic runner, which owns co-op play', async () => {
    renderAt(`${ADVENTURE}?coop=coop-1`);
    const link = await screen.findByRole('link', { name: 'Back to the map' });
    expect(link).toHaveAttribute('data-runner', 'classic');
    expect(link).toHaveAttribute('data-coop', 'coop-1');
  });
});
