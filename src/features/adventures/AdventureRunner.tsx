import { Link } from 'react-router-dom';
import styles from './AdventureRunner.module.css';
import { useAdventureSession } from './useAdventureSession';
import { HintPanel } from './HintPanel';
import { NarrativeStep } from './steps/NarrativeStep';
import { ChoiceStep } from './steps/ChoiceStep';
import { NumberInputStep } from './steps/NumberInputStep';
import { OrderingStep } from './steps/OrderingStep';
import type { AdventureDefinition } from './engine/types';

interface AdventureRunnerProps {
  childProfileId: string;
  definition: AdventureDefinition;
  backToMapHref: string;
}

/**
 * Dispatches the current step to its renderer and shows the hint ladder
 * after a wrong answer. All correctness/transition logic lives in
 * useAdventureSession; this component only renders what it is told.
 */
export function AdventureRunner({
  childProfileId,
  definition,
  backToMapHref,
}: AdventureRunnerProps) {
  const {
    loadState,
    currentStep,
    hintLevel,
    hintText,
    submitting,
    error,
    submitAnswer,
    requestHint,
  } = useAdventureSession(childProfileId, definition);

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

      {presentation.kind === 'world-change' ? <p>{presentation.text}</p> : null}

      {presentation.kind === 'complete' ? (
        <div className={styles.completeCard}>
          <h1 className={styles.completeHeading}>Adventure complete!</h1>
          <p className={styles.completeText}>{presentation.text}</p>
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
