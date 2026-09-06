import { Link } from 'react-router-dom';
import styles from './AdventureRunner.module.css';
import { HintPanel } from './HintPanel';
import { NarrativeStep } from './steps/NarrativeStep';
import { ChoiceStep } from './steps/ChoiceStep';
import { NumberInputStep } from './steps/NumberInputStep';
import { OrderingStep } from './steps/OrderingStep';
import { ReflectionStep } from './steps/ReflectionStep';
import { CompanionBubble } from '../companion/CompanionBubble';
import { RepresentationAid } from '../tutor/RepresentationAid';
import type { AdventureStep } from './engine/types';
import type { StepAnswer } from './engine/validators';
import type { StoryScene } from './api';
import type { CompanionTurnState } from '../companion/useCompanionTurn';
import type { RepresentationAid as RepresentationAidDefinition } from '../tutor/content/representationAids';

export interface AdventureStepCardProps {
  currentStep: AdventureStep;
  submitting: boolean;
  error: string | null;
  /**
   * `Promise<unknown>` rather than `Promise<void>` because
   * `useAdventureSession.submitAnswer` resolves with the server's verdict
   * for callers that need it. This card never reads it: every decision it
   * could make on a verdict is one the engine has already made, and the new
   * step arrives as a prop.
   */
  submitAnswer: (answer: StepAnswer) => void | Promise<unknown>;
  hintLevel: number;
  hintText: string | undefined;
  requestHint: () => void;
  companionTurn: CompanionTurnState;
  representationAid: RepresentationAidDefinition | undefined;
  storyScenes: readonly StoryScene[];
  backToMapHref: string;
  /** Rendered only for a Phase 17 coop session; `null` outside one. */
  coopPresenceLine?: string | null;
}

/**
 * Renders one adventure step and its surrounding furniture (Chatty's
 * bubble, the hint ladder, the completion card), given a session state
 * someone else owns.
 *
 * Extracted from `AdventureRunner.tsx` unchanged, so that a caller which
 * already holds a session can render the very same card. The Storykeeper
 * Castle first-person region is the first such caller
 * (`docs/STORYKEEPER_CASTLE_3D_ROADMAP.md` SC-4): its Character Gallery and
 * Setting Tower answer two steps by *being places*, and this card is the
 * always-available equivalent for those same steps - which only counts as
 * equivalent if it is literally the same component submitting through the
 * same `submitAnswer`, rather than a second implementation that could drift.
 *
 * Purely presentational. Every decision - correctness, transitions, hint
 * escalation - stays in `useAdventureSession`.
 */
export function AdventureStepCard({
  currentStep,
  submitting,
  error,
  submitAnswer,
  hintLevel,
  hintText,
  requestHint,
  companionTurn,
  representationAid,
  storyScenes,
  backToMapHref,
  coopPresenceLine = null,
}: AdventureStepCardProps) {
  const { presentation } = currentStep;
  const showHints = hintLevel > 0 || currentStep.hintPolicy;

  return (
    <div className={styles.page}>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      {coopPresenceLine ? (
        <p className={styles.coopPresence} role="status">
          {coopPresenceLine}
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

      {representationAid ? <RepresentationAid aid={representationAid} /> : null}
    </div>
  );
}
