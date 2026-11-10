import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeDjangoClient, type FakeDjangoClient } from '../../test/fakeDjangoClient';

const { holder, listSessions } = vi.hoisted(() => ({
  holder: { client: null as FakeDjangoClient | null },
  listSessions: vi.fn(),
}));
vi.mock('../../api/djangoClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/djangoClient')>()),
  djangoClient: () => holder.client,
}));
vi.mock('../adventures/api', () => ({ listSessions }));

import {
  completeChapter,
  isAdventureSessionComplete,
  listStoryProgress,
  parseStoryFlags,
  recordStoryReflectionEvidence,
  setStoryFlag,
  startOrResumeStoryProgress,
} from './api';

const STORY = 'dragon-of-ember-mountain';
const BASE = `children/child-1/stories/${STORY}/`;
const PROGRESS = {
  id: 'p1',
  storyId: STORY,
  currentChapterId: 'broken-path',
  completedChapterIds: [],
  storyFlags: { trackDirection: 'cave', bad: 3 },
  startedAt: '2026-11-01T10:00:00+00:00',
  lastPlayedAt: '2026-11-01T10:00:00+00:00',
  completedAt: null,
};

let api: FakeDjangoClient;
beforeEach(() => {
  api = fakeDjangoClient();
  holder.client = api;
});

describe('story progress on Django (AMP-03)', () => {
  it('starts or resumes on the server, which picks the entry chapter', async () => {
    api.on('POST', `${BASE}start/`, PROGRESS);
    const progress = await startOrResumeStoryProgress('child-1', STORY);
    expect(api.calls).toEqual([{ method: 'POST', path: `${BASE}start/`, body: {} }]);
    expect(progress).toMatchObject({
      childProfileId: 'child-1',
      currentChapterId: 'broken-path',
      storyFlags: { trackDirection: 'cave' },
    });
  });

  it('sends a choice as a flag and a finished chapter by id, nothing else', async () => {
    api.on('POST', `${BASE}flags/`, PROGRESS);
    api.on('POST', `${BASE}chapters/broken-path/complete/`, {
      ...PROGRESS,
      currentChapterId: 'whispering-forest',
      completedChapterIds: ['broken-path'],
    });
    const progress = { ...PROGRESS, childProfileId: 'child-1', storyFlags: {} };
    await setStoryFlag(progress, 'trackDirection', 'cave');
    const next = await completeChapter(progress, 'broken-path');
    expect(api.calls).toEqual([
      {
        method: 'POST',
        path: `${BASE}flags/`,
        body: { flagKey: 'trackDirection', flagValue: 'cave' },
      },
      { method: 'POST', path: `${BASE}chapters/broken-path/complete/`, body: {} },
    ]);
    expect(next.currentChapterId).toBe('whispering-forest');
  });

  it('records a reflection by scene id', async () => {
    api.on('POST', `${BASE}reflections/`, { recorded: 1 });
    await recordStoryReflectionEvidence('child-1', STORY, 'dragon-empathy');
    expect(api.calls[0]?.body).toEqual({ sceneId: 'dragon-empathy' });
  });

  it('lists every story the child has started', async () => {
    api.on('GET', 'children/child-1/stories/', { stories: [PROGRESS] });
    expect((await listStoryProgress('child-1')).map((p) => p.storyId)).toEqual([STORY]);
  });

  it('knows an embedded adventure is done from the server sessions', async () => {
    listSessions.mockResolvedValue([{ templateSlug: 'a', status: 'COMPLETED' }]);
    expect(await isAdventureSessionComplete('child-1', 'a')).toBe(true);
    expect(await isAdventureSessionComplete('child-1', 'b')).toBe(false);
  });

  it('keeps only string flags', () => {
    expect(parseStoryFlags({ a: 'x', b: 1 })).toEqual({ a: 'x' });
    expect(parseStoryFlags(null)).toEqual({});
  });
});
