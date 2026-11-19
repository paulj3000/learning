import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { PlaceCard } from './PlaceCard';
import type { RealmPlace } from './realmCatalog';

const base: RealmPlace = {
  slug: 'firepeak-heart',
  title: 'Heart of Firepeak',
  tagline: '',
  description: '',
  skills: [],
  subjectAreas: [],
  thumbnailAssetId: null,
  adventureCount: 0,
  explored: true,
  questCount: 1,
  questsCompleted: 0,
  completed: false,
  href: null,
  area: { title: 'Firepeak Heart', href: '/play/x', inProgress: false },
};

const show = (place: RealmPlace) =>
  render(
    <MemoryRouter>
      <PlaceCard place={place} realmTitle="Firepeak" />
    </MemoryRouter>,
  );

describe('PlaceCard quest-based places', () => {
  it('counts offered quests as adventures', () => {
    show(base);
    expect(screen.getByText('1 adventure')).toBeInTheDocument();
  });
  it('shows Completed and still links in for replay', () => {
    show({ ...base, questsCompleted: 1, completed: true });
    expect(screen.getByText(/Completed/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Visit Firepeak Heart again/ })).toHaveAttribute('href', '/play/x');
  });
});
