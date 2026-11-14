import { useCallback, useEffect, useRef, useState } from 'react';
import { getHintText, getStep, nextHintLevel } from './engine';
import type { AdventureDefinition, AdventureStep, Correctness } from './engine/types';
import type { StepAnswer } from './engine/validators';
import {
  requestAdventureHint,
  resumeOrStartSession,
  saveStoryArtifact,
  submitAdventureAnswer,
  type AdventureSession,
  type StoryScene,
} from './api';
import { AdventureUnavailableError } from '../catalog/availabilityApi';
import { syncQuestProgress } from '../quests/api';
import { useCompanionTurn } from '../companion/useCompanionTurn';
import type { CompanionTurnState } from '../companion/useCompanionTurn';
import { useTutorTurn } from '../tutor/useTutorTurn';
import { isTutorableSkill } from '../tutor/context';
import { toCompanionTurnState } from '../tutor/presentation';
import { representationAidForTurn } from '../tutor/scaffold';
import type { RepresentationAid } from '../tutor/content/representationAids';
import type { AgeBandValue } from '../child-profile/constants';
import { claimCoopSlot, completeCoopSession } from '../coop/api';
import { useCoopPresence } from '../coop/useCoopPresence';
import { isCoopEligibleStepType, type CoopSharedState } from '../coop/types';

type LoadState = 'loading' | 'ready' | 'error';

interface StepProgress {
  hintLevel: number;
}

export interface AdventureSessionState {
  loadState: LoadState;
  session: AdventureSession | null;
  currentStep: AdventureStep | null;
  hintLevel: number;
  hintText: string | undefined;
  submitting: boolean;
  error: string | null;
  /**
   * Grades and records one answer. Resolves with the *server's* verdict on
   * it, or `null` when there was nothing to grade (no open session) or the
   * submit failed - so a caller that has to react to being wrong can, and
   * one that does not can keep ignoring the result.
   *
   * The first such caller is Storykeeper Castle's binding lectern
   * (`docs/STORYKEEPER_CASTLE_3D_ROADMAP.md` SC-5): three stone plates
   * seated in three sockets have to lift back onto the table when the order
   * is wrong, and the room cannot work that out for itself without
   * duplicating the grading this hook deliberately keeps server-side
   * (ADR-012).
   */
  submitAnswer: (answer: StepAnswer) => Promise<Correctness | null>;
  requestHint: () => void;
  companionTurn: CompanionTurnState;
  /**
   * The authored manipulative to show alongside the step, set only while the
   * hint ladder is on its "partial scaffold" rung for a skill that has one
   * (docs/ADVENTURE_ENGINE.md, `src/features/tutor/content/representationAids.ts`).
   * Never graded and never part of a transition; see `RepresentationAid.tsx`.
   */
  representationAid: RepresentationAid | undefined;
  /** AI-narrated story beats accumulated so far (Storykeeper Castle only; empty otherwise). */
  storyScenes: StoryScene[];
  /** Live shared state for a Phase 17 coop session, or empty when not playing one. */
  coopSharedState: CoopSharedState;
}

