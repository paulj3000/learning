import { describe, expect, it } from 'vitest';
import { ADVENTURE_LIBRARY, getLibraryEntry, listLibraryArcs } from './catalog';
import { ADVENTURE_INTERESTS } from './interests';
import { ADVENTURE_THEMES } from './themes';
import { STORY_DEFINITIONS } from '../story/content';

describe('ADVENTURE_LIBRARY', () => {
  it('shelves every authored story arc, and shelves nothing that does not exist', () => {
    const shelved = ADVENTURE_LIBRARY.map((entry) => entry.storySlug).sort();
    const authored = STORY_DEFINITIONS.map((story) => story.slug).sort();
    expect(shelved).toEqual(authored);
  });

  it('has one distinct entry per story slug', () => {
    const slugs = ADVENTURE_LIBRARY.map((entry) => entry.storySlug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('covers all five roadmap themes', () => {
    const themes = new Set(ADVENTURE_LIBRARY.map((entry) => entry.theme));
    for (const theme of ADVENTURE_THEMES) {
      expect(themes).toContain(theme);
    }
  });

  it('only uses known interest tags, and tags every arc with at least one', () => {
    for (const entry of ADVENTURE_LIBRARY) {
      expect(entry.interests.length).toBeGreaterThan(0);
      for (const tag of entry.interests) {
        expect(ADVENTURE_INTERESTS).toContain(tag);
      }
    }
  });

  it('gives every arc a short child-facing blurb', () => {
    for (const entry of ADVENTURE_LIBRARY) {
      expect(entry.blurb.length).toBeGreaterThan(0);
      expect(entry.blurb.length).toBeLessThanOrEqual(120);
      expect(entry.blurb).not.toContain('—');
    }
  });

  it('joins each entry to its arc', () => {
    const arcs = listLibraryArcs();
    expect(arcs).toHaveLength(ADVENTURE_LIBRARY.length);
    for (const arc of arcs) {
      expect(arc.story.slug).toBe(arc.entry.storySlug);
    }
  });

  it('looks an entry up by story slug', () => {
    expect(getLibraryEntry('dinosaur-expedition')?.theme).toBe('EXPLORATION');
    expect(getLibraryEntry('not-a-story')).toBeUndefined();
  });

  it('spans more than one age band across the library', () => {
    const bands = new Set(listLibraryArcs().flatMap((arc) => arc.story.supportedAgeBands));
    expect(bands.size).toBeGreaterThan(1);
  });
});
