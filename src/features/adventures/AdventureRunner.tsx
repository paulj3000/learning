import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import styles from './AdventureRunner.module.css';
import { useAdventureSession } from './useAdventureSession';
import { HintPanel } from './HintPanel';
import { NarrativeStep } from './steps/NarrativeStep';
import { ChoiceStep } from './steps/ChoiceStep';
import { NumberInputStep } from './steps/NumberInputStep';
import { OrderingStep } from './steps/OrderingStep';
import { ReflectionStep } from './steps/ReflectionStep';
import { CompanionBubble } from '../companion/CompanionBubble';
import type { AdventureDefinition } from './engine/types';
import type { AgeBandValue } from '../child-profile/constants';

interface AdventureRunnerProps {
  childProfileId: string;
  definition: AdventureDefinition;
  ageBand: AgeBandValue;
  aiEnabled: boolean;
  backToMapHref: string;
  /** Set only when this child is playing a Phase 17 household coop session alongside a sibling. */
  coopSessionId?: string;
  /**
   * Fired once, the first time this session reaches COMPLETED. Optional —
   * every existing caller ignores it. Used by the Story Engine
   * (src/features/story/) to know when a chapter's embedded adventure is
   * done without polling the backend itself (docs/ARCHITECTURE.md's
   * "World Engine -> Story Engine -> Adventure Engine" layering: the Story
   * Engine only observes completion here, it never touches correctness).
   */
  onComplete?: () => void;
}

/**
 * Dispatches the current step to its renderer and shows the hint ladder
 * after a wrong answer. All correctness/transition logic lives in
 * useAdventureSession; this component only renders what it is told,
 * including Chatty's AI-phrased hint/celebration dialogue (Phase 4 —
 * presentation only, never correctness).
 */
export function AdventureRunner({
  childProfileId,
  definition,
  ageBand,
  aiEnabled,
  backToMapHref,
  coopSessionId,
  onComplete,
}: AdventureRunnerProps) {
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
    storyScenes,
    coopSharedState,
  } = useAdventureSession(childProfileId, definition, ageBand, aiEnabled, coopSessionId);
  const isSharingWithSibling = coopSharedState.presence.some((id) => id !== childProfileId);
  const hasFiredOnComplete = useRef(false);

  useEffect(() => {
    if (session?.status === 'COMPLETED' && !hasFiredOnComplete.current) {
      hasFiredOnComplete.current = true;
      onComplete?.();
    }
  }, [session, onComplete]);

  if (loadState === 'loading') {
    return <p>Loading your adventure...</p>;
  }
  if (loadState === 'error' || !currentStep) {
    return <p role="alert">Something went wrong loading this adventure.</p>;
  }

  const { presentation } = currentStep;
  const showHints = hintLevel > 0 || currentStep.hintPolicy;

  return (
    <div className={styles.page}>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      {coopSessionId ? (
        <p className={styles.coopPresence} role="status">
          {isSharingWithSibling
            ? 'Your sibling is playing this adventure with you right now!'
            : 'Waiting for your sibling to join this shared adventure...'}
        </p>
      ) : null}

      <CompanionBubble state={companionTurn} />

      {presentation.kind === 'narrative' ? (
        <NarrativeStep
          key={currentStep.id}
          speaker={presentation.speaker}
          text={presentation.text}
          disabled={submitting}
          onContinue={() => void submitAnswer({ kind: 'narrative' })}
        />
      ) : null}

      {presentation.kind === 'number-input' ? (
        <NumberInputStep
          key={currentStep.id}
          prompt={presentation.prompt}
          disabled={submitting}
          onSubmit={(value) => void submitAnswer({ kind: 'number-input', value })}
        />
      ) : null}

      {presentation.kind === 'choice' ? (
        <ChoiceStep
          key={currentStep.id}
          prompt={presentation.prompt}
          options={presentation.options}
          disabled={submitting}
          onSelect={(optionId) => void submitAnswer({ kind: 'choice', optionId })}
        />
      ) : null}

      {presentation.kind === 'ordering' ? (
        <OrderingStep
          key={currentStep.id}
          prompt={presentation.prompt}
          items={presentation.items}
          disabled={submitting}
          onSubmit={(order) => void submitAnswer({ kind: 'ordering', order })}
        />
      ) : null}

      {presentation.kind === 'creative-choice' ? (
        <ChoiceStep
          key={currentStep.id}
          prompt={presentation.prompt}
          options={presentation.options}
          disabled={submitting}
          onSelect={(optionId) => void submitAnswer({ kind: 'creative-choice', optionId })}
        />
      ) : null}

      {presentation.kind === 'reflection' ? (
        <ReflectionStep
          key={currentStep.id}
          prompt={presentation.prompt}
          disabled={submitting}
          onContinue={() => void submitAnswer({ kind: 'reflection' })}
        />
      ) : null}

      {presentation.kind === 'world-change' ? <p>{presentation.text}</p> : null}

      {presentation.kind === 'complete' ? (
        <div className={styles.completeCard}>
          <h1 className={styles.completeHeading}>Adventure complete!</h1>
          <p className={styles.completeText}>{presentation.text}</p>
          {storyScenes.length > 0 ? (
            <div className={styles.storyRecap}>
              <h2 className={styles.storyRecapHeading}>Your story</h2>
              {storyScenes.map((scene) => (
                <p key={scene.stepId} className={styles.storyRecapText}>
                  {scene.text}
                </p>
              ))}
            </div>
          ) : null}
          <Link to={backToMapHref}>Back to the map</Link>
        </div>
      ) : null}

      {showHints ? (
        <HintPanel
          hintLevel={hintLevel}
          hintText={hintText}
          disabled={submitting}
          onRequestHint={requestHint}
        />
      ) : null}
    </div>
  );
}
