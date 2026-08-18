import { STORY_DEFINITIONS } from '../story/content';
import type { StoryDefinition } from '../story/engine/types';
import type { AdventureInterest } from './interests';
import type { AdventureTheme } from './themes';

/**
 * The Adventure Library catalog (docs/ROADMAP.md Phase 15,
 * `docs/LEARNING_ADVENTURE_ISLAND_EXPLORABLE_WORLD_ROADMAP.md` section 34).
 *
 * A catalog entry is shelving metadata *about* an arc; the arc itself is the
 * `StoryDefinition` in `src/features/story/content/`. They are kept apart on
 * purpose: the Story Engine should not have to know what a theme or an
 * interest tag is in order to run a chapter, and the library should not have
 * to re-declare chapters in order to shelve one.
 *
 * Every entry points at a real, playable, fully authored arc. Section 34
 * lists fifteen candidate titles; five are built (one per theme), and the
 * remaining ten are deliberately absent rather than present as disabled
 * "coming soon" cards, which would be a dead end dressed up as content —
 * the same call Phases 13 and 14 made for their un-authored discovery
 * points. `catalog.test.ts` asserts the catalog and the story registry stay
 * exactly in step, so an arc can never be shipped unshelved or shelved
 * unbuilt.
 */
export interface LibraryEntry {
  storySlug: string;
  theme: AdventureTheme;
  /** Ranking signal only. An arc is never *hidden* for lacking a matching tag. */
  interests: readonly AdventureInterest[];
  /** One short child-facing line for the library card; the arc's own `description` is the longer version. */
  blurb: string;
}

export const ADVENTURE_LIBRARY: LibraryEntry[] = [
  {
    storySlug: 'dragon-of-ember-mountain',
    theme: 'FANTASY',
    interests: ['DRAGONS', 'MAGIC', 'MYSTERIES'],
    blurb: 'Follow the smoke over the mountain and find out who really lives up there.',
  },
  {
    storySlug: 'dinosaur-expedition',
    theme: 'EXPLORATION',
    interests: ['DINOSAURS', 'SCIENCE'],
    blurb: 'Dig at Fossil Ridge, follow giant footprints, and work out who left them.',
  },
  {
    storySlug: 'robot-rescue',
    theme: 'BUILDING',
    interests: ['ROBOTS', 'BUILDING', 'SCIENCE'],
    blurb: 'A little harbor robot has stopped working. Gather the parts and build it back.',
  },
  {
    storySlug: 'save-the-butterfly-garden',
    theme: 'NATURE',
    interests: ['ANIMALS', 'SCIENCE'],
    blurb: 'The garden is quiet and the butterflies are gone. Plant it back to life.',
  },
  {
    storySlug: 'the-castles-secret-door',
    theme: 'MYSTERY',
    interests: ['MYSTERIES', 'CASTLES', 'MAGIC'],
    blurb: 'A door in Storykeeper Castle has no handle. Find the pattern that opens it.',
  },
];

export function getLibraryEntry(storySlug: string): LibraryEntry | undefined {
  return ADVENTURE_LIBRARY.find((entry) => entry.storySlug === storySlug);
}

export interface LibraryArc {
  entry: LibraryEntry;
  story: StoryDefinition;
}

/**
 * Joins each catalog entry to its arc. An entry with no matching arc is
 * dropped rather than rendered as a broken card; `catalog.test.ts` makes
 * that case impossible to ship, so this is a runtime guard, not a feature.
 */
export function listLibraryArcs(): LibraryArc[] {
  const arcs: LibraryArc[] = [];
  for (const entry of ADVENTURE_LIBRARY) {
    const story = STORY_DEFINITIONS.find((candidate) => candidate.slug === entry.storySlug);
    if (story) arcs.push({ entry, story });
  }
  return arcs;
}
