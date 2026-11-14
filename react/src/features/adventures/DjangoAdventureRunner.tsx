import { useEffect, useRef } from 'react';
import { AdventureStepCard } from './AdventureStepCard';
import { useDjangoAdventureSession } from './useDjangoAdventureSession';
import type { StepRunnerApi } from '../../api/play/stepRunnerApi';

interface DjangoAdventureRunnerProps {
  childId: string;
  adventureSlug: string;
  backToMapHref: string;
  backToMapLabel?: string;
  /** Fired once, the first time the server reports the adventure complete. */
  onComplete?: () => void;
  /** Tests only: a runner API other than the build's own. */
  api?: StepRunnerApi;
}

/**
 * The existing step card driven by Django's runner (LAI-0816). Chatty's AI bubble, coop and the
 * tutor's scaffold stay with the classic runner (`AdventureRunner`) for now: this path shows authored text only,
 * which is the safe fallback by construction.
 */
export function DjangoAdventureRunner({
  childId,
  adventureSlug,
  backToMapHref,
  backToMapLabel,
  onComplete,
  api,
}: DjangoAdventureRunnerProps) {
  const state = useDjangoAdventureSession(childId, adventureSlug, api);
  const fired = useRef(false);

  useEffect(() => {
    if (state.completed && !fired.current) {
      fired.current = true;
      onComplete?.();
    }
  }, [state.completed, onComplete]);

  if (state.loadState === 'loading') return <p>Loading your adventure...</p>;
  if (state.loadState === 'error' || !state.currentStep) {
    return <p role="alert">We could not open this adventure right now.</p>;
  }
  return (
    <AdventureStepCard
      currentStep={state.currentStep}
      submitting={state.submitting}
      error={state.error}
      submitAnswer={state.submitAnswer}
      hintLevel={state.hintLevel}
      hintText={state.hintText}
      requestHint={state.requestHint}
      companionTurn={{ status: 'idle' }}
      representationAid={undefined}
      storyScenes={[]}
      backToMapHref={backToMapHref}
      backToMapLabel={backToMapLabel}
    />
  );
}
