import { useEffect, useRef } from 'react';
import styles from '../../../IslandWorldView.module.css';
import { AdventureStepCard } from '../../../../adventures/AdventureStepCard';
import { useAdventureSession } from '../../../../adventures/useAdventureSession';
import { StoryChapterRunner } from '../../../../story/StoryChapterRunner';
import type { StoryAdventureRenderProps } from '../../../../story/StoryChapterRunner';
import { useStoryProgress } from '../../../../story/useStoryProgress';
import { THE_CASTLES_SECRET_DOOR } from '../../../../story/content/theCastlesSecretDoor';
import type { AgeBandValue } from '../../../../child-profile/constants';
import { LIBRARY_CLUE_WALL_ENTITY_ID, seatedCluesToOrder } from '../../castleLibraryClues';
import { ORDER_THE_CLUES_STEP_ID } from '../../castleLibraryClues';
import {
  ORDER_THE_KEYS_STEP_ID,
  PATTERN_LOCK_ENTITY_ID,
  seatedRodsToOrder,
} from '../../castlePatternLock';
import type { WorldEngineEventBus } from '../../worldEngineEvents';
import type { CastleTaleSceneApi } from './castleTaleScene';

/**
 * The Explorer arc, "The Castle's Secret Door", hosted in the room (engine
 * Phase 9, moved from `StorykeeperCastleWorldView.tsx` unchanged).
 *
 * Deliberately not mounted just because a child walked in:
 * `useStoryProgress` starts or resumes a `ChildStoryProgress` on mount, so
 * hosting it unconditionally would create a row for every child who entered
 * the castle - including the bands this arc is not authored for. It mounts
 * when a child takes the authored entry point and not before.
 */
const DOOR_OPENED_STEP_ID = 'door-opened';

/**
 * The arc's two beats whose answer is an arrangement of things in the room,
 * described rather than coded twice: they differ only in which entity
 * reports the row and which translation turns it into option ids.
 */
const ARRANGEMENT_BEATS: readonly {
  stepId: string;
  targetEntityId: string;
  toOrder: (seated: readonly string[]) => string[] | null;
  reset: (scene: CastleTaleSceneApi | null) => void;
}[] = [
  {
    stepId: ORDER_THE_CLUES_STEP_ID,
    targetEntityId: LIBRARY_CLUE_WALL_ENTITY_ID,
    toOrder: seatedCluesToOrder,
    reset: (scene) => scene?.resetLibraryClues(),
  },
  {
    stepId: ORDER_THE_KEYS_STEP_ID,
    targetEntityId: PATTERN_LOCK_ENTITY_ID,
    toOrder: seatedRodsToOrder,
    reset: (scene) => scene?.resetPatternLockRods(),
  },
];

export interface CastleSecretDoorStoryProps {
  childId: string;
  ageBand: AgeBandValue;
  aiEnabled: boolean;
  bus: WorldEngineEventBus;
  scene: React.RefObject<CastleTaleSceneApi | null>;
  onComplete: () => void;
  backToMapHref: string;
}

