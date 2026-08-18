import { describe, expect, it } from 'vitest';
import { selectLibraryForChild } from './recommend';
import { listLibraryArcs } from './catalog';

const everyArc = listLibraryArcs();

describe('selectLibraryForChild', () => {
  it('offers only arcs authored for the child’s age band', () => {
    const selection = selectLibraryForChild({ ageBand: 'SPROUT', interests: [] });
    for (const arc of [...selection.recommended, ...selection.moreToExplore]) {
      expect(arc.story.supportedAgeBands).toContain('SPROUT');
    }
    for (const arc of selection.notYetForThisAge) {
      expect(arc.story.supportedAgeBands).not.toContain('SPROUT');
    }
  });

  it('accounts for every catalog arc exactly once', () => {
    const selection = selectLibraryForChild({ ageBand: 'PATHFINDER', interests: ['Fantasy'] });
    const seen = [
      ...selection.recommended,
      ...selection.moreToExplore,
      ...selection.notYetForThisAge,
    ].map((arc) => arc.story.slug);
    expect(seen.sort()).toEqual(everyArc.map((arc) => arc.story.slug).sort());
  });

  it('ranks an arc higher when it matches more of the child’s interests', () => {
    const selection = selectLibraryForChild({
      ageBand: 'EXPLORER',
      interests: ['Fantasy', 'Dinosaurs'],
    });
    const matchCounts = selection.recommended.map((arc) => arc.matchedInterests.length);
    expect(matchCounts).toEqual([...matchCounts].sort((a, b) => b - a));
  });

  it('recommends the dinosaur arc first to a child interested in dinosaurs', () => {
    const selection = selectLibraryForChild({ ageBand: 'PATHFINDER', interests: ['Dinosaurs'] });
    expect(selection.recommended[0]?.story.slug).toBe('dinosaur-expedition');
    expect(selection.recommended[0]?.matchedInterests).toEqual(['DINOSAURS', 'SCIENCE']);
  });

  it('never hides an age-appropriate arc just because no interest matches', () => {
    const withoutInterests = selectLibraryForChild({ ageBand: 'PATHFINDER', interests: [] });
    const withInterests = selectLibraryForChild({
      ageBand: 'PATHFINDER',
      interests: ['Dinosaurs'],
    });
    const playable = (selection: ReturnType<typeof selectLibraryForChild>) =>
      [...selection.recommended, ...selection.moreToExplore].map((arc) => arc.story.slug).sort();
    expect(playable(withInterests)).toEqual(playable(withoutInterests));
    expect(withoutInterests.recommended).toHaveLength(0);
    expect(withoutInterests.moreToExplore.length).toBeGreaterThan(0);
  });

  it('is stable between visits: equal-match arcs are ordered by title', () => {
    const first = selectLibraryForChild({ ageBand: 'PATHFINDER', interests: [] });
    const second = selectLibraryForChild({ ageBand: 'PATHFINDER', interests: [] });
    const titles = first.moreToExplore.map((arc) => arc.story.title);
    expect(titles).toEqual([...titles].sort((a, b) => a.localeCompare(b)));
    expect(second.moreToExplore.map((arc) => arc.story.title)).toEqual(titles);
  });

  it('gates the Explorer-only mystery arc away from a Pathfinder', () => {
    const selection = selectLibraryForChild({ ageBand: 'PATHFINDER', interests: ['Fantasy'] });
    expect(selection.notYetForThisAge.map((arc) => arc.story.slug)).toContain(
      'the-castles-secret-door',
    );
  });

  it('tolerates a profile whose interests were never set', () => {
    const selection = selectLibraryForChild({ ageBand: 'EXPLORER', interests: null });
    expect(selection.recommended).toHaveLength(0);
    expect(selection.moreToExplore.length).toBeGreaterThan(0);
  });
});
