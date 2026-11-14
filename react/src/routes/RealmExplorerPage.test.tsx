import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { testCatalog } from '../features/realms/testCatalog';
import { ApiError } from '../api/errors';

/** AP-03: the Realm Explorer and a Realm's preview, with the Django API. */

const mocks = vi.hoisted(() => ({
  config: { baseUrl: '' } as { baseUrl: string },
  getIslandsFor: vi.fn(),
  getChildProfile: vi.fn(),
  resolve: vi.fn(),
}));

vi.mock('../api/config', () => ({
  get DJANGO_API_CONFIG() {
    return mocks.config;
  },
}));
vi.mock('../api/play/islandsApi', async (original) => ({
  ...(await original<typeof import('../api/play/islandsApi')>()),
  getIslandsFor: mocks.getIslandsFor,
}));
vi.mock('../features/child-profile/api', () => ({
  getChildProfile: mocks.getChildProfile,
  getChildPhotoUrl: vi.fn().mockResolvedValue(null),
}));
vi.mock('../api/assets/djangoAssetResolver', () => ({
  djangoAssetResolverFor: () => ({ resolve: mocks.resolve }),
}));

import { RealmExplorerPage } from './RealmExplorerPage';
import { RealmDetailPage } from './RealmDetailPage';
import { clearRealmCatalogCache } from '../features/realms/useRealmCatalog';

function Where() {
  const location = useLocation();
  return <p data-testid="where">{`${location.pathname}${location.search}`}</p>;
}

