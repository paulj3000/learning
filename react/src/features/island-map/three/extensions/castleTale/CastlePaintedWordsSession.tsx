import { useEffect, useRef } from 'react';
import styles from '../../../IslandWorldView.module.css';
import { AdventureStepCard } from '../../../../adventures/AdventureStepCard';
import { useAdventureSession } from '../../../../adventures/useAdventureSession';
import type { AdventureDefinition } from '../../../../adventures/engine/types';
import type { AgeBandValue } from '../../../../child-profile/constants';
import { paintedWordsPadGuide } from '../../castlePlatformAnswers';
import type { WorldEngineEventBus } from '../../worldEngineEvents';
import { usePadAnswers } from './usePadAnswers';

/**
 * One in-world play-through of "The Painted Words" (SC-JMP), hosted in the Illustration Studio so
 * the room's three painted pads can answer.
 *
 * It renders the very `AdventureStepCard` the card route renders, so every step has its card
 * equivalent in the same words, and both ways of answering (the card, a pad) go through the
 * session's one `submitAnswer`: the adventure engine grades, the server writes the page's world
 * change, and nothing here decides anything. A child who never jumps, or never stands on a pad,
 * plays the whole mission from the card. The words on the pads are the choice step's own options,
 * all from the approved bank (`paintedWordsPadSlots`), and a short spoken-style guide says which
 * colour carries which word for a child who cannot see the pads.
 */
export interface CastlePaintedWordsSessionProps {
  childId: string;
  ageBand: AgeBandValue;
  aiEnabled: boolean;
  bus: WorldEngineEventBus;
  definition: AdventureDefinition;
  onComplete: () => void;
  backToMapHref: string;
}

export function CastlePaintedWordsSession({
  childId,
  ageBand,
  aiEnabled,
  bus,
  definition,
  onComplete,
  backToMapHref,
}: CastlePaintedWordsSessionProps) {
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
  } = useAdventureSession(childId, definition, ageBand, aiEnabled);

  const hasFiredOnComplete = useRef(false);
  useEffect(() => {
    if (session?.status === 'COMPLETED' && !hasFiredOnComplete.current) {
      hasFiredOnComplete.current = true;
      onComplete();
    }
  }, [session, onComplete]);

  usePadAnswers({
    bus,
    definition,
    stepId: currentStep?.id ?? null,
    submit: submitAnswer,
  });

  if (loadState === 'loading') {
    return <p className={styles.status}>Opening the painted words...</p>;
  }
  if (loadState === 'error' || !currentStep) {
    return (
      <p className={styles.status} role="alert">
        Something went wrong opening the painted words.
      </p>
    );
  }

  const padGuide = paintedWordsPadGuide(currentStep);
  return (
    <div className={styles.panel}>
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
      {padGuide ? (
        <p className={styles.status} data-testid="painted-words-pad-guide">
          If you like, hop onto a pad to answer. {padGuide}
        </p>
      ) : null}
    </div>
  );
}
