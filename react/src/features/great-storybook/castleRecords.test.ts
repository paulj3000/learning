import { describe, expect, it } from 'vitest';
import { castleAdventures, castleCompletionSources } from './castleRecords';

describe('castle records catalog (GE-072)', () => {
  it('finds the castle adventures and stories in the authored content, each with a completion record', () => {
    const adventures = castleAdventures().map((adventure) => adventure.slug);
    for (const slug of [
      'the-storykeepers-tale',
      'quills-picture-story',
      'the-painted-words',
      'secret-door-chapter-1-three-clues',
      'secret-door-chapter-2-pattern-lock',
    ]) {
      expect(adventures, slug).toContain(slug);
    }
    const sources = castleCompletionSources();
    expect(sources.length).toBeGreaterThanOrEqual(adventures.length);
    for (const source of sources) expect(source.changeKey, source.id).toMatch(/^[A-Z0-9_]+$/);
    expect(sources.some((source) => source.kind === 'STORY')).toBe(true);
  });

  it('ignores adventures from other places', () => {
    expect(
      castleAdventures().every((adventure) => adventure.locationSlug !== 'pirate-builder-bay'),
    ).toBe(true);
  });
});
