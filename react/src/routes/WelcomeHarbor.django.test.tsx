import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** AP-02 and AP-03: the child homepage in a build with the Django API (`VITE_BACKEND=django`). */

const mocks = vi.hoisted(() => ({
  getChildProfile: vi.fn(),
  getIslandsFor: vi.fn(),
  getChildHomeFor: vi.fn(),
  getCompanionProfile: vi.fn(),
  listAllWorldChanges: vi.fn(),
  loadCatalogSnapshot: vi.fn(),
}));

vi.mock('../api/config', () => ({ DJANGO_API_CONFIG: { enabled: true, baseUrl: '' } }));
vi.mock('../api/play/islandsApi', () => ({ getIslandsFor: mocks.getIslandsFor }));
vi.mock('../api/play/homeApi', () => ({ getChildHomeFor: mocks.getChildHomeFor }));
vi.mock('../features/child-profile/api', () => ({ getChildProfile: mocks.getChildProfile }));
vi.mock('../features/island/api', () => ({
  getCompanionProfile: mocks.getCompanionProfile,
  getOrCreateCompanionProfile: vi.fn(),
}));
vi.mock('../features/adventures/api', () => ({ listAllWorldChanges: mocks.listAllWorldChanges }));
vi.mock('../features/catalog/availabilityApi', () => ({
  loadCatalogSnapshot: mocks.loadCatalogSnapshot,
}));

import { WelcomeHarbor } from './WelcomeHarbor';

const AREA = { regionId: 'treasure-rush-cove', title: 'Treasure Cove', available: true };

function islandsView() {
  return {
    autoSelectIslandId: null,
    islands: [
      {
        islandId: 'learning-adventure-island',
        title: 'Learning Adventure Island',
        tagline: 'Home',
        isHome: true,
        ageBands: ['PATHFINDER'],
        subjects: ['Counting'],
        thumbnailAssetId: null,
        unlocked: true,
        lockedHint: null,
        progress: { placesExplored: 1, placesTotal: 2 },
        places: [
          {
            placeId: 'pirate-builder-bay',
            title: 'Pirate Builder Bay',
            tagline: 'Build',
            adventureCount: 2,
            explored: true,
            area: AREA,
          },
          {
            placeId: 'storykeeper-castle',
            title: 'Storykeeper Castle',
            tagline: 'Stories',
            adventureCount: 1,
            explored: false,
            area: null,
          },
        ],
      },
      {
        islandId: 'creature-care-cove',
        title: 'Creature Care Cove',
        tagline: 'Cove',
        isHome: false,
        ageBands: ['PATHFINDER'],
        subjects: ['Caring routines'],
        thumbnailAssetId: null,
        unlocked: false,
        lockedHint: 'Help Pip at Pirate Builder Bay.',
        progress: { placesExplored: 0, placesTotal: 2 },
        places: [],
      },
    ],
  };
}

const HOME = {
  lastRegion: null,
  resume: [
    {
      regionId: 'treasure-rush-cove',
      title: 'Treasure Cove',
      description: 'Help Pip.',
      placeTitle: 'Pirate Builder Bay',
      available: true,
      status: 'IN_PROGRESS',
      chestsTotal: 4,
      chestsOpened: 2,
      canResume: true,
    },
  ],
  nextRegions: [],
  progress: {
    completedSessions: 1,
    worldChanges: 1,
    items: 1,
    questsCompleted: 0,
    questsActive: 1,
  },
  recentItems: [{ itemId: 'coin', displayName: 'Gold coin' }],
};

function renderHome() {
  return render(
    <MemoryRouter initialEntries={['/island/child-1']}>
      <Routes>
        <Route path="/island/:childId" element={<WelcomeHarbor />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getChildProfile.mockResolvedValue({
    id: 'child-1',
    nickname: 'Robin',
    ageBand: 'PATHFINDER',
    avatarKey: 'fox',
  });
  mocks.getIslandsFor.mockResolvedValue(islandsView());
  mocks.getChildHomeFor.mockResolvedValue(HOME);
});

describe('WelcomeHarbor with the Django API (AP-02, AP-03)', () => {
  it('draws the dashboard and the way to the Realm Explorer, and never reads Amplify', async () => {
    renderHome();
    expect(
      await screen.findByRole('heading', { name: 'Continue your adventure' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Keep going' })).toHaveAttribute(
      'href',
      '/island/child-1/explore/treasure-rush-cove',
    );

    const teaser = screen.getByRole('region', { name: /Realm Explorer/ });
    expect(within(teaser).getByRole('link', { name: 'Explore the Realms' })).toHaveAttribute(
      'href',
      '/island/child-1/realms',
    );
    // The Realms have their own page now; Home neither lists them nor reads the catalog.
    expect(screen.queryByRole('region', { name: 'Where to next?' })).not.toBeInTheDocument();
    expect(mocks.getIslandsFor).not.toHaveBeenCalled();

    expect(mocks.getChildHomeFor).toHaveBeenCalledWith('child-1');
    expect(mocks.getCompanionProfile).not.toHaveBeenCalled();
    expect(mocks.listAllWorldChanges).not.toHaveBeenCalled();
    expect(mocks.loadCatalogSnapshot).not.toHaveBeenCalled();
  });

  it('keeps the way to the Realms when the home summary fails, and says so calmly', async () => {
    mocks.getChildHomeFor.mockRejectedValue(new Error('offline'));
    renderHome();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You can still explore the Realms below.',
    );
    expect(screen.getByRole('link', { name: 'Explore the Realms' })).toBeInTheDocument();
  });

  it('shows the calm error when the child profile itself cannot load', async () => {
    mocks.getChildProfile.mockRejectedValue(new Error('offline'));
    renderHome();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Something went wrong loading the island.',
    );
  });

  it('says so when the child profile does not exist', async () => {
    mocks.getChildProfile.mockResolvedValue(null);
    renderHome();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'We could not find that child profile.',
    );
  });
});
