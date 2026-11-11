import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SpeechCaption } from '../../../../../audio/speech';
import { getActiveSession, listActionsForSessions } from '../../../../adventures/api';
import { resolveAdventureForAgeBand } from '../../../../adventures/content';
import { THE_STORYKEEPERS_TALE } from '../../../../adventures/content/theStorykeepersTale';
import { isStoryForAgeBand } from '../../../../story/engine/eligibility';
import { THE_CASTLES_SECRET_DOOR } from '../../../../story/content/theCastlesSecretDoor';
import {
  resolveCastleChoiceBinding,
  resolveCastleChoiceEntity,
  THE_STORYKEEPERS_TALE_SLUG,
} from '../../castleChoiceBindings';
import { BINDING_LECTERN_ENTITY_ID } from '../../castleBindingLectern';
import type { LocationCompanionProps } from '../../runtime/viewExtensionRegistry';
import type { AdventureDefinition } from '../../../../adventures/engine/types';
import speechStyles from './CastleSpeech.module.css';
import { useCastleSpeech } from './useCastleSpeech';
import { CastleTaleSession, type CastleChoiceState } from './CastleTaleSession';
import { CastleSecretDoorStory } from './CastleSecretDoorStory';
import { isCastleTaleScene, type CastleTaleSceneApi } from './castleTaleScene';
import { tryParseCastleTaleConfig } from './castleTaleConfig';
import { useCastleNpcs, type CastleNpcHandover } from './useCastleNpcs';

/**
 * Storykeeper Castle's React half: the companion the generic view mounts for
 * the whole visit (engine Phase 9, ADR-032 part J).
 *
 * The castle is the one region whose *learning runs in the room*, and that
 * is why it needs a companion rather than an interaction-opened overlay.
 * Three things cannot wait for a child to press a button:
 *
 * - **A session left open yesterday resumes on the first frame**, with the
 *   child's portrait already lit and their window already bright. Both are
 *   read back from the answers the session recorded, so nothing new is
 *   persisted and nothing a client could forge.
 * - **Keeper Quill's gestures follow state only this half holds** - the rung
 *   of the hint ladder the child is on, whether the conversation panel is
 *   open, whether the session's time is up.
 * - **The reticle says what the card says.** A portrait's label is the
 *   option's own words, from whichever of the two adventures this child's
 *   band plays.
 *
 * Starting the tale does not navigate away: the session lives here and both
 * ways of answering go through its single `submitAnswer` - looking at a
 * portrait, or pressing the same option on the card. They cannot drift,
 * because there is one session, one submit and one `AdventureStepCard`.
 *
 * Keeper Quill on the NPC Manager (LAI-NPC-039): `useCastleNpcs` mounts the shared NPC scene
 * host for the castle's Place. When it serves Quill, the manifest Quill is handed over and his
 * talk opens the published conversation; the tale starting, resuming and completing are passed
 * on as play outcomes. When it serves nothing, the legacy Quill and his conversation are
 * exactly as before. The gestures below still go to the manifest Quill, which is hidden while
 * handed over (see `docs/NPC_MANAGER_IMPLEMENTATION_PLAN.md` section 8).
 */
const CHOOSE_HERO_STEP_ID = 'choose-hero';
const CHOOSE_SETTING_STEP_ID = 'choose-setting';
const STORY_REFLECTION_STEP_ID = 'story-reflection';
const TALK_TO_QUILL_INTERACTION_ID = 'talk-to-keeper-quill';

const NO_CHOICES: CastleChoiceState = {
  heroEntityId: null,
  settingEntityId: null,
  heroOptionId: null,
  settingOptionId: null,
  easelPainted: false,
};

/**
 * The child-facing label of one bound option, read off the adventure
 * definition rather than authored here, so the reticle says what the card
 * says in the card's own words.
 */
