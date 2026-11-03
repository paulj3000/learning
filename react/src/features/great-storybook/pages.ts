import type { AgeBandValue } from '../child-profile/constants';

/**
 * The Great Storybook's pages (SC-R04, reboot roadmap section 4.1). The
 * premise: the Great Storybook was damaged and its pages are scattered through
 * Storykeeper Castle. Keeper Quill asks the child to recover them.
 *
 * **A page is derived, never stored.** Each one names a record that the
 * castle's existing, server-validated content already writes: a world change
 * the Tale or the secret-door arc records when it is finished, or the nook
 * discovery. So a child who finished the Tale last month already has that page
 * the first time they see the book, no replay is asked of them, a page cannot be
 * recovered twice, and no new store can disagree with the ones that exist. This
 * is the one place those sources are named; the quest content, the castle
 * presentation and the server's copy (`lai/apps/regions/great_storybook_pages.json`,
 * kept in step by a test) all read it.
 *
 * **Age is respected by what is required, not by hiding the book.** Each band's
 * Storybook is whole when *its* required pages are back: a Sprout is never shown
 * slots meant for an eight-year-old. The hidden nook page is an optional bonus
 * for every band, because requiring it would force a child to find the castle's
 * one unmarked secret to finish.
 */

export type PageSource =
  | { kind: 'WORLD_CHANGE'; changeKey: string; locationSlug: string }
  | { kind: 'DISCOVERY'; discoveryId: string };

export interface StorybookPage {
  /** Stable. Never renamed: it is how a page is named in tests, docs and saves of the future. */
  id: string;
  /** Child-facing, readable aloud. */
  title: string;
  /** The bands whose Storybook has this page. */
  bands: readonly AgeBandValue[];
  /** Whether this band must recover it for the book to be whole. A bonus page never is. */
  required: boolean;
  source: PageSource;
  /** The castle room where the page's challenge is, as a `castleLayout` room id. */
  roomId: string;
  /** Child-facing, non-spoiling: where to look, never how to solve it. */
  hint: string;
  /** Child-facing: what the page says once it is back. */
  restoredText: string;
}

export const STORYBOOK_PAGES: readonly StorybookPage[] = [
  {
    id: 'page-first-story',
    title: 'The First Story',
    bands: ['SPROUT', 'PATHFINDER'],
    required: true,
    source: {
      kind: 'WORLD_CHANGE',
      changeKey: 'FIRST_STORY_TOLD',
      locationSlug: 'storykeeper-castle',
    },
    roomId: 'story-hall',
    hint: 'Tell a story with Keeper Quill in the Story Hall.',
    restoredText: 'The story you told has flown back into the book.',
  },
  {
    id: 'page-three-clues',
    title: 'Three Clues',
    bands: ['EXPLORER'],
    required: true,
    source: {
      kind: 'WORLD_CHANGE',
      changeKey: 'SECRET_DOOR_CLUES_COLLECTED',
      locationSlug: 'castle-secret-passage',
    },
    roomId: 'great-library',
    hint: 'Look for clues in the Great Library.',
    restoredText: 'The three clues you found are written on this page.',
  },
  {
    id: 'page-pattern-lock',
    title: 'The Pattern Lock',
    bands: ['EXPLORER'],
    required: true,
    source: {
      kind: 'WORLD_CHANGE',
      changeKey: 'CASTLE_SECRET_DOOR_OPENED',
      locationSlug: 'castle-secret-passage',
    },
    roomId: 'great-library',
    hint: 'There is a door with no handle in the Great Library.',
    restoredText: 'The pattern you worked out opened the door, and this page came back.',
  },
  {
    id: 'page-what-was-waiting',
    title: 'What Was Waiting',
    bands: ['EXPLORER'],
    required: true,
    source: {
      kind: 'WORLD_CHANGE',
      changeKey: 'THE_CASTLES_SECRET_DOOR_COMPLETE',
      locationSlug: 'castle-secret-passage',
    },
    roomId: 'great-library',
    hint: 'Finish what you started at the secret door.',
    restoredText: 'You found what was waiting, and the last page settled into place.',
  },
  {
    id: 'page-tapestry',
    title: 'The Hidden Page',
    bands: ['SPROUT', 'PATHFINDER', 'EXPLORER'],
    // A bonus for children who explore. Never required: see the file header.
    required: false,
    source: { kind: 'DISCOVERY', discoveryId: 'castle-tapestry-stair' },
    roomId: 'story-hall',
    hint: 'One page is hiding. Explorers might find it.',
    restoredText: 'You found a page that was hiding, and it is back in the book.',
  },
];

