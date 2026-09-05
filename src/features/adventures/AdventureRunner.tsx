import { useEffect, useRef } from 'react';
import { useAdventureSession } from './useAdventureSession';
import { AdventureStepCard } from './AdventureStepCard';
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
 * Owns one adventure session and hands it to `AdventureStepCard` to render.
 * All correctness/transition logic lives in `useAdventureSession`; the card
 * only renders what it is told, including Chatty's AI-phrased
 * hint/celebration dialogue (Phase 4 — presentation only, never
 * correctness).
 *
 * The rendering half was split out into `AdventureStepCard.tsx` for
 * `docs/STORYKEEPER_CASTLE_3D_ROADMAP.md` SC-4, where the first-person
 * castle holds its own session (so that walking up to a portrait and
 * answering the card drive the same one) and needs the identical card.
 * Nothing about this component's behaviour changed in that split.
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
    representationAid,
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
      coopPresenceLine={
        coopSessionId
          ? isSharingWithSibling
            ? 'Your sibling is playing this adventure with you right now!'
            : 'Waiting for your sibling to join this shared adventure...'
          : null
      }
    />
  );
}