function optionLabelForEntity(
  entityId: string,
  definition: AdventureDefinition | undefined,
): string | undefined {
  if (entityId === BINDING_LECTERN_ENTITY_ID) return 'The binding lectern';
  if (!definition) return undefined;
  const binding = resolveCastleChoiceBinding(entityId, definition.slug);
  if (!binding) return undefined;
  const step = definition.steps.find((candidate) => candidate.id === binding.stepId);
  if (step?.presentation.kind === 'creative-choice') {
    return step.presentation.options.find((option) => option.id === binding.optionId)?.label;
  }
  if (step?.presentation.kind === 'ordering') {
    return step.presentation.items.find((item) => item.id === binding.optionId)?.label;
  }
  return undefined;
}

export function CastleTaleCompanion({
  childId,
  ageBand,
  aiEnabled,
  config,
  bus,
  sceneApi,
  claimedInteraction,
  openInteraction,
  onCloseInteraction,
  showToast,
  setFocusLabel,
  limitReached,
  refreshWorld,
  hudSlot,
}: LocationCompanionProps) {
  const parsed = useMemo(() => tryParseCastleTaleConfig(config), [config]);
  const scene: CastleTaleSceneApi | null = isCastleTaleScene(sceneApi) ? sceneApi : null;
  const sceneRef = useRef<CastleTaleSceneApi | null>(scene);
  sceneRef.current = scene;

  // Spoken dialogue (SM-P8-09): the castle opts in while it is mounted. See `useCastleSpeech`.
  const { speech, speaker } = useCastleSpeech(childId, parsed?.quillEntityId, sceneRef);

  const [taleActive, setTaleActive] = useState(false);
  const [storyActive, setStoryActive] = useState(false);
  const [restoredChoices, setRestoredChoices] = useState<CastleChoiceState>(NO_CHOICES);
  /** Whether the tale and the story have finished here (their cards then stop holding Quill). */
  const [taleDone, setTaleDone] = useState(false);
  const [storyDone, setStoryDone] = useState(false);

  /** Which adventure this child's band gets here (SC-10), asked rather than assumed. */
  const taleForBand = useMemo(
    () =>
      resolveAdventureForAgeBand(
        THE_STORYKEEPERS_TALE.locationSlug,
        THE_STORYKEEPERS_TALE.slug,
        ageBand,
      ),
    [ageBand],
  );
  /** ADR-027: the Story Engine's own gate, asked rather than restated here. */
  const storyForBand = isStoryForAgeBand(THE_CASTLES_SECRET_DOOR, ageBand);

  // Set below once the NPC host exists; read by the resume effect, which runs first.
  const taleStartedRef = useRef<((resumed: boolean) => void) | null>(null);
  const taleActiveRef = useRef(false);

  /*
    A session left open from an earlier visit resumes in the room the child
    left it in. Both choices are read back from the answers the session
    already recorded - no new persistence, and nothing the client could
    forge into a state the engine never agreed to.
  */
  useEffect(() => {
    let cancelled = false;
    async function resume() {
      if (!taleForBand) return;
      try {
        const openSession = await getActiveSession(childId, THE_STORYKEEPERS_TALE.slug);
        if (cancelled || !openSession) return;
        const actions = await listActionsForSessions([openSession.id]);
        if (cancelled) return;
        /*
          The last answer this child gave to a step, excluding ones the engine
          rejected. `CREATIVE_CHOICE` answers are graded `not_applicable`, so
          filtering on "correct" would match nothing it is asked about.
        */
        const answerFor = (stepId: string) =>
          actions
            .filter((action) => action.stepId === stepId && action.correctness !== 'INCORRECT')
            .at(-1)?.normalizedAnswer;
        const heroOptionId = answerFor(CHOOSE_HERO_STEP_ID) ?? null;
        const settingOptionId = answerFor(CHOOSE_SETTING_STEP_ID) ?? null;
        const easelPainted = actions.some((action) => action.stepId === STORY_REFLECTION_STEP_ID);
        const heroEntityId =
          resolveCastleChoiceEntity(
            THE_STORYKEEPERS_TALE_SLUG,
            CHOOSE_HERO_STEP_ID,
            heroOptionId,
          ) ?? null;
        const settingEntityId =
          resolveCastleChoiceEntity(
            THE_STORYKEEPERS_TALE_SLUG,
            CHOOSE_SETTING_STEP_ID,
            settingOptionId,
          ) ?? null;
        setRestoredChoices({
          heroEntityId,
          settingEntityId,
          heroOptionId,
          settingOptionId,
          easelPainted,
        });
        taleActiveRef.current = true;
        setTaleActive(true);
        taleStartedRef.current?.(true);
      } catch {
        // A failed read leaves the castle explorable, which is the calmer
        // answer for a child who just wants to walk around.
      }
    }
    void resume();
    return () => {
      cancelled = true;
    };
  }, [childId, taleForBand]);

  /*
    The room catches up with the session as soon as the scene exists: the
    portrait lit, the window bright, the page painted. Written as its own
    effect rather than inside the read above because the two arrive in
    whichever order they arrive - the per-region engine took these as
    construction options, which a manifest-built scene has no equivalent of.
    Idempotent, so applying it twice is applying it once.
  */
  useEffect(() => {
    if (!scene) return;
    scene.showChosenHero(restoredChoices.heroEntityId);
    scene.showChosenSetting(restoredChoices.settingEntityId);
    if (restoredChoices.easelPainted) {
      scene.showEaselPainting(restoredChoices.heroOptionId, restoredChoices.settingOptionId);
    }
  }, [scene, restoredChoices]);

  /** The two interactions this extension claims, and what opening them means. */
  useEffect(() => {
    if (!parsed || !claimedInteraction) return;
    if (claimedInteraction.id === parsed.taleInteractionId && taleForBand) {
      if (!taleActiveRef.current) taleStartedRef.current?.(false);
      taleActiveRef.current = true;
      setTaleActive(true);
      onCloseInteraction();
    }
    if (claimedInteraction.id === parsed.storyInteractionId && storyForBand) {
      setStoryActive(true);
      onCloseInteraction();
    }
  }, [parsed, claimedInteraction, taleForBand, storyForBand, onCloseInteraction]);

  /*
    Beat 2's gestures: `Talk` while the conversation panel is open, then
    `Point` toward the north archway when it closes. The castle's only
    wayfinding, and driven from here because only this half knows when the
    child is being spoken to.
  */
  const talkingToQuill = openInteraction?.id === TALK_TO_QUILL_INTERACTION_ID;
  const hasTalkedRef = useRef(false);
  useEffect(() => {
    if (talkingToQuill) {
      hasTalkedRef.current = true;
      sceneRef.current?.playQuillClip('Talk');
    } else if (hasTalkedRef.current) {
      sceneRef.current?.playQuillClip('Point');
    }
  }, [talkingToQuill]);

  /*
    Beat 13's calm stop, in the room: Quill stops writing and looks toward
    the nook. Once, when the time passes, and never mid-sentence.
  */
  const hasGesturedAtNookRef = useRef(false);
  useEffect(() => {
    if (!scene || !limitReached || hasGesturedAtNookRef.current) return;
    hasGesturedAtNookRef.current = true;
    scene.playQuillClip('Point', 'nook');
  }, [scene, limitReached]);

  /*
    What the reticle says, and what the HUD says about what is in the child's
    hands: the option's own words, from the adventure this band plays.
  */
  useEffect(() => {
    const offFocus = bus.on('InteractableFocused', ({ entityId }) => {
      if (!entityId) return;
      const label = optionLabelForEntity(entityId, taleForBand);
      if (label) setFocusLabel(label);
    });
    const offPickedUp = bus.on('CollectiblePickedUp', ({ entityId }) => {
      const label = optionLabelForEntity(entityId, taleForBand);
      if (label) showToast(`You picked up: ${label}`);
    });
    return () => {
      offFocus();
      offPickedUp();
    };
  }, [bus, taleForBand, setFocusLabel, showToast]);

  /** Every creative choice, whichever way it was made, so the room lights up. */
  const reflectChoice = useCallback((stepId: string, optionId: string) => {
    const entityId = resolveCastleChoiceEntity(THE_STORYKEEPERS_TALE_SLUG, stepId, optionId);
    if (!entityId) return;
    if (stepId === CHOOSE_HERO_STEP_ID) sceneRef.current?.showChosenHero(entityId);
    if (stepId === CHOOSE_SETTING_STEP_ID) sceneRef.current?.showChosenSetting(entityId);
  }, []);

  // --- Keeper Quill on the NPC Manager (LAI-NPC-039) ---------------------------------------
  const quillEntityId = parsed?.quillEntityId;
  const handovers = useMemo<readonly CastleNpcHandover[]>(
    // The manifest Quill's entity id is also his NPC id (`KEEPER_QUILL_ID`).
    () => (quillEntityId ? [{ entityId: quillEntityId, npcId: quillEntityId }] : []),
    [quillEntityId],
  );
  const openElsewhere =
    openInteraction !== null &&
    claimedInteraction === null &&
    openInteraction.id !== TALK_TO_QUILL_INTERACTION_ID;
  const npcs = useCastleNpcs({
    childId,
    ageBand,
    scene,
    handovers,
    claimedInteraction,
    onCloseInteraction,
    suspended: (taleActive && !taleDone) || (storyActive && !storyDone) || openElsewhere,
  });
  const { notifyTaleStarted, notifyTaleCompleted } = npcs;
  const taleSlug = taleForBand?.slug ?? THE_STORYKEEPERS_TALE.slug;
  taleStartedRef.current = (resumed) => notifyTaleStarted(resumed, taleSlug);

  const handleTaleComplete = useCallback(() => {
    setTaleDone(true);
    notifyTaleCompleted(taleSlug);
    void refreshWorld();
  }, [refreshWorld, notifyTaleCompleted, taleSlug]);

  const handleStoryComplete = useCallback(() => {
    setStoryDone(true);
    void refreshWorld();
  }, [refreshWorld]);

  if (!parsed) return null;

  // Quill's unprompted lines are a non-modal bubble that sits beside the Talk prompt (F-B).
  const npcStage =
    npcs.host.panel ??
    (npcs.host.bubble || npcs.host.prompt ? (
      <>
        {npcs.host.bubble}
        {npcs.host.prompt}
      </>
    ) : null);
  const captions = (
    <div className={speechStyles.captions}>
      <SpeechCaption
        state={speech.state}
        speaker={speaker}
        onReplay={() => void speech.replay()}
        onStop={speech.stop}
        onPause={speech.pause}
        onResume={speech.resume}
      />
    </div>
  );

  return (
    <>
      {hudSlot ? createPortal(captions, hudSlot) : captions}
      {npcStage ? (hudSlot ? createPortal(npcStage, hudSlot) : npcStage) : null}
      {taleActive && taleForBand ? (
        <CastleTaleSession
          childId={childId}
          ageBand={ageBand}
          aiEnabled={aiEnabled}
          bus={bus}
          scene={sceneRef}
          definition={taleForBand}
          restoredChoices={restoredChoices}
          onChoice={reflectChoice}
          onComplete={handleTaleComplete}
          backToMapHref={`/island/${childId}/locations/storykeeper-castle`}
        />
      ) : null}
      {storyActive && storyForBand ? (
        <CastleSecretDoorStory
          childId={childId}
          ageBand={ageBand}
          aiEnabled={aiEnabled}
          bus={bus}
          scene={sceneRef}
          onComplete={handleStoryComplete}
          backToMapHref={`/island/${childId}/locations/storykeeper-castle`}
        />
      ) : null}
    </>
  );
}
