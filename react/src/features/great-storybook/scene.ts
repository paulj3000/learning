import type { StorybookProgress } from './pages';

/**
 * What the castle's 3D Great Storybook needs to draw (SC-R04-03), and nothing else.
 *
 * The scene draws the book from the records: it never decides whether a page is back and
 * never grants one. This is the whole interface between the two: which of the band's required
 * pages are back (in registry order, one flag each), whether the hidden bonus page has been found,
 * and whether the book is whole. The book has room for three required pages and one bonus, a
 * capacity a test holds the registry to.
 */
export interface StorybookSceneState {
  required: readonly boolean[];
  bonusFound: boolean;
  complete: boolean;
}

/** The most required pages a band's book can show in the castle, and bonus pages. */
export const STORYBOOK_REQUIRED_SLOTS = 3;
export const STORYBOOK_BONUS_SLOTS = 1;

export function toSceneState(progress: StorybookProgress): StorybookSceneState {
  return {
    required: progress.entries
      .filter((entry) => entry.page.required)
      .map((entry) => entry.restored),
    bonusFound: progress.entries.some((entry) => !entry.page.required && entry.restored),
    complete: progress.complete,
  };
}