function renderAt(path: string, state?: unknown) {
  return render(
    <MemoryRouter
      initialEntries={[
        {
          pathname: path.split('?')[0],
          search: path.includes('?') ? `?${path.split('?')[1]}` : '',
          state,
        },
      ]}
    >
      <Routes>
        <Route path="/island/:childId/realms" element={<RealmExplorerPage />} />
        <Route path="/island/:childId/realms/:realmId" element={<RealmDetailPage />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

const card = (name: string) => screen.getByRole('article', { name });

beforeEach(() => {
  vi.clearAllMocks();
  clearRealmCatalogCache();
  mocks.config = { baseUrl: '' };
  mocks.getChildProfile.mockResolvedValue({
    id: 'child-1',
    nickname: 'Robin',
    ageBand: 'PATHFINDER',
    avatarKey: 'fox',
    avatarPhotoKey: null,
  });
  mocks.getIslandsFor.mockResolvedValue(testCatalog());
  mocks.resolve.mockResolvedValue({ source: 'BUNDLED', family: 'image', url: '/x.png' });
});

describe('RealmExplorerPage (AP-03)', () => {
  it('shows the hero, the child, and a card for every published Realm', async () => {
    renderAt('/island/child-1/realms');
    expect(screen.getByRole('heading', { level: 1, name: 'Realm Explorer' })).toBeInTheDocument();
    expect(
      screen.getByText('Choose a Realm to learn, play, and go on an adventure!'),
    ).toBeInTheDocument();
    expect(await screen.findByRole('article', { name: 'Learning Adventure Island' })).toBeVisible();
    expect(card('Creature Care Cove')).toBeInTheDocument();
    expect(within(screen.getByRole('banner')).getByText('Robin')).toBeInTheDocument();
    // Child-scoped: the catalog of the child in the URL, and no one else's.
    expect(mocks.getIslandsFor).toHaveBeenCalledWith('child-1');
    expect(mocks.getIslandsFor).toHaveBeenCalledTimes(1);
  });

  it('marks Realms as current in the navigation and offers no "Leave island" here', async () => {
    renderAt('/island/child-1/realms');
    await screen.findByRole('article', { name: 'Learning Adventure Island' });
    expect(screen.getByRole('link', { name: 'Realms' })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('button', { name: 'Leave island' })).not.toBeInTheDocument();
  });

  it('gives an open Realm an Explore link, progress and subjects', async () => {
    renderAt('/island/child-1/realms');
    const home = await screen.findByRole('article', { name: 'Learning Adventure Island' });
    expect(
      within(home).getByRole('link', { name: 'Explore Learning Adventure Island' }),
    ).toHaveAttribute('href', '/island/child-1/realms/learning-adventure-island');
    expect(within(home).getByRole('progressbar', { name: 'Explored' })).toHaveAttribute(
      'aria-valuetext',
      '1 of 3 places explored',
    );
    expect(
      within(home).getByRole('list', { name: 'Learn: Math, Reading, Science, Creativity' }),
    ).toBeInTheDocument();
    expect(within(home).getByText('Ages 3 to 8')).toBeInTheDocument();
  });

  it('shows a locked Realm with a lock and its hint, and nothing to press', async () => {
    renderAt('/island/child-1/realms');
    await screen.findByRole('article', { name: 'Learning Adventure Island' });
    const cove = card('Creature Care Cove');
    expect(within(cove).getByText('Locked')).toBeInTheDocument();
    expect(within(cove).getByText(/Help Pip at Pirate Builder Bay first\./)).toBeInTheDocument();
    expect(within(cove).queryByRole('link')).not.toBeInTheDocument();
    expect(within(cove).queryByRole('button')).not.toBeInTheDocument();
  });

  it('offers Continue straight into the 3D Area with an open session', async () => {
    mocks.getIslandsFor.mockResolvedValue(testCatalog({ resume: true }));
    renderAt('/island/child-1/realms');
    const home = await screen.findByRole('article', { name: 'Learning Adventure Island' });
    expect(
      within(home).getByRole('link', { name: 'Continue in Learning Adventure Island' }),
    ).toHaveAttribute('href', '/island/child-1/explore/treasure-rush-cove');
  });

  it('filters without leaving the page, and the URL keeps the choice', async () => {
    renderAt('/island/child-1/realms');
    await screen.findByRole('article', { name: 'Learning Adventure Island' });
    const subjects = screen.getByRole('group', { name: 'Subject' });
    expect(
      within(subjects)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['🌍All Realms', '🔢Math', '📖Reading', '🔬Science', '🎨Creativity']);

    await userEvent.click(within(subjects).getByRole('button', { name: 'Creativity' }));
    expect(within(subjects).getByRole('button', { name: 'Creativity' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.queryByRole('article', { name: 'Creature Care Cove' })).not.toBeInTheDocument();
    expect(screen.getByRole('status', { name: '' })).toBeDefined();
    expect(screen.getByText('Showing 1 of 2 Realms')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Ages 3 to 4' }));
    expect(screen.getByRole('article', { name: 'Learning Adventure Island' })).toBeInTheDocument();

    await userEvent.click(within(subjects).getByRole('button', { name: 'All Realms' }));
    await userEvent.click(screen.getByRole('button', { name: 'All ages' }));
    expect(screen.getByText('Showing all 2 Realms')).toBeInTheDocument();
    expect(mocks.getIslandsFor).toHaveBeenCalledTimes(1);
  });

  it('reads a filter from the URL, and explains when nothing matches', async () => {
    mocks.getIslandsFor.mockResolvedValue({
      ...testCatalog(),
      islands: testCatalog().islands.filter((island) => island.isHome),
    });
    renderAt('/island/child-1/realms?subject=SCIENCE&age=SPROUT');
    expect(
      await screen.findByRole('article', { name: 'Learning Adventure Island' }),
    ).toBeInTheDocument();
    renderAt('/island/child-1/realms?subject=MATH&age=UNKNOWN');
    expect((await screen.findAllByText('Showing all 1 Realm')).length).toBeGreaterThan(0);
  });

  it('offers a way back to every Realm when the filter matches none', async () => {
    mocks.getIslandsFor.mockResolvedValue({
      ...testCatalog(),
      islands: testCatalog().islands.filter((island) => !island.isHome),
    });
    renderAt('/island/child-1/realms?subject=SCIENCE&age=SPROUT');
    expect(await screen.findByText('No Realms match that choice yet.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show all Realms' }));
    expect(screen.getByRole('article', { name: 'Creature Care Cove' })).toBeInTheDocument();
  });

  it('says calmly while loading, and offers to try again after an error', async () => {
    mocks.getIslandsFor.mockRejectedValueOnce(new Error('offline'));
    renderAt('/island/child-1/realms');
    expect(screen.getByText('Finding your Realms...')).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'We could not load the Realms right now.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByRole('article', { name: 'Learning Adventure Island' }),
    ).toBeInTheDocument();
    expect(mocks.getIslandsFor).toHaveBeenCalledTimes(2);
  });

  it('says so when no Realm is published for this child yet', async () => {
    mocks.getIslandsFor.mockResolvedValue({ autoSelectIslandId: null, islands: [] });
    renderAt('/island/child-1/realms');
    expect(
      await screen.findByText('New Realms are on their way. Come back soon.'),
    ).toBeInTheDocument();
  });

  it('says calmly that the island is saved after "Leave island" (AP-04)', async () => {
    renderAt('/island/child-1/realms', { leftIsland: true });
    expect(
      screen.getByText('Your adventure is saved. Where would you like to go next?'),
    ).toBeInTheDocument();
  });

  it('draws every card without a picture download when no picture is published', async () => {
    renderAt('/island/child-1/realms');
    await screen.findByRole('article', { name: 'Learning Adventure Island' });
    expect(document.querySelector('img[src="/x.png"]')).toBeNull();
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it('says why a load failed, and stops waiting, when the island does not answer', async () => {
    mocks.getIslandsFor.mockRejectedValueOnce(new ApiError('network', { code: 'timeout' }));
    renderAt('/island/child-1/realms');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('We could not load the Realms right now.');
    expect(alert).toHaveTextContent('The island is taking too long to answer.');
    expect(screen.queryByText('Finding your Realms...')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByRole('article', { name: 'Learning Adventure Island' }),
    ).toBeInTheDocument();
  });

  it('asks for a grown-up to sign in again when the session has expired', async () => {
    mocks.getIslandsFor.mockRejectedValueOnce(new ApiError('unauthenticated'));
    renderAt('/island/child-1/realms');
    expect(
      await screen.findByRole('link', { name: 'Ask a grown-up to sign in again' }),
    ).toHaveAttribute('href', '/sign-in');
  });
});

describe('RealmDetailPage (AP-03)', () => {
  it('previews the Realm and its Places, each with its own way in', async () => {
    renderAt('/island/child-1/realms/learning-adventure-island');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Learning Adventure Island' }),
    ).toBeInTheDocument();
    expect(screen.getByText('The island where you started.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Start Exploring' })).toHaveAttribute(
      'href',
      '/island/child-1/locations/storykeeper-castle',
    );
    expect(screen.queryByRole('link', { name: 'Continue Adventure' })).not.toBeInTheDocument();

    const places = screen.getByRole('region', { name: 'Places in Learning Adventure Island' });
    const bay = within(places).getByRole('article', { name: 'Pirate Builder Bay' });
    expect(within(bay).getByRole('link', { name: 'Explore Treasure Cove in 3D' })).toHaveAttribute(
      'href',
      '/island/child-1/explore/treasure-rush-cove',
    );
    expect(within(bay).getByRole('link', { name: 'Visit Pirate Builder Bay' })).toHaveAttribute(
      'href',
      '/island/child-1/locations/pirate-builder-bay',
    );
    expect(within(bay).getByText('Explored')).toBeInTheDocument();
    const firepeak = within(places).getByRole('article', { name: 'Firepeak Volcano' });
    expect(within(firepeak).getAllByRole('link')).toHaveLength(1);
    expect(within(places).getAllByRole('article')).toHaveLength(3);
  });

  it('offers Continue Adventure when a session is open', async () => {
    mocks.getIslandsFor.mockResolvedValue(testCatalog({ resume: true }));
    renderAt('/island/child-1/realms/learning-adventure-island');
    expect(await screen.findByRole('link', { name: 'Continue Adventure' })).toHaveAttribute(
      'href',
      '/island/child-1/explore/treasure-rush-cove',
    );
    expect(screen.getByRole('link', { name: 'Continue in Treasure Cove' })).toBeInTheDocument();
  });

  it('returns to the Realms with the filter the child chose', async () => {
    renderAt('/island/child-1/realms/learning-adventure-island', {
      realmSearch: '?subject=MATH',
    });
    await screen.findByRole('heading', { level: 1, name: 'Learning Adventure Island' });
    expect(screen.getByRole('link', { name: 'Back to Realms' })).toHaveAttribute(
      'href',
      '/island/child-1/realms?subject=MATH',
    );
  });

  it('ignores a "back" value that is not a filter', async () => {
    renderAt('/island/child-1/realms/learning-adventure-island', {
      realmSearch: '//evil.example/x',
    });
    await screen.findByRole('heading', { level: 1, name: 'Learning Adventure Island' });
    expect(screen.getByRole('link', { name: 'Back to Realms' })).toHaveAttribute(
      'href',
      '/island/child-1/realms',
    );
  });

  it('shows a locked Realm’s hint and no way in, even from a typed URL', async () => {
    renderAt('/island/child-1/realms/creature-care-cove');
    expect(await screen.findByText(/Help Pip at Pirate Builder Bay first\./)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Start Exploring' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /Places in/ })).not.toBeInTheDocument();
  });

  it('sails to another open Realm through its hub', async () => {
    mocks.getIslandsFor.mockResolvedValue(testCatalog({ coveUnlocked: true }));
    renderAt('/island/child-1/realms/creature-care-cove');
    expect(await screen.findByRole('link', { name: 'Start Exploring' })).toHaveAttribute(
      'href',
      '/island/child-1/worlds/creature-care-cove',
    );
    expect(screen.getByText('Sail to Creature Care Cove to visit.')).toBeInTheDocument();
  });

  it('says so for a Realm this child cannot see', async () => {
    renderAt('/island/child-1/realms/somewhere-else');
    expect(await screen.findByRole('alert')).toHaveTextContent('We could not find that Realm.');
    expect(screen.getByRole('link', { name: 'Back to Realms' })).toBeInTheDocument();
  });

  it('reuses the Explorer’s fresh catalog instead of reading it again', async () => {
    const first = renderAt('/island/child-1/realms');
    await screen.findByRole('article', { name: 'Learning Adventure Island' });
    first.unmount();
    renderAt('/island/child-1/realms/learning-adventure-island');
    await screen.findByRole('heading', { level: 1, name: 'Learning Adventure Island' });
    await waitFor(() => expect(mocks.getIslandsFor).toHaveBeenCalledTimes(1));
  });
});
