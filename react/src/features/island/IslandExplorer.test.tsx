import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { IslandExplorer, ageRangeLabel } from './IslandExplorer';
import type { ExplorerIsland } from '../worlds/islandExplorer';

const here: ExplorerIsland = {
  slug: 'learning-adventure-island',
  title: 'Learning Adventure Island',
  tagline: 'Your home island.',
  status: 'HERE',
  subjects: ['Counting', 'Vocabulary'],
  ageBands: ['SPROUT', 'PATHFINDER', 'EXPLORER'],
  progress: { explored: 1, total: 4 },
  places: [
    {
      slug: 'pirate-builder-bay',
      title: 'Pirate Builder Bay',
      tagline: 'Counting and building.',
      href: '/island/c/locations/pirate-builder-bay',
      explored: true,
      area: { title: 'Treasure Cove', href: '/island/c/explore/treasure-rush-cove' },
    },
    {
      slug: 'storykeeper-castle',
      title: 'Storykeeper Castle',
      tagline: 'Stories.',
      href: '/island/c/locations/storykeeper-castle',
      explored: false,
    },
  ],
};

const locked: ExplorerIsland = {
  slug: 'creature-care-cove',
  title: 'Creature Care Cove',
  tagline: 'A small island.',
  status: 'LOCKED',
  lockedHint: 'Help Pip first.',
  subjects: ['Caring routines'],
  ageBands: ['PATHFINDER'],
  progress: { explored: 0, total: 2 },
  places: [],
};

function renderExplorer(islands: ExplorerIsland[]) {
  render(
    <MemoryRouter>
      <IslandExplorer islands={islands} />
    </MemoryRouter>,
  );
}

describe('IslandExplorer discovery details (AP-03)', () => {
  it('shows what an island teaches, who it is for and places explored', () => {
    renderExplorer([here]);
    expect(screen.getByLabelText('Learn: Counting, Vocabulary')).toBeInTheDocument();
    expect(screen.getByText('Ages 3 to 8')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Explored' })).toHaveAttribute(
      'aria-valuetext',
      '1 of 4 places explored',
    );
  });

  it('marks explored places and offers a place’s 3D Area beside it (Treasure Cove)', () => {
    renderExplorer([here]);
    const bay = screen.getByRole('link', { name: /Pirate Builder Bay/ });
    expect(within(bay).getByText('Explored')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Explore Treasure Cove in 3D/ })).toHaveAttribute(
      'href',
      '/island/c/explore/treasure-rush-cove',
    );
    expect(
      within(screen.getByRole('link', { name: /Storykeeper Castle/ })).queryByText('Explored'),
    ).not.toBeInTheDocument();
  });

  it('shows a locked island’s hint and subjects, but no link and no progress bar', () => {
    renderExplorer([locked]);
    expect(screen.getByText('Help Pip first.')).toBeInTheDocument();
    expect(screen.getByLabelText('Learn: Caring routines')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('draws nothing extra when the details are absent (a build without the Django API)', () => {
    renderExplorer([{ ...here, subjects: undefined, ageBands: undefined, progress: undefined }]);
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.queryByText(/^Ages /)).not.toBeInTheDocument();
  });

  it('turns age bands into an age range', () => {
    expect(ageRangeLabel(['PATHFINDER'])).toBe('Ages 5 to 6');
    expect(ageRangeLabel(['SPROUT', 'EXPLORER'])).toBe('Ages 3 to 8');
    expect(ageRangeLabel([])).toBeNull();
    expect(ageRangeLabel(['UNKNOWN'])).toBeNull();
  });
});
