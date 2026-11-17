import { PAINTED_WORDS_CHANGE_KEY, selectPaintedWordsSlug } from '../adventures/content';
import type { AdventureDefinition } from '../adventures/engine/types';
import type { AgeBandValue } from '../child-profile/constants';
import { producersOf } from './adventureMapping';
import {
  standingOf,
  type StorybookEntry,
  type StorybookPage,
  type StorybookProgress,
  type StorybookState,
} from './pages';

/**
 * The Great Storybook's page state model (SC-R04-06). One canonical, derived
 * vocabulary read by the 3D book, the card route and the Hall of Heroes, so
 * they cannot disagree.
 *
 * - `UNDISCOVERED`: the child has not been to the page's room.
 * - `DISCOVERED`: they have been there, but not started the challenge.
 * - `IN_PROGRESS`: they started the adventure that restores it.
 * - `RESTORED`: the record that names it exists. Nothing un-restores a page.
 *
 * Pure and total. Nothing here stores, grants or records anything: the page
 * itself stays derived from the records the castle's content already writes
 * (reboot roadmap section 4.1), so no new persistence model exists.
 */
export type PageState = 'UNDISCOVERED' | 'DISCOVERED' | 'IN_PROGRESS' | 'RESTORED';

/** What the caller knows about the child's visits and unfinished adventures. */
export interface PageStateContext {
  visitedRoomIds: ReadonlySet<string>;
  /** Slugs of adventures the child has started and not finished. */
  startedAdventureSlugs: ReadonlySet<string>;
}

export const NO_CONTEXT: PageStateContext = {
  visitedRoomIds: new Set(),
  startedAdventureSlugs: new Set(),
};

export function pageState(
  entry: StorybookEntry,
  context: PageStateContext = NO_CONTEXT,
  adventures?: readonly AdventureDefinition[],
): PageState {
  if (entry.restored) return 'RESTORED';
  const { page } = entry;
  const producers = producersOf(page, adventures).filter((p) => p.kind === 'ADVENTURE');
  if (producers.some((p) => context.startedAdventureSlugs.has(p.id))) return 'IN_PROGRESS';
  if (context.visitedRoomIds.has(page.roomId)) return 'DISCOVERED';
  return 'UNDISCOVERED';
}

/**
 * Whether anything currently writes this page's record for this band. A page
 * whose content was retired or unpublished has no producer, and must not hold a
 * child's book open forever or be offered as a link that goes nowhere.
 */
export function isPageAvailable(
  page: StorybookPage,
  band: AgeBandValue,
  adventures?: readonly AdventureDefinition[],
): boolean {
  if (page.source.kind === 'DISCOVERY') return true;
  return producersOf({ ...page, bands: [band] }, adventures).length > 0;
}

/**
 * The book a child can actually finish: required pages with no producer are set
 * aside, and an already restored page always stays (earned pages are never
 * taken away). If every required page were retired the book is never "whole"
 * by accident: `complete` still needs at least one required page.
 */
export function withAvailability(
  progress: StorybookProgress,
  adventures?: readonly AdventureDefinition[],
): StorybookProgress {
  const entries = progress.entries.filter(
    (entry) => entry.restored || isPageAvailable(entry.page, progress.band, adventures),
  );
  const required = entries.filter((entry) => entry.page.required);
  const restoredRequired = required.filter((entry) => entry.restored).length;
  const complete = required.length > 0 && restoredRequired === required.length;
  return {
    ...progress,
    entries,
    restoredRequired,
    totalRequired: required.length,
    restoredBonus: entries.filter((entry) => !entry.page.required && entry.restored).length,
    complete,
    state: standingOf(complete, progress.edition1Restored),
  };
}

/**
 * The adventure a missing page's "go" action should start, or `undefined` when
 * the page is a discovery or a story (the room and its own interaction lead
 * there). A replay of the Painted Words picks its second word set, so the
 * caller never has to know the two play-throughs exist.
 */
export function adventureForPage(
  page: StorybookPage,
  band: AgeBandValue,
  state: StorybookState,
  adventures?: readonly AdventureDefinition[],
): string | undefined {
  const producers = producersOf({ ...page, bands: [band] }, adventures).filter(
    (p) => p.kind === 'ADVENTURE',
  );
  if (producers.length === 0) return undefined;
  if (page.source.kind === 'WORLD_CHANGE' && page.source.changeKey === PAINTED_WORDS_CHANGE_KEY) {
    const slug = selectPaintedWordsSlug(state.worldChangeKeys);
    return producers.some((p) => p.id === slug) ? slug : producers[0].id;
  }
  return producers[0].id;
}

/**
 * A non-spoiling nudge for the first page still missing, in registry order, or
 * `undefined` when the book is whole. The hint text is authored on the page.
 */
export function nextMissingPage(progress: StorybookProgress): StorybookPage | undefined {
  return progress.entries.find((entry) => entry.page.required && !entry.restored)?.page;
}
