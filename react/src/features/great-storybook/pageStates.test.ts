import { describe, expect, it } from 'vitest';
import { THE_STORYKEEPERS_TALE } from '../adventures/content';
import { STORYBOOK_PAGES, storybookProgress, type StorybookEntry } from './pages';
import {
  NO_CONTEXT,
  adventureForPage,
  isPageAvailable,
  nextMissingPage,
  pageState,
  withAvailability,
} from './pageStates';

const page = (id: string) => STORYBOOK_PAGES.find((p) => p.id === id)!;
const entry = (id: string, restored = false): StorybookEntry => ({ page: page(id), restored });
const EMPTY = { worldChangeKeys: [], discoveryIds: [] };

describe('pageState', () => {
  it('is UNDISCOVERED with no context, and RESTORED always wins', () => {
    expect(pageState(entry('page-painted-words'))).toBe('UNDISCOVERED');
    expect(
      pageState(entry('page-painted-words', true), {
        visitedRoomIds: new Set(),
        startedAdventureSlugs: new Set(['the-painted-words']),
      }),
    ).toBe('RESTORED');
  });

  it('is DISCOVERED once the child has been to the page room', () => {
    expect(
      pageState(entry('page-painted-words'), { ...NO_CONTEXT, visitedRoomIds: new Set(['illustration-studio']) }),
    ).toBe('DISCOVERED');
  });

  it('is IN_PROGRESS when either word set of the mission was started', () => {
    for (const slug of ['the-painted-words', 'the-painted-words-again']) {
      expect(
        pageState(entry('page-painted-words'), {
          visitedRoomIds: new Set(['illustration-studio']),
          startedAdventureSlugs: new Set([slug]),
        }),
      ).toBe('IN_PROGRESS');
    }
  });

  it('ignores an adventure that does not write this page', () => {
    expect(
      pageState(entry('page-painted-words'), {
        ...NO_CONTEXT,
        startedAdventureSlugs: new Set(['the-storykeepers-tale']),
      }),
    ).toBe('UNDISCOVERED');
  });
});

describe('retired or unavailable content', () => {
  it('a page with no producer is unavailable, a discovery page always is available', () => {
    expect(isPageAvailable(page('page-painted-words'), 'PATHFINDER', [])).toBe(false);
    expect(isPageAvailable(page('page-painted-words'), 'PATHFINDER')).toBe(true);
    expect(isPageAvailable(page('page-tapestry'), 'PATHFINDER', [])).toBe(true);
  });

  it('does not hold the book open for a retired required page, and never completes empty', () => {
    const progress = storybookProgress(
      { worldChangeKeys: ['FIRST_STORY_TOLD'], discoveryIds: [] },
      'PATHFINDER',
    );
    // Only the Tale remains: the Painted Words content was retired.
    const view = withAvailability(progress, [THE_STORYKEEPERS_TALE]);
    expect(view.totalRequired).toBe(1);
    expect(view.complete).toBe(true);
    const none = withAvailability(storybookProgress(EMPTY, 'PATHFINDER'), []);
    expect(none.totalRequired).toBe(0);
    expect(none.complete).toBe(false);
  });

  it('keeps an earned page even when its content is later retired', () => {
    const progress = storybookProgress(
      { worldChangeKeys: ['STUDIO_PAGE_MENDED'], discoveryIds: [] },
      'PATHFINDER',
    );
    const view = withAvailability(progress, [THE_STORYKEEPERS_TALE]);
    expect(view.entries.map((e) => e.page.id)).toContain('page-painted-words');
    expect(view.restoredRequired).toBe(1);
  });
});

describe('adventureForPage', () => {
  it('links each page to the adventure that restores it', () => {
    expect(adventureForPage(page('page-painted-words'), 'PATHFINDER', EMPTY)).toBe('the-painted-words');
    expect(adventureForPage(page('page-first-story'), 'PATHFINDER', EMPTY)).toBe('the-storykeepers-tale');
    expect(adventureForPage(page('page-first-story'), 'SPROUT', EMPTY)).toBe('quills-picture-story');
  });

  it('offers the second word set to a replay and none for a discovery or another band', () => {
    expect(
      adventureForPage(page('page-painted-words'), 'PATHFINDER', {
        worldChangeKeys: ['STUDIO_PAGE_MENDED'],
        discoveryIds: [],
      }),
    ).toBe('the-painted-words-again');
    expect(adventureForPage(page('page-tapestry'), 'PATHFINDER', EMPTY)).toBeUndefined();
    expect(adventureForPage(page('page-painted-words'), 'SPROUT', EMPTY)).toBeUndefined();
  });
});

describe('nextMissingPage', () => {
  it('names the first missing required page, then nothing once whole', () => {
    const half = storybookProgress({ worldChangeKeys: ['FIRST_STORY_TOLD'], discoveryIds: [] }, 'PATHFINDER');
    expect(nextMissingPage(half)?.id).toBe('page-painted-words');
    const whole = storybookProgress(
      { worldChangeKeys: ['FIRST_STORY_TOLD', 'STUDIO_PAGE_MENDED'], discoveryIds: [] },
      'PATHFINDER',
    );
    expect(nextMissingPage(whole)).toBeUndefined();
  });
});

describe('withAvailability keeps the edition standing', () => {
  it('leaves a restored-in-edition-1 child RESTORED_MORE_PAGES, and complete only when whole', () => {
    const progress = storybookProgress(
      { worldChangeKeys: ['FIRST_STORY_TOLD', 'GREAT_STORYBOOK_RESTORED'], discoveryIds: [] },
      'PATHFINDER',
    );
    const view = withAvailability(progress);
    expect(view.state).toBe('RESTORED_MORE_PAGES');
    expect(view.complete).toBe(false);
    expect(view.edition1Restored).toBe(true);
    // The new page's content is retired: the book is then whole for them, and RESTORED.
    expect(withAvailability(progress, [THE_STORYKEEPERS_TALE]).state).toBe('RESTORED');
  });
});
