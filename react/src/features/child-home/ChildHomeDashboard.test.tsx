import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { ChildHome, HomeRegion } from '../../api/play/homeApi';
import { ChildHomeDashboard, countLabel } from './ChildHomeDashboard';

const CHILD = 'child-1';

const region = (overrides: Partial<HomeRegion> = {}): HomeRegion => ({
  regionId: 'treasure-rush-cove',
  title: 'Treasure Cove',
  description: 'Help Pip find the chests.',
  placeTitle: 'Pirate Builder Bay',
  available: true,
  status: 'IN_PROGRESS',
  chestsTotal: 4,
  chestsOpened: 1,
  canResume: true,
  ...overrides,
});

const home = (overrides: Partial<ChildHome> = {}): ChildHome => ({
  lastRegion: null,
  resume: [],
  nextRegions: [],
  progress: {
    completedSessions: 0,
    worldChanges: 0,
    items: 0,
    questsCompleted: 0,
    questsActive: 0,
  },
  recentItems: [],
  ...overrides,
});

function renderDashboard(state: Parameters<typeof ChildHomeDashboard>[0]['state']) {
  return render(
    <MemoryRouter>
      <ChildHomeDashboard childId={CHILD} state={state} />
    </MemoryRouter>,
  );
}

describe('ChildHomeDashboard (AP-02)', () => {
  it('features the open adventure with a link back into its 3D Area', () => {
    renderDashboard({ status: 'ready', home: home({ resume: [region()] }) });
    const card = screen
      .getByRole('heading', { name: 'Continue your adventure' })
      .closest('article')!;
    expect(within(card).getByText('Treasure Cove')).toBeInTheDocument();
    expect(within(card).getByRole('progressbar', { name: 'Treasure chests' })).toHaveAttribute(
      'aria-valuetext',
      '1 of 4 chests opened',
    );
    expect(within(card).getByRole('link', { name: 'Keep going' })).toHaveAttribute(
      'href',
      `/island/${CHILD}/explore/treasure-rush-cove`,
    );
  });

  it('summarises quests, treasures and the island from the server’s counts', () => {
    renderDashboard({
      status: 'ready',
      home: home({
        progress: {
          completedSessions: 3,
          worldChanges: 1,
          items: 2,
          questsCompleted: 1,
          questsActive: 2,
        },
        recentItems: [
          { itemId: 'coin', displayName: 'Gold coin' },
          { itemId: 'shell', displayName: 'Spiral shell' },
        ],
      }),
    });
    expect(screen.getByText('2 quests going, 1 quest finished.')).toBeInTheDocument();
    expect(screen.getByText('You have found 2 treasures.')).toBeInTheDocument();
    expect(
      within(screen.getByRole('list', { name: 'Newest finds' })).getAllByRole('listitem'),
    ).toHaveLength(2);
    expect(
      screen.getByText('You finished 3 adventures and changed the island 1 time.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open your quest journal' })).toHaveAttribute(
      'href',
      `/island/${CHILD}/quests`,
    );
  });

  it('shows no XP, level, score or streak, because none has a real source', () => {
    renderDashboard({
      status: 'ready',
      home: home({
        resume: [region()],
        progress: {
          completedSessions: 9,
          worldChanges: 9,
          items: 9,
          questsCompleted: 9,
          questsActive: 9,
        },
      }),
    });
    expect(screen.queryByText(/\b(xp|level|score|streak|points)\b/i)).not.toBeInTheDocument();
  });

  it('welcomes a brand new child with calm empty states', () => {
    renderDashboard({ status: 'ready', home: home() });
    expect(screen.getByRole('heading', { name: 'Ready for an adventure?' })).toBeInTheDocument();
    expect(screen.getByText(/No quests yet/)).toBeInTheDocument();
    expect(screen.getByText(/No treasures yet/)).toBeInTheDocument();
    expect(
      screen.getByText(/Your first adventure will start changing the island/),
    ).toBeInTheDocument();
  });

  it('has loading and error states that never block the rest of the page', () => {
    const { unmount } = renderDashboard({ status: 'loading' });
    expect(screen.getByRole('status')).toHaveTextContent('Getting your adventures ready...');
    unmount();
    renderDashboard({ status: 'error' });
    expect(screen.getByRole('alert')).toHaveTextContent('You can still choose a place below.');
  });

  it('counts in words a child can hear', () => {
    expect(countLabel(1, 'quest')).toBe('1 quest');
    expect(countLabel(0, 'quest')).toBe('0 quests');
  });
});
