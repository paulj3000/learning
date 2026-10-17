import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AdventureLibraryView } from './AdventureLibraryView';
import type { AgeBandValue } from '../child-profile/constants';

interface RenderOptions {
  ageBand?: AgeBandValue;
  interests?: string[];
  startedStorySlugs?: string[];
  completedStorySlugs?: string[];
}

function renderLibrary({
  ageBand = 'PATHFINDER',
  interests = [],
  startedStorySlugs = [],
  completedStorySlugs = [],
}: RenderOptions = {}) {
  return render(
    <MemoryRouter>
      <AdventureLibraryView
        childId="child-1"
        ageBand={ageBand}
        interests={interests}
        startedStorySlugs={startedStorySlugs}
        completedStorySlugs={completedStorySlugs}
      />
    </MemoryRouter>,
  );
}

describe('AdventureLibraryView', () => {
  it('links every offered arc to its story route', () => {
    renderLibrary({ interests: ['Dinosaurs'] });
    expect(screen.getByRole('link', { name: /Dinosaur Expedition/ })).toHaveAttribute(
      'href',
      '/island/child-1/stories/dinosaur-expedition',
    );
  });

  it('puts interest-matching arcs under "Picked for you"', () => {
    renderLibrary({ interests: ['Dinosaurs'] });
    const picked = screen.getByRole('region', { name: 'Picked for you' });
    expect(within(picked).getByRole('link', { name: /Dinosaur Expedition/ })).toBeInTheDocument();
    const more = screen.getByRole('region', { name: 'More to explore' });
    expect(within(more).queryByRole('link', { name: /Dinosaur Expedition/ })).toBeNull();
  });

  it('shows every other age-appropriate arc under "More to explore"', () => {
    renderLibrary({ interests: ['Dinosaurs'] });
    const more = screen.getByRole('region', { name: 'More to explore' });
    expect(
      within(more).getByRole('link', { name: /The Dragon of Ember Mountain/ }),
    ).toBeInTheDocument();
  });

  it('drops the "Picked for you" heading entirely when nothing matches', () => {
    renderLibrary({ interests: [] });
    expect(screen.queryByRole('region', { name: 'Picked for you' })).toBeNull();
    expect(screen.getByRole('region', { name: 'More to explore' })).toBeInTheDocument();
  });

  it('never links an arc authored for another age band', () => {
    renderLibrary({ ageBand: 'SPROUT' });
    expect(screen.queryByRole('link', { name: /Dinosaur Expedition/ })).toBeNull();
    expect(screen.getByRole('link', { name: /Save the Butterfly Garden/ })).toBeInTheDocument();
  });

  it('names age-gated arcs in a calm "not yet" note instead of hiding them', () => {
    renderLibrary({ ageBand: 'SPROUT' });
    expect(screen.getByText(/waiting here for another day/)).toHaveTextContent(
      /Dinosaur Expedition/,
    );
  });

  it('does not tell an older child that a younger band’s arc needs them to grow up', () => {
    renderLibrary({ ageBand: 'EXPLORER' });
    const note = screen.getByText(/waiting here for another day/);
    expect(note).toHaveTextContent(/Save the Butterfly Garden/);
    expect(note.textContent).not.toMatch(/older/);
  });

  it('marks a started story and a finished story differently', () => {
    renderLibrary({
      startedStorySlugs: ['robot-rescue'],
      completedStorySlugs: ['dinosaur-expedition'],
    });
    expect(
      within(screen.getByRole('link', { name: /Robot Rescue/ })).getByText('Keep going'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('link', { name: /Dinosaur Expedition/ })).getByText(
        'You finished this one',
      ),
    ).toBeInTheDocument();
  });

  it('shows no progress language for a story that was never opened', () => {
    renderLibrary();
    const card = screen.getByRole('link', { name: /Robot Rescue/ });
    expect(within(card).queryByText('Keep going')).toBeNull();
    expect(within(card).queryByText('You finished this one')).toBeNull();
  });

  it('always offers the way back to the map', () => {
    renderLibrary();
    expect(screen.getByRole('link', { name: 'Back to the map' })).toHaveAttribute(
      'href',
      '/island/child-1',
    );
  });
});