export function CastleSecretDoorStory({
  childId,
  ageBand,
  aiEnabled,
  bus,
  scene,
  onComplete,
  backToMapHref,
}: CastleSecretDoorStoryProps) {
  const { loadState, progress, chapter, flags, setFlag, completeChapter } = useStoryProgress(
    childId,
    THE_CASTLES_SECRET_DOOR,
  );

  const hasFiredOnComplete = useRef(false);
  useEffect(() => {
    if (loadState === 'ready' && chapter === null && !hasFiredOnComplete.current) {
      hasFiredOnComplete.current = true;
      onComplete();
    }
  }, [loadState, chapter, onComplete]);

  if (loadState === 'loading') {
    return <p className={styles.status}>Opening the door...</p>;
  }
  if (loadState === 'error' || !progress) {
    return (
      <p className={styles.status} role="alert">
        Something went wrong opening this story.
      </p>
    );
  }
  if (!chapter) {
    return (
      <div className={styles.panel}>
        <p>The door is open, and the room behind it is yours to visit.</p>
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      <StoryChapterRunner
        childProfileId={childId}
        ageBand={ageBand}
        aiEnabled={aiEnabled}
        storyProgressId={progress.id}
        chapter={chapter}
        flags={flags}
        backToStoryHref={backToMapHref}
        onFlag={setFlag}
        onChapterComplete={completeChapter}
        renderAdventure={(adventure) => (
          <CastleStoryAdventure
            key={adventure.definition.slug}
            {...adventure}
            bus={bus}
            scene={scene}
          />
        )}
      />
    </div>
  );
}

interface CastleStoryAdventureProps extends StoryAdventureRenderProps {
  bus: WorldEngineEventBus;
  scene: React.RefObject<CastleTaleSceneApi | null>;
}

/**
 * One `ADVENTURE` scene of the secret-door arc, with its session held here so
 * the room can drive it - the same shape `CastleTaleSession` uses for the
 * tale, and the reason ADR-019 needed a renderer seam at all.
 *
 * It renders `AdventureStepCard`, the very component the card route renders,
 * so every step has its HUD equivalent by construction.
 */
function CastleStoryAdventure({
  childProfileId,
  definition,
  ageBand,
  aiEnabled,
  backToMapHref,
  onComplete,
  bus,
  scene,
}: CastleStoryAdventureProps) {
  const {
    loadState,
    session,
    currentStep,
    hintLevel,
    hintText,
    submitting,
    error,
    submitAnswer,
    requestHint,
    companionTurn,
    representationAid,
    storyScenes,
  } = useAdventureSession(childProfileId, definition, ageBand, aiEnabled);

  const hasFiredOnComplete = useRef(false);
  useEffect(() => {
    if (session?.status === 'COMPLETED' && !hasFiredOnComplete.current) {
      hasFiredOnComplete.current = true;
      onComplete();
    }
  }, [session, onComplete]);

  const submitRef = useRef(submitAnswer);
  submitRef.current = submitAnswer;
  const stepId = currentStep?.id ?? null;

  /**
   * Beat 10's payoff. Driven by the `WORLD_CHANGE` step being on screen
   * rather than by a submit, for the same reason beat 8 is: such a step has
   * no answer to submit, so `useAdventureSession` writes the change and
   * advances past it on its own.
   */
  const hasOpenedDoorRef = useRef(false);
  useEffect(() => {
    if (stepId !== DOOR_OPENED_STEP_ID || hasOpenedDoorRef.current) return;
    hasOpenedDoorRef.current = true;
    scene.current?.showSecretDoorOpened(true);
    scene.current?.playQuillClip('Celebrate');
  }, [stepId, scene]);

  const arrangement = ARRANGEMENT_BEATS.find((beat) => beat.stepId === stepId) ?? null;

  useEffect(() => {
    if (!arrangement) return;
    arrangement.reset(scene.current);
  }, [arrangement, scene]);

  useEffect(() => {
    if (!arrangement) return;
    return bus.on('BuildActionRequested', ({ entityId, order }) => {
      if (entityId !== arrangement.targetEntityId) return;
      const answer = arrangement.toOrder(order ?? []);
      if (!answer) return;
      void submitRef.current({ kind: 'ordering', order: answer }).then((correctness) => {
        /*
          Beat 6's promise, kept for all three arrangements: a wrong one costs
          nothing. Everything comes back to where it started, Quill looks
          concerned, and the hint ladder has already advanced a rung.
        */
        if (correctness === 'correct') return;
        arrangement.reset(scene.current);
        scene.current?.playQuillClip('ReactConcerned');
      });
    });
  }, [bus, arrangement, scene]);

  if (loadState === 'loading') {
    return <p className={styles.status}>Reading the clues...</p>;
  }
  if (loadState === 'error' || !currentStep) {
    return (
      <p className={styles.status} role="alert">
        Something went wrong opening this part of the story.
      </p>
    );
  }

  return (
    <AdventureStepCard
      currentStep={currentStep}
      submitting={submitting}
      error={error}
      submitAnswer={submitAnswer}
      hintLevel={hintLevel}
      hintText={hintText}
      requestHint={requestHint}
      companionTurn={companionTurn}
      representationAid={representationAid}
      storyScenes={storyScenes}
      backToMapHref={backToMapHref}
    />
  );
}
