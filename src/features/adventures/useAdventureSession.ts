import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getHintText,
  getNextStepId,
  getStep,
  isGuidedCompletion,
  nextHintLevel,
  validateStepAnswer,
} from './engine';
import type { AdventureDefinition, AdventureStep, Correctness } from './engine/types';
import type { StepAnswer } from './engine/validators';
import {
  advanceSession,
  completeSession,
  recordAction,
  recordSkillEvidence,
  recordWorldChangeOnce,
  resumeOrStartSession,
  saveStoryArtifact,
  type AdventureSession,
  type StoryScene,
} from './api';
import { upsertSkillProgress } from '../mastery/api';
import { useCompanionTurn } from '../companion/useCompanionTurn';
import type { CompanionTurnState } from '../companion/useCompanionTurn';
import type { AgeBandValue } from '../child-profile/constants';
import { claimCoopSlot, completeCoopSession } from '../coop/api';
import { useCoopPresence } from '../coop/useCoopPresence';
import { isCoopEligibleStepType, type CoopSharedState } from '../coop/types';

type LoadState = 'loading' | 'ready' | 'error';

interface StepProgress {
  hintLevel: number;
  attemptNumber: number;
}

function normalizeAnswer(answer: StepAnswer): string | undefined {
  switch (answer.kind) {
    case 'number-input':
      return String(answer.value);
    case 'choice':
    case 'short-response':
    case 'creative-choice':
      return answer.optionId;
    case 'ordering':
      return answer.order.join(',');
    case 'matching':
      return answer.pairs.map((pair) => `${pair.leftId}:${pair.rightId}`).join(',');
    default:
      return undefined;
  }
}

export interface AdventureSessionState {
  loadState: LoadState;
  session: AdventureSession | null;
  currentStep: AdventureStep | null;
  hintLevel: number;
  hintText: string | undefined;
  submitting: boolean;
  error: string | null;
  submitAnswer: (answer: StepAnswer) => Promise<void>;
  requestHint: () => void;
  companionTurn: CompanionTurnState;
  /** AI-narrated story beats accumulated so far (Storykeeper Castle only; empty otherwise). */
  storyScenes: StoryScene[];
  /** Live shared state for a Phase 17 coop session, or empty when not playing one. */
  coopSharedState: CoopSharedState;
}

/**
 * Orchestrates one child's play-through of one adventure: loads or creates
 * the session, validates answers, escalates the hint ladder, and drives
 * every transition through the deterministic engine (CLAUDE.md section 7 —
 * no AI decides correctness or transitions). Keeps that logic out of
 * components entirely (CLAUDE.md section 13). Also requests AI-phrased
 * companion dialogue for hints and celebrations (Phase 4) — this only ever
 * varies presentation; it never influences what `getNextStepId` decides.
 */