/**
 * Orchestrates one child's play-through of one adventure: loads or creates
 * the session, sends each answer and hint request to the server, and shows
 * what the server decided (CLAUDE.md section 7: no AI decides correctness or
 * transitions; ADR-012: the server grades, records the attempt and its skill
 * evidence, advances the session, records a WORLD_CHANGE step's world change
 * and completes the session). Keeps that logic out of components entirely
 * (CLAUDE.md section 13). Also requests AI-phrased companion dialogue for
 * hints and celebrations (Phase 4), which only ever varies presentation.
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
  const questSyncedSessionRef = useRef<string | null>(null);
  const { state: companionTurn, request: requestCompanion } = useCompanionTurn();
  const { state: tutorTurn, request: requestTutor } = useTutorTurn();
  /**
   * Which of the two AI routes spoke most recently. Chatty is one character
   * with one speech bubble (CLAUDE.md section 6), so the hint ladder's
   * tutoring turns and the companion's narration/celebration turns take it
   * in turns rather than stacking two bubbles on a child's screen.
   */
  const [lastSpeaker, setLastSpeaker] = useState<'companion' | 'tutor'>('companion');
  /** Which step the current tutoring turn belongs to, so a scaffold cannot outlive its step. */
  const [tutorStepId, setTutorStepId] = useState<string | null>(null);
  const { sharedState: coopSharedState } = useCoopPresence(coopSessionId, childProfileId);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const active = await resumeOrStartSession(childProfileId, definition);
        if (cancelled) return;
        setSession(active);
        // The server remembers the hint level it gave on the current step.
        setProgressByStep(
          active.hintLevel > 0 ? { [active.currentStepId]: { hintLevel: active.hintLevel } } : {},
        );
        setLoadState('ready');
      } catch (loadError) {
        if (cancelled) return;
        // A deactivated adventure is not a failure; its own calm message says so.
        if (loadError instanceof AdventureUnavailableError) setError(loadError.message);
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

  const submitAnswer = useCallback(
    async (answer: StepAnswer): Promise<Correctness | null> => {
      if (!session || !currentStep) return null;
      setSubmitting(true);
      setError(null);
      try {
        // The server, not this code, decides correctness, records the attempt
        // and its skill evidence, and (when the answer advances) moves the
        // session on itself (docs/DECISIONS.md ADR-012). The hint level it
        // grades with is its own record of the hints it gave on this step.
        const result = await submitAdventureAnswer(
          childProfileId,
          session.id,
          currentStep.id,
          answer,
        );
        const { correctness, supportLevel, action } = result;

        setProgressByStep((prev) => ({
          ...prev,
          [currentStep.id]: { hintLevel: supportLevel },
        }));

        if (action === 'RETRY') {
          setSession(result.session);
          return correctness;
        }
        if (correctness === 'correct') {
          setLastSpeaker('companion');
          void requestCompanion({
            templateId: definition.slug,
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
          setLastSpeaker('companion');
          void requestCompanion({
            templateId: definition.slug,
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
          setLastSpeaker('companion');
          void requestCompanion({
            templateId: definition.slug,
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
        // The server already moved the session on (and completed it when the
        // next step ends the adventure); show its state rather than a guess.
        setSession(result.session);
        return correctness;
      } catch {
        setError('Something went wrong. Let’s try that again.');
        return null;
      } finally {
        setSubmitting(false);
      }
    },
    [
      session,
      currentStep,
      requestCompanion,
      childProfileId,
      ageBand,
      aiEnabled,
      coopSessionId,
      definition.slug,
    ],
  );

  const requestHint = useCallback(() => {
    if (!currentStep) return;
    const fromLevel = progressByStep[currentStep.id]?.hintLevel ?? 0;
    const newLevel = nextHintLevel(fromLevel);
    const stepId = currentStep.id;
    setProgressByStep((prev) => ({ ...prev, [stepId]: { hintLevel: newLevel } }));
    if (session) {
      // The server keeps the hint ladder it grades with (compare-and-set on
      // `fromLevel`, so a retry cannot escalate twice); adopt its level.
      void requestAdventureHint(childProfileId, session.id, stepId, fromLevel)
        .then((level) => {
          setProgressByStep((prev) => ({ ...prev, [stepId]: { hintLevel: level } }));
        })
        .catch(() => undefined);
    }
    const authoredHintText = getHintText(currentStep, newLevel);
    if (!authoredHintText || !session) return;
    const skillId = currentStep.objectiveIds[0];
    // Phase 27: a hint on a skill the curriculum knows and a designer has
    // authored tutoring vocabulary for goes to the AI Tutor Engine, which
    // sends the skill, its known prerequisites, the current quest, and the
    // rung of the ladder instead of a bare step id. Every other skill keeps
    // the Phase 4 companion call unchanged - `isTutorableSkill` is the gate,
    // and the child sees the same authored hint text either way.
    if (skillId && isTutorableSkill(skillId)) {
      setLastSpeaker('tutor');
      setTutorStepId(currentStep.id);
      void requestTutor({
        templateId: definition.slug,
        childProfileId,
        ageBand,
        skillId,
        hintLevel: newLevel,
        authoredBaseText: authoredHintText,
        sessionId: session.id,
        stepId: currentStep.id,
        aiEnabled,
      });
      return;
    }
    setLastSpeaker('companion');
    void requestCompanion({
      templateId: definition.slug,
      childProfileId,
      ageBand,
      intent: 'HINT',
      stepSummary: currentStep.id,
      sessionId: session.id,
      stepId: currentStep.id,
      learningObjectiveCode: skillId,
      hintLevel: newLevel,
      authoredBaseText: authoredHintText,
      aiEnabled,
    });
  }, [
    currentStep,
    progressByStep,
    session,
    requestCompanion,
    requestTutor,
    childProfileId,
    ageBand,
    aiEnabled,
    definition.slug,
  ]);

  useEffect(() => {
    if (!session || !currentStep) return;
    if (autoAdvancedStepRef.current === currentStep.id) return;
    if (session.status !== 'ACTIVE') return;

    if (currentStep.type === 'WORLD_CHANGE' && currentStep.presentation.kind === 'world-change') {
      autoAdvancedStepRef.current = currentStep.id;
      const stepId = currentStep.id;
      void (async () => {
        try {
          if (coopSessionId) {
            // A shared-construction WORLD_CHANGE step is itself
            // coop-eligible (docs/ADVENTURE_ENGINE.md). Claiming it here
            // records which child actually finished the shared build for
            // presence purposes; each participant's own session records its
            // own world change on the server, giving "one WorldChange per
            // participating child" without a dual-write path.
            await claimCoopSlot(coopSessionId, stepId, childProfileId).catch(() => undefined);
          }
          if (storyScenes.length > 0) {
            // One story per session on the server, so a retry cannot duplicate it.
            await saveStoryArtifact(childProfileId, session.id, storyScenes);
          }
          // Leaving the step is an ungraded answer: the server records the
          // step's authored world change (once) and moves the session on.
          const result = await submitAdventureAnswer(childProfileId, session.id, stepId, {
            kind: 'world-change',
          });
          if (coopSessionId) {
            // Idempotent, so it is safe for both participants' clients to
            // call this independently as each reaches this step.
            await completeCoopSession(coopSessionId, childProfileId).catch(() => undefined);
          }
          setSession(result.session);
        } catch {
          setError('Something went wrong saving your progress on the island.');
        }
      })();
    }
  }, [session, currentStep, childProfileId, storyScenes, coopSessionId]);

  useEffect(() => {
    if (!session || session.status !== 'COMPLETED') return;
    if (questSyncedSessionRef.current === session.id) return;
    questSyncedSessionRef.current = session.id;
    // Phase 25: finishing an adventure can finish a stage of a quest that
    // composes it. `syncQuestProgress` recomputes every active quest from
    // world state, so this call site does not need to know which quests (if
    // any) name this adventure. The server completed the session itself when
    // the last answer moved it to a COMPLETE step.
    //
    // Deliberately swallowed: the adventure is already complete and
    // celebrated, and a quest that could not be advanced now will advance the
    // next time anything reads it, because quest progress is derived rather
    // than reported (src/features/quests/types.ts).
    void syncQuestProgress(childProfileId).catch(() => undefined);
  }, [session, childProfileId]);

  // The rule itself is pure and lives in the tutor module
  // (`representationAidForTurn`); `tutorStepId` is what keeps a scaffold
  // from outliving the step it was offered for.
  const representationAid = representationAidForTurn(
    currentStep?.objectiveIds[0],
    tutorTurn,
    Boolean(currentStep && tutorStepId === currentStep.id),
  );

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
    companionTurn: lastSpeaker === 'tutor' ? toCompanionTurnState(tutorTurn) : companionTurn,
    representationAid,
    storyScenes,
    coopSharedState,
  };
}