/** What the pure functions read. A subset of a child's world state, whichever store it came from. */
export interface StorybookState {
  worldChangeKeys: readonly string[];
  discoveryIds: readonly string[];
}

export function pagesForBand(band: AgeBandValue): readonly StorybookPage[] {
  return STORYBOOK_PAGES.filter((page) => page.bands.includes(band));
}

export function isPageRestored(page: StorybookPage, state: StorybookState): boolean {
  return page.source.kind === 'WORLD_CHANGE'
    ? state.worldChangeKeys.includes(page.source.changeKey)
    : state.discoveryIds.includes(page.source.discoveryId);
}

export interface StorybookEntry {
  page: StorybookPage;
  restored: boolean;
}

export interface StorybookProgress {
  band: AgeBandValue;
  /** This band's pages, in registry order, each with whether it is back. */
  entries: readonly StorybookEntry[];
  /** Required pages restored, and required pages in all. A bonus page is never in either. */
  restoredRequired: number;
  totalRequired: number;
  /** Bonus pages found. */
  restoredBonus: number;
  /** Whole when every required page is back. A band with no required page is never whole. */
  complete: boolean;
}

function summarize(band: AgeBandValue, entries: readonly StorybookEntry[]): StorybookProgress {
  const required = entries.filter((entry) => entry.page.required);
  const restoredRequired = required.filter((entry) => entry.restored).length;
  return {
    band,
    entries,
    restoredRequired,
    totalRequired: required.length,
    restoredBonus: entries.filter((entry) => !entry.page.required && entry.restored).length,
    complete: required.length > 0 && restoredRequired === required.length,
  };
}

/**
 * Where a child's Storybook stands. Pure and total: the same state always gives
 * the same book, an empty state gives an empty book, and nothing is granted,
 * recorded or changed by asking.
 */
export function storybookProgress(state: StorybookState, band: AgeBandValue): StorybookProgress {
  return summarize(
    band,
    pagesForBand(band).map((page) => ({ page, restored: isPageRestored(page, state) })),
  );
}

/**
 * What a child is shown: every required page, and the hidden bonus page **only once it
 * is found**. An empty slot for a secret the child has not found would be a signpost.
 */
export function visibleEntries(progress: StorybookProgress): readonly StorybookEntry[] {
  return progress.entries.filter((entry) => entry.page.required || entry.restored);
}

/**
 * The same book, also counting the pages the server reports restored. A union: each store
 * only ever knows records that really exist, so a page either one holds is back. An id the
 * registry does not know is ignored.
 */
export function withRestored(
  progress: StorybookProgress,
  restoredPageIds: ReadonlySet<string>,
): StorybookProgress {
  return summarize(
    progress.band,
    progress.entries.map((entry) => ({
      page: entry.page,
      restored: entry.restored || restoredPageIds.has(entry.page.id),
    })),
  );
}

/** The pages that are back in `after` and were not in `before`, in registry order. */
export function newlyRestored(
  before: ReadonlySet<string>,
  after: StorybookProgress,
): readonly StorybookPage[] {
  return after.entries
    .filter((entry) => entry.restored && !before.has(entry.page.id))
    .map((entry) => entry.page);
}

/** The ids of the pages that are back. */
export function restoredIds(progress: StorybookProgress): ReadonlySet<string> {
  return new Set(progress.entries.filter((entry) => entry.restored).map((entry) => entry.page.id));
}