export function useAdventureSession(
  childProfileId: string,
  definition: AdventureDefinition,
  ageBand: AgeBandValue,
  aiEnabled: boolean,
  /** Set only when this child is playing a Phase 17 household coop session alongside a sibling. */
  coopSessionId?: string,
): AdventureSessionState {
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [session, setSession] = useState<AdventureSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [progressByStep, setProgressByStep] = useState<Record<string, StepProgress>>({});
  const [storyScenes, setStoryScenes] = useState<StoryScene[]>([]);
  const autoAdvancedStepRef = useRef<string | null>(null);
  const { state: companionTurn, request: requestCompanion } = useCompanionTurn();
  const { sharedState: coopSharedState } = useCoopPresence(coopSessionId, childProfileId);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const active = await resumeOrStartSession(childProfileId, definition);
        if (cancelled) return;
        setSession(active);
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
  }, [childProfileId, definition]);

  const currentStep = session ? getStep(definition, session.currentStepId) : null;
  const currentProgress = currentStep ? progressByStep[currentStep.id] : undefined;
  const hintLevel = currentProgress?.hintLevel ?? 0;

  const advance = useCallback(
    async (nextStepId: string) => {
      if (!session) return;
      const updated = await advanceSession(session.id, nextStepId);
      setSession(updated);
    },
    [session],
  );

  const recordEvidenceForStep = useCallback(
    async (
      step: AdventureStep,
      sessionId: string,
      correctness: Correctness,
      supportLevel: number,
    ) => {
      for (const objectiveId of step.objectiveIds) {
        await recordSkillEvidence({
          childProfileId,
          sessionId,
          learningObjectiveCode: objectiveId,
          evidenceType: step.type,
          result: correctness,
          supportLevel,
        });
        await upsertSkillProgress(childProfileId, objectiveId, correctness, supportLevel);
      }
    },
    [childProfileId],
  );

  const submitAnswer = useCallback(
    async (answer: StepAnswer) => {
      if (!session || !currentStep) return;
      setSubmitting(true);
      setError(null);
      try {
        let correctness = validateStepAnswer(currentStep, answer);
        let supportLevel = currentProgress?.hintLevel ?? 0;
        const attemptNumber = (currentProgress?.attemptNumber ?? 0) + 1;

        const needsRetry =
          (correctness === 'incorrect' || correctness === 'partial') && currentStep.hintPolicy;

        if (needsRetry) {
          const escalatedHintLevel = nextHintLevel(supportLevel);
          setProgressByStep((prev) => ({
            ...prev,
            [currentStep.id]: { hintLevel: escalatedHintLevel, attemptNumber },
          }));

          if (isGuidedCompletion(escalatedHintLevel)) {
            correctness = 'correct';
            supportLevel = escalatedHintLevel;
          } else {
            await recordAction({
              sessionId: session.id,
              stepId: currentStep.id,
              actionType: currentStep.type,
              normalizedAnswer: normalizeAnswer(answer),
              correctness,
              hintLevel: escalatedHintLevel,
              attemptNumber,
            });
            return;
          }
        } else {
          setProgressByStep((prev) => ({
            ...prev,
            [currentStep.id]: { hintLevel: supportLevel, attemptNumber },
          }));
        }

        await recordAction({
          sessionId: session.id,
          stepId: currentStep.id,
          actionType: currentStep.type,
          normalizedAnswer: normalizeAnswer(answer),
          correctness,
          hintLevel: supportLevel,
          attemptNumber,
        });
        if (correctness !== 'not_applicable') {
          await recordEvidenceForStep(currentStep, session.id, correctness, supportLevel);
        }
        if (correctness === 'correct') {
          void requestCompanion({
            childProfileId,
            ageBand,
            intent: 'CELEBRATE',
            stepSummary: currentStep.id,
            sessionId: session.id,
            stepId: currentStep.id,
            learningObjectiveCode: currentStep.objectiveIds[0],
            aiEnabled,
          });
          if (coopSessionId && isCoopEligibleStepType(currentStep.type)) {
            // Fire-and-forget, same invariant as every other AI/companion
            // call in this function: this never gates `getNextStepId`/
            // `advance` below, so a coop-claim failure can never block this
            // child's own, fully deterministic progress
            // (docs/ADVENTURE_ENGINE.md "Co-op sessions").
            void claimCoopSlot(coopSessionId, currentStep.id, childProfileId).catch(
              () => undefined,
            );
          }
        }
        if (
          currentStep.type === 'CREATIVE_CHOICE' &&
          currentStep.presentation.kind === 'creative-choice' &&
          answer.kind === 'creative-choice'
        ) {
          const chosenOption = currentStep.presentation.options.find(
            (option) => option.id === answer.optionId,
          );
          const stepId = currentStep.id;
          void requestCompanion({
            childProfileId,
            ageBand,
            intent: 'NARRATE',
            stepSummary: `Narrate a short story moment for "${chosenOption?.label ?? 'the child’s idea'}", the child's answer to "${currentStep.presentation.prompt}".`,
            sessionId: session.id,
            stepId,
            learningObjectiveCode: currentStep.objectiveIds[0],
            aiEnabled,
          }).then((result) => {
            if (!result) return;
            setStoryScenes((prev) => [
              ...prev,
              { stepId, text: result.turn.spokenText, source: result.source },
            ]);
          });
        }
        if (
          currentStep.type === 'NARRATIVE' &&
          currentStep.presentation.kind === 'narrative' &&
          currentStep.presentation.aiNarrated &&
          answer.kind === 'narrative'
        ) {
          void requestCompanion({
            childProfileId,
            ageBand,
            intent: 'NARRATE',
            stepSummary: currentStep.id,
            sessionId: session.id,
            stepId: currentStep.id,
            learningObjectiveCode: currentStep.objectiveIds[0],
            authoredBaseText: currentStep.presentation.text,
            aiEnabled,
          });
        }
        const nextStepId = getNextStepId(currentStep, correctness);
        await advance(nextStepId);
      } catch {
        setError('Something went wrong. Let’s try that again.');
      } finally {
        setSubmitting(false);
      }
    },
    [
      session,
      currentStep,
      currentProgress,
      advance,
      recordEvidenceForStep,
      requestCompanion,
      childProfileId,
      ageBand,
      aiEnabled,
      coopSessionId,
    ],
  );

  const requestHint = useCallback(() => {
    if (!currentStep) return;
    const newLevel = nextHintLevel(progressByStep[currentStep.id]?.hintLevel ?? 0);
    setProgressByStep((prev) => ({
      ...prev,
      [currentStep.id]: {
        hintLevel: newLevel,
        attemptNumber: prev[currentStep.id]?.attemptNumber ?? 0,
      },
    }));
    const authoredHintText = getHintText(currentStep, newLevel);
    if (authoredHintText && session) {
      void requestCompanion({
        childProfileId,
        ageBand,
        intent: 'HINT',
        stepSummary: currentStep.id,
        sessionId: session.id,
        stepId: currentStep.id,
        learningObjectiveCode: currentStep.objectiveIds[0],
        hintLevel: newLevel,
        authoredBaseText: authoredHintText,
        aiEnabled,
      });
    }
  }, [currentStep, progressByStep, session, requestCompanion, childProfileId, ageBand, aiEnabled]);

  useEffect(() => {
    if (!session || !currentStep) return;
    if (autoAdvancedStepRef.current === currentStep.id) return;

    if (currentStep.type === 'WORLD_CHANGE' && currentStep.presentation.kind === 'world-change') {
      autoAdvancedStepRef.current = currentStep.id;
      const { payload } = currentStep.presentation;
      void (async () => {
        try {
          if (coopSessionId) {
            // A shared-construction WORLD_CHANGE step is itself
            // coop-eligible (docs/ADVENTURE_ENGINE.md). Claiming it here
            // records which child actually finished the shared build for
            // presence purposes; the WorldChange write just below still
            // happens independently for *this* child regardless of who
            // claimed the step, since DATA_MODEL.md is explicit that a
            // CoopSession must never become the record of who learned
            // what — each participant's own client writes its own
            // WorldChange when it reaches this step, giving "one
            // WorldChange per participating child" for free rather than
            // needing a special dual-write path here.
            await claimCoopSlot(coopSessionId, currentStep.id, childProfileId).catch(
              () => undefined,
            );
          }
          await recordWorldChangeOnce(
            childProfileId,
            payload.locationSlug,
            payload.changeType,
            payload.changeKey,
            session.id,
          );
          if (coopSessionId) {
            // Idempotent (always sets status/completedAt regardless of
            // current value), so it is safe for both participants' clients
            // to call this independently as each reaches this step.
            await completeCoopSession(coopSessionId).catch(() => undefined);
          }
          if (storyScenes.length > 0) {
            await saveStoryArtifact(
              childProfileId,
              session.id,
              definition.slug,
              definition.title,
              storyScenes,
            );
          }
          await advance(getNextStepId(currentStep, 'not_applicable'));
        } catch {
          setError('Something went wrong saving your progress on the island.');
        }
      })();
      return;
    }

    if (currentStep.type === 'COMPLETE' && session.status !== 'COMPLETED') {
      autoAdvancedStepRef.current = currentStep.id;
      void (async () => {
        try {
          const updated = await completeSession(session.id);
          setSession(updated);
        } catch {
          setError('Something went wrong finishing the adventure.');
        }
      })();
    }
  }, [
    session,
    currentStep,
    childProfileId,
    advance,
    storyScenes,
    definition.slug,
    definition.title,
    coopSessionId,
  ]);

  return {
    loadState,
    session,
    currentStep,
    hintLevel,
    hintText: currentStep ? getHintText(currentStep, hintLevel) : undefined,
    submitting,
    error,
    submitAnswer,
    requestHint,
    companionTurn,
    storyScenes,
    coopSharedState,
  };
}
