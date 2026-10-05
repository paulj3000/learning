import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styles from '../../../IslandWorldView.module.css';
import { AdventureStepCard } from '../../../../adventures/AdventureStepCard';
import { useAdventureSession } from '../../../../adventures/useAdventureSession';
import type { AdventureDefinition } from '../../../../adventures/engine/types';
import type { StepAnswer } from '../../../../adventures/engine/validators';
import type { AgeBandValue } from '../../../../child-profile/constants';
import {
  getCastleChoiceBindingsForStep,
  resolveCastleChoiceBinding,
  seatedEntitiesToOrder,
} from '../../castleChoiceBindings';
import { BINDING_LECTERN_ENTITY_ID } from '../../castleBindingLectern';
import type { WorldEngineEventBus } from '../../worldEngineEvents';
import type { CastleTaleSceneApi } from './castleTaleScene';

/**
 * One in-world play-through of "The Storykeeper's Tale" (engine Phase 9,
 * moved from `StorykeeperCastleWorldView.tsx` unchanged).
 *
 * Holds the session and renders the same `AdventureStepCard` the card route
 * renders. Two beats get a second way in - a portrait looked at, a window
 * stood in front of - and both funnel into the identical `submitAnswer`,
 * which is what makes "choosing through the room and choosing through the
 * card produce identical session state" true by construction rather than by
 * two implementations agreeing.
 *
 * A world event is only ever accepted for the step that is open right now.
 * Walking past the tower during `choose-hero` does nothing, and no event can
 * skip the child ahead: the binding must name the current step or it is
 * ignored.
 *
 * Three beats need the traffic to run the other way as well, because each is
 * a consequence of session state rather than of the room: Quill points at the
 * mantel from rung 3 of the *existing* hint ladder (beat 5), three seated
 * plates become an `ORDERING` answer and lift back off when it is wrong
 * (beat 6), and the easel paints itself when the child reflects (beat 7).
 * Every one of them reads the engine's verdict rather than forming its own -
 * the plates reset on `correctness !== 'correct'` as decided server-side
 * (ADR-012), never on anything this file compared.
 */
export interface CastleChoiceState {
  heroEntityId: string | null;
  settingEntityId: string | null;
  /** The option ids behind those two, which is what the easel's picture is keyed by. */
  heroOptionId: string | null;
  settingOptionId: string | null;
  /** Whether this session already reached beat 7, so the easel is already painted. */
  easelPainted: boolean;
}

const CHOOSE_HERO_STEP_ID = 'choose-hero';
const CHOOSE_SETTING_STEP_ID = 'choose-setting';
const COMPREHENSION_CHECK_STEP_ID = 'comprehension-check';
const STORY_REFLECTION_STEP_ID = 'story-reflection';
const STORY_WRITTEN_STEP_ID = 'story-written';
/**
 * The hint rung from which Keeper Quill starts pointing at the hearth mantel
 * (storyboard beat 5). Rung 3 is "Keeper Quill named three things a story
 * needs", so the gesture arrives with the words that make it mean something.
 * The physical hint *follows* the authored ladder: it never replaces a rung,
 * reorders one, skips one, or advances the level itself.
 */
const QUILL_POINTS_AT_MANTEL_FROM_RUNG = 3;

/** Whether this step's answer is an arrangement of things this adventure binds. */
function isArrangementStep(definition: AdventureDefinition, stepId: string): boolean {
  const step = definition.steps.find((candidate) => candidate.id === stepId);
  if (step?.presentation.kind !== 'ordering') return false;
  return getCastleChoiceBindingsForStep(definition.slug, stepId).length > 0;
}

/**
 * Whether this step is one the room answers with a single world event -
 * looking at a portrait, standing at a window.
 *
 * Derived from the bindings rather than listed: the Sprouts adventure stages
 * the same two beats under different step ids, and a hardcoded list of the
 * Pathfinder tale's ids silently made the whole gallery inert for
 * three-year-olds.
 */
