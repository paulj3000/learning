import { useCallback, useEffect, useState } from 'react';
import { getChapter } from './engine/types';
import type { StoryChapter, StoryDefinition } from './engine/types';
import {
  advanceChapter,
  completeStory,
  parseStoryFlags,
  setStoryFlag,
  startOrResumeStoryProgress,
} from './api';
import type { ChildStoryProgress } from './api';

type LoadState = 'loading' | 'ready' | 'error';

export interface StoryProgressState {
  loadState: LoadState;
  progress: ChildStoryProgress | null;
  /** The chapter currently in play, or `null` once the story is complete. */
  chapter: StoryChapter | null;
  flags: Record<string, string>;
  setFlag: (flagKey: string, flagValue: string) => Promise<void>;
  /** Advances past the current chapter — to the next one, or to story completion if this was the last. */
  completeChapter: () => Promise<void>;
}

/**
 * Top-level Story Engine orchestration hook: loads or starts this child's
 * `ChildStoryProgress` for `story` and exposes the chapter currently in
 * play. Mirrors `useAdventureSession`'s shape (load/ready/error, all
 * business logic here rather than in a component — CLAUDE.md section 13),
 * one layer up: this hook never validates a challenge answer itself, only
 * chapter/story-level transitions (docs/ARCHITECTURE.md "World engine
 * layering" — Story Engine, not Adventure Engine).
 */
export function useStoryProgress(
  childProfileId: string,
  story: StoryDefinition,
): StoryProgressState {
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [progress, setProgress] = useState<ChildStoryProgress | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const started = await startOrResumeStoryProgress(
          childProfileId,
          story.slug,
          story.entryChapterId,
        );
        if (cancelled) return;
        setProgress(started);
        setLoadState('ready');
      } catch {
        if (cancelled) return;
        setLoadState('error');
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [childProfileId, story]);

  const chapter =
    progress && !progress.completedAt ? getChapter(story, progress.currentChapterId) : null;
  const flags = progress ? parseStoryFlags(progress.storyFlags) : {};

  const setFlag = useCallback(
    async (flagKey: string, flagValue: string) => {
      if (!progress) return;
      const updated = await setStoryFlag(progress, flagKey, flagValue);
      setProgress(updated);
    },
    [progress],
  );

  const completeChapter = useCallback(async () => {
    if (!progress || !chapter) return;
    const updated = chapter.nextChapterId
      ? await advanceChapter(progress, chapter.id, chapter.nextChapterId)
      : await completeStory(progress, chapter.id, story.completionWorldChange);
    setProgress(updated);
  }, [progress, chapter, story]);

  return { loadState, progress, chapter, flags, setFlag, completeChapter };
}
