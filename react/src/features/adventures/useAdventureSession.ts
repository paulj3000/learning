import { useCallback, useEffect, useRef, useState } from 'react';
import { getHintText, getNextStepId, getStep, nextHintLevel } from './engine';
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
  submitAdventureAnswer,
  type AdventureSession,
  type StoryScene,
} from './api';
import { upsertSkillProgress } from '../mastery/api';
import { syncQuestProgress } from '../quests/api';
import { useCompanionTurn } from '../companion/useCompanionTurn';
import type { CompanionTurnState } from '../companion/useCompanionTurn';
import { useTutorTurn } from '../tutor/useTutorTurn';
import { isTutorableSkill } from '../tutor/context';
import { toCompanionTurnState } from '../tutor/presentation';
import { representationAidForTurn } from '../tutor/scaffold';
import type { RepresentationAid } from '../tutor/content/representationAids';
import type { AgeBandValue } from '../child-profile/constants';
import { ensureChildProfileOwnerSub } from '../child-profile/api';
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
        // `submitAdventureAnswer` (docs/DECISIONS.md ADR-012) needs
        // `ChildProfile.ownerSub` set to re-verify session ownership; a
        // profile created before that field existed gets it backfilled here,
        // once, before this child can submit an answer.
        const [active] = await Promise.all([
          resumeOrStartSession(childProfileId, definition),
          ensureChildProfileOwnerSub(childProfileId),
        ]);
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
    async (answer: StepAnswer): Promise<Correctness | null> => {
      if (!session || !currentStep) return null;
      setSubmitting(true);
      setError(null);
      try {
        const priorHintLevel = currentProgress?.hintLevel ?? 0;
        const attemptNumber = (currentProgress?.attemptNumber ?? 0) + 1;

        // The server, not this code, decides correctness and (when the
        // answer advances the session) writes the session's new
        // `currentStepId` itself (docs/DECISIONS.md ADR-012) — this replaces
        // both the local `validateStepAnswer`/`getNextStepId` calls and the
        // `advanceSession()` write that used to follow them.
        const { correctness, supportLevel, action, nextStepId } = await submitAdventureAnswer(
          session.id,
          answer,
          priorHintLevel,
        );

        setProgressByStep((prev) => ({
          ...prev,
          [currentStep.id]: { hintLevel: supportLevel, attemptNumber },
        }));

        await recordAction({
          sessionId: session.id,
          stepId: currentStep.id,
          actionType: currentStep.type,
          normalizedAnswer: normalizeAnswer(answer),
          correctness,
          hintLevel: supportLevel,
          attemptNumber,
        });

        if (action === 'RETRY') {
          return correctness;
        }

        if (correctness !== 'not_applicable') {
          await recordEvidenceForStep(currentStep, session.id, correctness, supportLevel);
        }
        if (correctness === 'correct') {
          setLastSpeaker('companion');
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
          setLastSpeaker('companion');
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
          setLastSpeaker('companion');
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
        // The Lambda already wrote this session's new `currentStepId`; a
        // second client-side write would be redundant at best and, if this
        // code ever computed a different value, would silently clobber the
        // server's own verdict. Patch local state to match instead.
        if (nextStepId) {
          setSession((prev) =>
            prev
              ? { ...prev, currentStepId: nextStepId, lastActivityAt: new Date().toISOString() }
              : prev,
          );
        }
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
      currentProgress,
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
  ]);

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
          return;
        }
        // Phase 25: finishing an adventure can finish a stage of a quest
        // that composes it. `syncQuestProgress` recomputes every active
        // quest from world state, so this call site does not need to know
        // which quests (if any) name this adventure - and a child with no
        // quests started pays one list read and stops.
        //
        // Deliberately after the session write and deliberately swallowed:
        // the adventure is already complete and celebrated by this point,
        // and a quest that could not be advanced now will advance the next
        // time anything reads it, because quest progress is derived rather
        // than reported (src/features/quests/types.ts).
        await syncQuestProgress(childProfileId).catch(() => undefined);
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
