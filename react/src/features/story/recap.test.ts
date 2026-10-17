import { describe, expect, it } from 'vitest';
import { buildStoryRecap } from './recap';
import { DRAGON_OF_EMBER_MOUNTAIN } from './content/dragonOfEmberMountain';
import type { ChildStoryProgress } from './api';

function buildProgress(overrides: Partial<ChildStoryProgress> = {}): ChildStoryProgress {
  return {
    id: 'progress-1',
    childProfileId: 'child-1',
    storyId: DRAGON_OF_EMBER_MOUNTAIN.slug,
    currentChapterId: 'broken-path',
    completedChapterIds: [],
    storyFlags: {},
    startedAt: '2026-08-01T00:00:00.000Z',
    lastPlayedAt: '2026-08-01T00:00:00.000Z',
    completedAt: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  } as ChildStoryProgress;
}

describe('buildStoryRecap', () => {
  it('greets a brand-new story with no completed chapters', () => {
    const progress = buildProgress();
    const lines = buildStoryRecap(DRAGON_OF_EMBER_MOUNTAIN, progress);
    expect(lines).toEqual(['You are just beginning "The Dragon of Ember Mountain".']);
  });

  it('lists completed chapters and names what comes next', () => {
    const progress = buildProgress({
      completedChapterIds: ['broken-path', 'whispering-forest'],
      currentChapterId: 'dragon-tracks',
    });
    const lines = buildStoryRecap(DRAGON_OF_EMBER_MOUNTAIN, progress);
    expect(lines[0]).toContain('The Broken Path, then The Whispering Forest');
    expect(lines[1]).toBe('Next up: Dragon Tracks.');
  });

  it('celebrates a finished story', () => {
    const progress = buildProgress({
      completedChapterIds: [
        'broken-path',
        'whispering-forest',
        'dragon-tracks',
        'dragons-cave',
        'save-the-dragon',
      ],
      currentChapterId: 'save-the-dragon',
      completedAt: '2026-08-05T00:00:00.000Z',
    });
    const lines = buildStoryRecap(DRAGON_OF_EMBER_MOUNTAIN, progress);
    expect(lines).toContain('You finished the whole story!');
  });
});