function isSpatialChoiceStep(definition: AdventureDefinition, stepId: string | null): boolean {
  if (!stepId) return false;
  const step = definition.steps.find((candidate) => candidate.id === stepId);
  if (step?.presentation.kind !== 'creative-choice') return false;
  return getCastleChoiceBindingsForStep(definition.slug, stepId).length > 0;
}

export interface CastleTaleSessionProps {
  childId: string;
  ageBand: AgeBandValue;
  aiEnabled: boolean;
  bus: WorldEngineEventBus;
  /** The live scene half, which this component talks back to. */
  scene: React.RefObject<CastleTaleSceneApi | null>;
  definition: AdventureDefinition;
  restoredChoices: CastleChoiceState;
  onChoice: (stepId: string, optionId: string) => void;
  onComplete: () => void;
  backToMapHref: string;
}

export function CastleTaleSession({
  childId,
  ageBand,
  aiEnabled,
  bus,
  scene,
  definition,
  restoredChoices,
  onChoice,
  onComplete,
  backToMapHref,
}: CastleTaleSessionProps) {
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

  /** The story so far, as option ids: beat 7's picture is keyed by the pair. */
  const [choices, setChoices] = useState<{ hero: string | null; setting: string | null }>({
    hero: restoredChoices.heroOptionId,
    setting: restoredChoices.settingOptionId,
  });

  const stepId = currentStep?.id ?? null;
  /**
   * The one submit both routes use. Reflecting the choice here rather than at
   * each call site is what makes the card light the portrait too: a child who
   * answers from the card still sees their hero lit when they walk into the
   * gallery afterwards.
   */
  const submitAnswerAndReflect = useCallback(
    async (answer: StepAnswer) => {
      if (answer.kind === 'creative-choice' && stepId) {
        onChoice(stepId, answer.optionId);
        if (stepId === CHOOSE_HERO_STEP_ID) {
          setChoices((previous) => ({ ...previous, hero: answer.optionId }));
        } else if (stepId === CHOOSE_SETTING_STEP_ID) {
          setChoices((previous) => ({ ...previous, setting: answer.optionId }));
        }
      }
      /*
        Beat 7. The easel fills as the child says they have pictured their
        story, not after some later step - the reflection *is* the picture.
        Nothing is graded (`REFLECTION` is `not_applicable`), so this is
        presentation reacting to a step, never a step outcome.
      */
      if (answer.kind === 'reflection' && stepId === STORY_REFLECTION_STEP_ID) {
        scene.current?.showEaselPainting(choices.hero, choices.setting);
      }
      return submitAnswer(answer);
    },
    [submitAnswer, stepId, onChoice, scene, choices],
  );

  const submitRef = useRef(submitAnswerAndReflect);
  submitRef.current = submitAnswerAndReflect;

  /**
   * Beat 5's physical hint. Quill turns and points at the hearth mantel from
   * rung 3 onward, and turns back to the hall when the check is answered.
   * This reads `hintLevel`; it never writes one.
   */
  const pointingAtMantel =
    stepId === COMPREHENSION_CHECK_STEP_ID && hintLevel >= QUILL_POINTS_AT_MANTEL_FROM_RUNG;
  const wasPointingAtMantel = useRef(false);
  useEffect(() => {
    if (pointingAtMantel) {
      scene.current?.playQuillClip('Point', 'hearth');
    } else if (wasPointingAtMantel.current) {
      scene.current?.playQuillClip('Idle');
    }
    wasPointingAtMantel.current = pointingAtMantel;
  }, [pointingAtMantel, scene]);

  /**
   * Beat 8. The book arrives on the shelf, the hearth lights, the carpet runs
   * on through the hub, and Quill celebrates.
   *
   * Driven by the `WORLD_CHANGE` step being on screen rather than by a
   * submit, because such a step has no answer to submit:
   * `useAdventureSession` writes the `WorldChange` and advances past it on
   * its own. That step, its payload and its `changeKey` are untouched.
   */
  const hasCelebratedRef = useRef(false);
  useEffect(() => {
    if (stepId !== STORY_WRITTEN_STEP_ID || hasCelebratedRef.current) return;
    hasCelebratedRef.current = true;
    scene.current?.showStoryTold(true);
    scene.current?.playQuillClip('Celebrate');
  }, [stepId, scene]);

  /**
   * Beat 6. The lectern always works as furniture - a child can pick a plate
   * up and put it down whenever they like - so the step starts by clearing
   * whatever they were playing with, and every arrangement the room reports
   * outside this step is ignored.
   */
  const orderingStepId = stepId && isArrangementStep(definition, stepId) ? stepId : null;
  const activePlates = useMemo(
    () =>
      orderingStepId
        ? getCastleChoiceBindingsForStep(definition.slug, orderingStepId).map(
            (binding) => binding.entityId,
          )
        : [],
    [definition, orderingStepId],
  );

  useEffect(() => {
    if (!orderingStepId) return;
    // Only the plates this adventure orders: the tale seats three and the
    // Sprouts picture story seats two out of the same set.
    scene.current?.resetBindingPlates(activePlates);
  }, [orderingStepId, activePlates, scene]);

  useEffect(() => {
    if (!orderingStepId) return;
    return bus.on('BuildActionRequested', ({ entityId, order }) => {
      if (entityId !== BINDING_LECTERN_ENTITY_ID) return;
      const answer = seatedEntitiesToOrder(definition.slug, orderingStepId, order ?? []);
      if (!answer) return;
      void submitRef.current({ kind: 'ordering', order: answer }).then((correctness) => {
        /*
          Beat 6's promise on a wrong order: the plates lift back out and
          settle on the table, Quill looks concerned, and nothing is lost. The
          hint ladder has already advanced a rung, because this went through
          the same `submitAnswer` the HUD list goes through.
        */
        if (correctness === 'correct') return;
        scene.current?.resetBindingPlates(activePlates);
        scene.current?.playQuillClip('ReactConcerned');
      });
    });
  }, [bus, orderingStepId, definition, activePlates, scene]);

  useEffect(() => {
    if (!isSpatialChoiceStep(definition, stepId)) return;

    const answerWith = (id: string) => {
      /*
        A zone may be named after the portrait standing in it, suffixed by
        the manifest because entity and zone ids share one namespace in the
        generic runtime (ADR-025 part J). Both resolve to the same binding.
      */
      const entityId = id.replace(/:approach$/, '');
      const binding = resolveCastleChoiceBinding(entityId, definition.slug);
      if (!binding || binding.stepId !== stepId) return;
      void submitRef.current({ kind: 'creative-choice', optionId: binding.optionId });
    };

    // Beat 3 is a raycast (a portrait is a thing you look at); beat 4 is an
    // approach (a window is a place you stand at, which keeps it reachable
    // for a band that cannot aim).
    const offInteracted = bus.on('ObjectInteracted', ({ entityId }) => answerWith(entityId));
    const offZone = bus.on('PlayerEnteredZone', ({ zoneId }) => answerWith(zoneId));
    return () => {
      offInteracted();
      offZone();
    };
  }, [bus, stepId, definition]);

  if (loadState === 'loading') {
    return <p className={styles.status}>Opening your story...</p>;
  }
  if (loadState === 'error' || !currentStep) {
    return (
      <p className={styles.status} role="alert">
        Something went wrong opening your story.
      </p>
    );
  }

  return (
    <div className={styles.panel}>
      <AdventureStepCard
        currentStep={currentStep}
        submitting={submitting}
        error={error}
        submitAnswer={submitAnswerAndReflect}
        hintLevel={hintLevel}
        hintText={hintText}
        requestHint={requestHint}
        companionTurn={companionTurn}
        representationAid={representationAid}
        storyScenes={storyScenes}
        backToMapHref={backToMapHref}
      />
    </div>
  );
}
