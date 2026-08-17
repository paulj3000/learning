import { useCallback, useEffect, useRef, useState } from 'react';
import { resolveNarrativeText } from './engine/types';
import type { StoryChapter, StoryChapterScene } from './engine/types';
import { isAdventureSessionComplete, recordStoryReflectionEvidence } from './api';
import { useCompanionTurn } from '../companion/useCompanionTurn';
import type { CompanionTurnState } from '../companion/useCompanionTurn';
import type { AgeBandValue } from '../child-profile/constants';

export interface StoryChapterRunnerState {
  /** `null` once every scene in this chapter has resolved (the caller should call completeChapter and move on). */
  scene: StoryChapterScene | null;
  /**
   * Only meaningful for an `ADVENTURE` scene: `null` while checking whether
   * it was already completed in an earlier visit (e.g. a page reload),
   * `true` if so (skip straight to a "continue" prompt rather than
   * re-embedding/re-starting the adventure), `false` if it still needs to
   * be played.
   */
  skipAdventure: boolean | null;
  /** True once an `ADVENTURE` scene's embedded session has just finished in this render (as opposed to being detected already-done above). */
  adventureJustCompleted: boolean;
  error: string | null;
  companionTurn: CompanionTurnState;
  continueNarrative: () => void;
  chooseOption: (optionId: string) => Promise<void>;
  continueReflection: () => Promise<void>;
  handleAdventureComplete: () => void;
  continueAfterAdventure: () => void;
}

/**
 * Drives one chapter's scene-by-scene playthrough. Scene position is
 * in-memory only and resets to the chapter's first scene on a fresh page
 * load — the same accepted tradeoff `useAdventureSession`'s hint ladder
 * already makes (docs/IMPLEMENTATION_STATUS.md), safe here because the only
 * scene kind with real persisted state is `ADVENTURE` (its own
 * `AdventureSession`), which this hook checks for directly rather than
 * trusting scene position across a reload.
 */
export function useStoryChapterRunner(
  childProfileId: string,
  ageBand: AgeBandValue,
  aiEnabled: boolean,
  storyProgressId: string,
  chapter: StoryChapter,
  flags: Record<string, string>,
  onFlag: (flagKey: string, flagValue: string) => Promise<void>,
  onChapterComplete: () => Promise<void>,
): StoryChapterRunnerState {
  const [sceneIndex, setSceneIndex] = useState(0);
  const [skipAdventure, setSkipAdventure] = useState<boolean | null>(null);
  const [adventureJustCompleted, setAdventureJustCompleted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chapterFinishedRef = useRef(false);
  const { state: companionTurn, request: requestCompanion } = useCompanionTurn();

  const scene = chapter.scenes[sceneIndex] ?? null;

  useEffect(() => {
    setSceneIndex(0);
    chapterFinishedRef.current = false;
    setError(null);
  }, [chapter.id]);

  useEffect(() => {
    if (scene?.kind === 'NARRATIVE' && scene.aiNarrated) {
      void requestCompanion({
        childProfileId,
        ageBand,
        intent: 'NARRATE',
        stepSummary: scene.id,
        authoredBaseText: resolveNarrativeText(scene, flags),
        aiEnabled,
      });
    }
    // Only re-fire when the scene itself changes; flags/ageBand/aiEnabled
    // are read at fire time but shouldn't retrigger the same narration.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene]);

  useEffect(() => {
    setSkipAdventure(null);
    setAdventureJustCompleted(false);
    if (scene?.kind !== 'ADVENTURE') return;

    let cancelled = false;
    void (async () => {
      try {
        const alreadyDone = await isAdventureSessionComplete(childProfileId, scene.templateSlug);
        if (!cancelled) setSkipAdventure(alreadyDone);
      } catch {
        if (!cancelled) {
          setError('Something went wrong loading this part of the story.');
          setSkipAdventure(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [scene, childProfileId]);

  useEffect(() => {
    if (scene !== null || chapterFinishedRef.current) return;
    chapterFinishedRef.current = true;
    void (async () => {
      try {
        await onChapterComplete();
      } catch {
        setError('Something went wrong saving your progress in the story.');
        chapterFinishedRef.current = false;
      }
    })();
  }, [scene, onChapterComplete]);

  const continueNarrative = useCallback(() => setSceneIndex((index) => index + 1), []);

  const chooseOption = useCallback(
    async (optionId: string) => {
      if (scene?.kind !== 'CHOICE') return;
      const option = scene.options.find((candidate) => candidate.id === optionId);
      if (!option) return;
      try {
        await onFlag(scene.flagKey, option.flagValue);
        setSceneIndex((index) => index + 1);
      } catch {
        setError('Something went wrong saving your choice.');
      }
    },
    [scene, onFlag],
  );

  const continueReflection = useCallback(async () => {
    if (scene?.kind !== 'REFLECTION') return;
    try {
      await recordStoryReflectionEvidence(childProfileId, storyProgressId, scene.objectiveIds);
      setSceneIndex((index) => index + 1);
    } catch {
      setError('Something went wrong saving your progress.');
    }
  }, [scene, childProfileId, storyProgressId]);

  const handleAdventureComplete = useCallback(() => setAdventureJustCompleted(true), []);
  const continueAfterAdventure = useCallback(() => setSceneIndex((index) => index + 1), []);

  return {
    scene,
    skipAdventure,
    adventureJustCompleted,
    error,
    companionTurn,
    continueNarrative,
    chooseOption,
    continueReflection,
    handleAdventureComplete,
    continueAfterAdventure,
  };
}
