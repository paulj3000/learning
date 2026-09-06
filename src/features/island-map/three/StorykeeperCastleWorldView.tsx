import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import styles from '../IslandWorldView.module.css';
import { ThreeGameContainer } from './ThreeGameContainer';
import {
  createStorykeeperCastleEngine,
  type StorykeeperCastleEngine,
} from './storykeeperCastleScene';
import { WorldEngineEventBus } from './worldEngineEvents';
import { useNpcApproachBridge } from './npcApproachBridge';
import { WorldHud, type WorldHudBackpackItem } from './WorldHud';
import { KEEPER_QUILL_ID } from './storykeeperCastleRegion';
import {
  resolveCastleChoiceBinding,
  resolveCastleChoiceEntity,
  THE_STORYKEEPERS_TALE_SLUG,
} from './castleChoiceBindings';
import {
  BINDING_LECTERN_ENTITY_ID,
  ORDER_THE_STORY_STEP_ID,
  seatedPlatesToOrder,
} from './castleBindingLectern';
import {
  findInteraction,
  isInteractionAvailable,
  STORYKEEPER_CASTLE_INTERACTIONS,
  type WorldAction,
  type WorldInteraction,
  type WorldInteractionContext,
} from '../worldObjects';
import { NpcConversation } from '../NpcConversation';
import { AdventureStepCard } from '../../adventures/AdventureStepCard';
import { useAdventureSession } from '../../adventures/useAdventureSession';
import { THE_STORYKEEPERS_TALE } from '../../adventures/content/theStorykeepersTale';
import {
  getActiveSession,
  listActionsForSessions,
  listAllWorldChanges,
} from '../../adventures/api';
import { resolveAdventureForAgeBand } from '../../adventures/content';
import type { StepAnswer } from '../../adventures/engine/validators';
import { getWorldState, recordCharacterMet, saveCheckpoint } from '../../discovery/api';
import { findCheckpoint, KNOWN_CHECKPOINT_IDS } from '../../discovery/checkpoints';
import { getInventory } from '../../rewards/api';
import { ALL_ITEMS } from '../../rewards/content';
import { listQuestStates } from '../../quests/api';
import { getQuestDefinition } from '../../quests/content';
import { getCompanionProfile } from '../../island/api';
import type { AgeBandValue } from '../../child-profile/constants';

interface StorykeeperCastleWorldViewProps {
  childId: string;
  /** The child's own `ChildProfile.ageBand`, resolved by the caller. Gates what may be started here. */
  ageBand: AgeBandValue;
  /** The parent's AI setting for this child, passed straight to the session. */
  aiEnabled: boolean;
}

const TOAST_DURATION_MS = 4000;

const FIRST_STORY_TOLD_CHANGE_KEY = 'FIRST_STORY_TOLD';

const HARBOR_EXIT_ZONE_ID = 'castle-harbor-exit';
const STORY_HALL_ZONE_ID = 'castle-story-hall';
const TALK_TO_QUILL_INTERACTION_ID = 'talk-to-keeper-quill';

const CHOOSE_HERO_STEP_ID = 'choose-hero';
const CHOOSE_SETTING_STEP_ID = 'choose-setting';
const COMPREHENSION_CHECK_STEP_ID = 'comprehension-check';
const STORY_REFLECTION_STEP_ID = 'story-reflection';

/** The two `CREATIVE_CHOICE` steps SC-4 makes into places, answered by one world event each. */
const SPATIAL_STEP_IDS: readonly string[] = [CHOOSE_HERO_STEP_ID, CHOOSE_SETTING_STEP_ID];

/**
 * The hint rung from which Keeper Quill starts pointing at the hearth
 * mantel (storyboard beat 5). Rung 3 is "Keeper Quill named three things a
 * story needs", so the gesture arrives with the words that make it mean
 * something and not before.
 *
 * The physical hint **follows** the authored ladder: it never replaces a
 * rung, reorders one, skips one, or advances the level itself. Everything
 * about escalation stays in `useAdventureSession`, and
 * `theStorykeepersTale.test.ts` pins the five rungs this reads against.
 */
const QUILL_POINTS_AT_MANTEL_FROM_RUNG = 3;

/** The chosen entity for each bound step, restored from an open session. */
export interface CastleChoiceState {
  heroEntityId: string | null;
  settingEntityId: string | null;
  /** The option ids behind those two, which is what the easel's picture is keyed by. */
  heroOptionId: string | null;
  settingOptionId: string | null;
  /** Whether this session already reached beat 7, so the easel is already painted. */
  easelPainted: boolean;
}

const NO_CHOICES: CastleChoiceState = {
  heroEntityId: null,
  settingEntityId: null,
  heroOptionId: null,
  settingOptionId: null,
  easelPainted: false,
};

/**
 * The child-facing label of one bound option, read off the adventure
 * definition rather than authored here. The reticle says what choosing a
 * portrait would *mean* ("A clever fox"), which is the same words the card
 * uses, because it is the same string.
 */
function optionLabelForEntity(entityId: string): string | undefined {
  if (entityId === BINDING_LECTERN_ENTITY_ID) return 'The binding lectern';
  const binding = resolveCastleChoiceBinding(entityId);
  if (!binding || binding.templateSlug !== THE_STORYKEEPERS_TALE_SLUG) return undefined;
  const step = THE_STORYKEEPERS_TALE.steps.find((candidate) => candidate.id === binding.stepId);
  if (!step) return undefined;
  /*
    A portrait or a window is one of a step's options; a story plate is one
    of an ordering step's items. Both read off the adventure definition, so
    the reticle says what the card says, in the card's own words.
  */
  if (step.presentation.kind === 'creative-choice') {
    return step.presentation.options.find((option) => option.id === binding.optionId)?.label;
  }
  if (step.presentation.kind === 'ordering') {
    return step.presentation.items.find((item) => item.id === binding.optionId)?.label;
  }
  return undefined;
}

/**
 * Storykeeper Castle's first-person view
 * (`docs/STORYKEEPER_CASTLE_3D_ROADMAP.md`: SC-2's shell, SC-3's Keeper
 * Quill, SC-4's Character Gallery and Setting Tower, SC-5's hearth,
 * binding lectern and easel). Additive - the card-based castle and the
 * Phaser castle both stay exactly as they are.
 *
 * SC-4 is the phase where a learning step becomes a place, and the shape
 * that makes it honest is that **the session lives here**. Starting the
 * tale no longer navigates away to the card route: this view holds one
 * `useAdventureSession` and both ways of answering go through its single
 * `submitAnswer` - looking at a portrait and pressing E, or pressing the
 * same option on the card below the canvas. They cannot drift, because
 * there is only one of everything: one session, one submit, one
 * `AdventureStepCard` (the very component the card route renders).
 *
 * Nothing about `the-storykeepers-tale` changed to allow this. The room
 * produces an option id through SC-0's bindings and stops; the Adventure
 * Engine still owns correctness and every transition.
 */
export function StorykeeperCastleWorldView({
  childId,
  ageBand,
  aiEnabled,
}: StorykeeperCastleWorldViewProps) {
  const [ready, setReady] = useState(false);
  const [startCheckpointId, setStartCheckpointId] = useState<string | undefined>(undefined);
  const [companionName, setCompanionName] = useState<string | null>(null);
  const [questCue, setQuestCue] = useState<string | null>(null);
  const [backpackItems, setBackpackItems] = useState<readonly WorldHudBackpackItem[]>([]);
  const [interactionContext, setInteractionContext] = useState<WorldInteractionContext>({
    worldChangeKeys: [],
  });
  const [focusedLabel, setFocusedLabel] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [progressUnavailable, setProgressUnavailable] = useState(false);
  const [triggeredInteractionId, setTriggeredInteractionId] = useState<string | null>(null);
  /** Whether the tale is running in this room right now. */
  const [taleActive, setTaleActive] = useState(false);
  const [restoredChoices, setRestoredChoices] = useState<CastleChoiceState>(NO_CHOICES);

  const bus = useMemo(() => new WorldEngineEventBus(), []);
  const engineRef = useRef<StorykeeperCastleEngine | null>(null);

  const storyTold = interactionContext.worldChangeKeys.includes(FIRST_STORY_TOLD_CHANGE_KEY);

  const taleForBand = useMemo(
    () =>
      resolveAdventureForAgeBand(
        THE_STORYKEEPERS_TALE.locationSlug,
        THE_STORYKEEPERS_TALE.slug,
        ageBand,
      ),
    [ageBand],
  );

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [worldState, companion, inventory, questStates, changes, openSession] =
          await Promise.all([
            getWorldState(childId),
            getCompanionProfile(childId),
            getInventory(childId),
            listQuestStates(childId),
            listAllWorldChanges(childId),
            getActiveSession(childId, THE_STORYKEEPERS_TALE.slug),
          ]);
        if (cancelled) return;
        setStartCheckpointId(worldState.lastCheckpointId);
        setCompanionName(companion?.displayName ?? null);
        setBackpackItems(
          inventory.ownedItemIds.flatMap((id) => {
            const item = ALL_ITEMS.find((candidate) => candidate.id === id);
            return item ? [{ id: item.id, displayName: item.displayName }] : [];
          }),
        );
        const activeQuest = questStates.find((state) => state.status === 'ACTIVE');
        setQuestCue(activeQuest ? (getQuestDefinition(activeQuest.questId)?.title ?? null) : null);
        setInteractionContext({
          worldChangeKeys: changes.map((change) => change.changeKey),
          ownedItemIds: inventory.ownedItemIds,
          discoveryIds: worldState.discoveredIds,
        });
        const returning = findCheckpoint(worldState.lastCheckpointId);
        if (returning) {
          setToast(`You are back at ${returning.label}.`);
        }

        /*
          A session left open from an earlier visit resumes in the room the
          child left it in, with their portrait still lit and their window
          still bright. Both are read back from the answers the session
          already recorded - no new persistence, and nothing the client
          could forge into a state the engine never agreed to.
        */
        if (openSession && taleForBand) {
          setTaleActive(true);
          const actions = await listActionsForSessions([openSession.id]);
          if (cancelled) return;
          /*
            The last answer this child gave to a step, excluding ones the
            engine rejected.

            The filter used to be `correctness === 'CORRECT'`, which never
            matched anything it is asked about: `choose-hero` and
            `choose-setting` are `CREATIVE_CHOICE` steps, and a creative
            choice has no right answer, so `validateStepAnswer` grades every
            one of them `not_applicable` and `recordAction` stores
            `NOT_APPLICABLE`. SC-4's whole resume path - walk back into the
            castle and find your portrait still lit - was therefore dead,
            silently, with the session data sitting right there. Found while
            wiring the easel, which reads the same two answers.
          */
          const answerFor = (stepId: string) =>
            actions
              .filter((action) => action.stepId === stepId && action.correctness !== 'INCORRECT')
              .at(-1)?.normalizedAnswer;

          const heroOptionId = answerFor(CHOOSE_HERO_STEP_ID) ?? null;
          const settingOptionId = answerFor(CHOOSE_SETTING_STEP_ID) ?? null;
          setRestoredChoices({
            heroEntityId:
              resolveCastleChoiceEntity(
                THE_STORYKEEPERS_TALE_SLUG,
                CHOOSE_HERO_STEP_ID,
                heroOptionId,
              ) ?? null,
            settingEntityId:
              resolveCastleChoiceEntity(
                THE_STORYKEEPERS_TALE_SLUG,
                CHOOSE_SETTING_STEP_ID,
                settingOptionId,
              ) ?? null,
            heroOptionId,
            settingOptionId,
            /*
              Beat 7 is a REFLECTION step: nothing about it is graded, so
              the only record it leaves is that it was answered at all. A
              child who painted the easel and walked out finds it painted
              when they walk back in, rather than blank again.
            */
            easelPainted: actions.some((action) => action.stepId === STORY_REFLECTION_STEP_ID),
          });
        }
      } catch {
        /*
          None of these reads is load-bearing for walking around: the scene
          spawns at the region's first authored checkpoint without them. So
          a failure here degrades the HUD rather than closing the castle,
          which is the calmer answer for a child who just wants to explore.
        */
        if (!cancelled) setProgressUnavailable(true);
      } finally {
        if (!cancelled) setReady(true);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [childId, taleForBand]);

  const noteCharacterMet = useCallback(
    (npcId: string) => {
      void recordCharacterMet(childId, npcId).catch(() => undefined);
    },
    [childId],
  );
  useNpcApproachBridge(bus, KEEPER_QUILL_ID, noteCharacterMet);

  useEffect(() => {
    const offInteracted = bus.on('ObjectInteracted', ({ entityId }) => {
      if (entityId === KEEPER_QUILL_ID) {
        setTriggeredInteractionId(TALK_TO_QUILL_INTERACTION_ID);
      }
    });
    /*
      Beat 6. A plate leaves the table and rides in front of the camera,
      where the child can see it but the reticle deliberately cannot read it
      - so the HUD says what is in their hands, in the same words the
      ordering card uses for it.
    */
    const offPickedUp = bus.on('CollectiblePickedUp', ({ entityId }) => {
      const label = optionLabelForEntity(entityId);
      if (label) setToast(`You picked up: ${label}`);
    });
    const offFocus = bus.on('InteractableFocused', ({ entityId }) => {
      if (entityId === KEEPER_QUILL_ID) {
        setFocusedLabel(
          findInteraction(STORYKEEPER_CASTLE_INTERACTIONS, TALK_TO_QUILL_INTERACTION_ID)?.title ??
            null,
        );
        return;
      }
      setFocusedLabel(entityId ? (optionLabelForEntity(entityId) ?? null) : null);
    });
    const offZone = bus.on('PlayerEnteredZone', ({ zoneId }) => {
      if (KNOWN_CHECKPOINT_IDS.includes(zoneId)) {
        void saveCheckpoint(childId, zoneId).catch(() => undefined);
        const checkpoint = findCheckpoint(zoneId);
        if (checkpoint) {
          setToast(`You found ${checkpoint.label}.`);
        }
        return;
      }
      if (zoneId === HARBOR_EXIT_ZONE_ID) {
        setTriggeredInteractionId(HARBOR_EXIT_ZONE_ID);
        return;
      }
      if (zoneId === STORY_HALL_ZONE_ID) {
        setTriggeredInteractionId(storyTold ? 'castle-story-hall-told' : 'castle-story-hall');
      }
    });
    /*
      Individual unsubscribes only. `bus.removeAllListeners()` used to be
      called here and is deliberately gone: this effect re-runs whenever
      `storyTold` flips, and clearing the whole bus would silently drop the
      *session's* subscriptions (`CastleTaleSession` below) while it stayed
      mounted, leaving the portraits and windows inert with nothing to show
      for it. The bus is created per mounted view and dies with it.
    */
    return () => {
      offInteracted();
      offPickedUp();
      offFocus();
      offZone();
    };
  }, [bus, childId, storyTold]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), TOAST_DURATION_MS);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  /**
   * Beat 2's gestures. `Talk` while the conversation panel is open, then
   * `Point` toward the north archway when it closes - the castle's only
   * wayfinding, and the reason it is driven from here rather than from the
   * scene: only this component knows when the child is being spoken to.
   */
  const talkingToQuill = triggeredInteractionId === TALK_TO_QUILL_INTERACTION_ID;
  const hasTalkedRef = useRef(false);
  useEffect(() => {
    if (!ready) return;
    if (talkingToQuill) {
      hasTalkedRef.current = true;
      engineRef.current?.playQuillClip('Talk');
    } else if (hasTalkedRef.current) {
      engineRef.current?.playQuillClip('Point');
    }
  }, [ready, talkingToQuill]);

  const reflectChoice = useCallback((stepId: string, optionId: string) => {
    const entityId = resolveCastleChoiceEntity(THE_STORYKEEPERS_TALE_SLUG, stepId, optionId);
    if (!entityId) return;
    if (stepId === CHOOSE_HERO_STEP_ID) {
      engineRef.current?.showChosenHero(entityId);
    } else if (stepId === CHOOSE_SETTING_STEP_ID) {
      engineRef.current?.showChosenSetting(entityId);
    }
  }, []);

  const handleTaleComplete = useCallback(() => {
    void listAllWorldChanges(childId)
      .then((changes) => {
        setInteractionContext((context) => ({
          ...context,
          worldChangeKeys: changes.map((change) => change.changeKey),
        }));
      })
      .catch(() => undefined);
  }, [childId]);

  const triggeredInteraction = triggeredInteractionId
    ? findInteraction(STORYKEEPER_CASTLE_INTERACTIONS, triggeredInteractionId)
    : undefined;

  /**
   * The non-graphical equivalent of everything wired so far, per
   * `docs/LEARNING_ADVENTURE_ISLAND_EXPLORABLE_WORLD_ROADMAP.md` section 42.
   * The two SC-4 steps are not in this list because they have a better
   * equivalent: the step card itself, which is on screen whenever the tale
   * is running.
   */
  const availableInteractions = useMemo(() => {
    const wired = [
      TALK_TO_QUILL_INTERACTION_ID,
      storyTold ? 'castle-story-hall-told' : 'castle-story-hall',
      HARBOR_EXIT_ZONE_ID,
    ];
    return wired.flatMap((id) => {
      const interaction = findInteraction(STORYKEEPER_CASTLE_INTERACTIONS, id);
      return interaction && isInteractionAvailable(interaction, interactionContext)
        ? [interaction]
        : [];
    });
  }, [interactionContext, storyTold]);

  if (!ready) {
    return (
      <div className={styles.wrapper}>
        <p className={styles.status}>Loading Storykeeper Castle...</p>
      </div>
    );
  }

  return (
    <div className={styles.wrapper}>
      <p className={styles.instructions}>
        Move: WASD or the arrow keys. Look: click the screen, then move your mouse (or drag with two
        fingers on a touch screen: left side to move, right side to look). Walk up to Keeper Quill
        and press E, or use the button below, to say hello.
      </p>
      {progressUnavailable ? (
        <p className={styles.status}>
          We could not load your backpack just now. You can still explore the castle.
        </p>
      ) : null}
      <div style={{ position: 'relative' }}>
        <ThreeGameContainer
          instanceKey={childId}
          createEngine={(parent: HTMLDivElement): StorykeeperCastleEngine =>
            createStorykeeperCastleEngine(parent, bus, {
              startCheckpointId,
              chosenHeroEntityId: restoredChoices.heroEntityId,
              chosenSettingEntityId: restoredChoices.settingEntityId,
              paintedHeroOptionId: restoredChoices.easelPainted
                ? restoredChoices.heroOptionId
                : null,
              paintedSettingOptionId: restoredChoices.easelPainted
                ? restoredChoices.settingOptionId
                : null,
            })
          }
          onEngineReady={(engine) => {
            engineRef.current = engine;
          }}
        />
        <WorldHud
          questCue={questCue}
          companionName={companionName}
          focusedLabel={focusedLabel}
          toastMessage={toast}
          backpackItems={backpackItems}
        />
      </div>
      {taleActive && taleForBand ? (
        <CastleTaleSession
          childId={childId}
          ageBand={ageBand}
          aiEnabled={aiEnabled}
          bus={bus}
          engineRef={engineRef}
          restoredChoices={restoredChoices}
          onChoice={reflectChoice}
          onComplete={handleTaleComplete}
          backToMapHref={`/island/${childId}/locations/storykeeper-castle`}
        />
      ) : null}
      {triggeredInteraction ? (
        <InteractionPanel
          childId={childId}
          interaction={triggeredInteraction}
          ageBand={ageBand}
          taleForBand={Boolean(taleForBand)}
          onStartTale={() => {
            setTaleActive(true);
            setTriggeredInteractionId(null);
          }}
          onDismiss={() => setTriggeredInteractionId(null)}
        />
      ) : null}
      <details className={styles.thingsToDo}>
        <summary>Things to do here</summary>
        <ul className={styles.thingsToDoList}>
          {availableInteractions.map((interaction) => (
            <li key={interaction.id}>
              <button
                type="button"
                className={styles.thingsToDoButton}
                onClick={() => setTriggeredInteractionId(interaction.id)}
              >
                {interaction.title}
              </button>
            </li>
          ))}
          <li>
            <button
              type="button"
              className={styles.thingsToDoButton}
              onClick={() => engineRef.current?.interact()}
            >
              Interact with what you're looking at
            </button>
          </li>
        </ul>
      </details>
      <Link className={styles.altNavLink} to={`/island/${childId}/locations/storykeeper-castle`}>
        Prefer not to walk in 3D? Use the location page instead
      </Link>
    </div>
  );
}

interface CastleTaleSessionProps {
  childId: string;
  ageBand: AgeBandValue;
  aiEnabled: boolean;
  bus: WorldEngineEventBus;
  /**
   * The live scene. SC-4's two beats only ever needed to *listen* to the
   * room, so the bus was enough; SC-5's three need to talk back to it -
   * lift the plates, turn Quill toward the mantel, paint the easel - and
   * every one of those is a consequence of session state only this
   * component holds.
   */
  engineRef: React.RefObject<StorykeeperCastleEngine | null>;
  /** What this child already chose in a session left open, so beat 7 knows which picture to paint. */
  restoredChoices: CastleChoiceState;
  /** Called with every creative choice, whichever way it was made, so the room can light up. */
  onChoice: (stepId: string, optionId: string) => void;
  onComplete: () => void;
  backToMapHref: string;
}

/**
 * One in-world play-through of "The Storykeeper's Tale".
 *
 * Holds the session and renders the same `AdventureStepCard` the card route
 * renders. The two SC-4 steps get a second way in - a portrait looked at, a
 * window stood in front of - and both funnel into the identical
 * `submitAnswer`, which is what makes "choosing through the room and
 * choosing through the card produce identical session state" true by
 * construction rather than by two implementations agreeing.
 *
 * A world event is only ever accepted for the step that is open right now.
 * Walking past the tower during `choose-hero` does nothing, and no event
 * can skip the child ahead: the binding must name the current step or it is
 * ignored.
 *
 * SC-5 adds the three beats that need the traffic to run the other way as
 * well, because each is a consequence of session state rather than of the
 * room: Quill points at the mantel from rung 3 of the hint ladder (beat 5),
 * three seated plates become an `ORDERING` answer and lift back off when it
 * is wrong (beat 6), and the easel paints itself when the child reflects
 * (beat 7). Every one of them still reads the engine's verdict rather than
 * forming its own - `resetBindingPlates` runs on `correctness !== 'correct'`
 * as decided server-side (ADR-012), never on anything this file compared.
 */
function CastleTaleSession({
  childId,
  ageBand,
  aiEnabled,
  bus,
  engineRef,
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
  } = useAdventureSession(childId, THE_STORYKEEPERS_TALE, ageBand, aiEnabled);

  const hasFiredOnComplete = useRef(false);
  useEffect(() => {
    if (session?.status === 'COMPLETED' && !hasFiredOnComplete.current) {
      hasFiredOnComplete.current = true;
      onComplete();
    }
  }, [session, onComplete]);

  /**
   * The story so far, as option ids: which hero, which setting. Beat 7's
   * picture is keyed by the pair (`castleEaselCanvas.ts`), and it has to
   * hold whichever way each was chosen - a portrait looked at, or the same
   * option pressed on the card.
   */
  const [choices, setChoices] = useState<{ hero: string | null; setting: string | null }>({
    hero: restoredChoices.heroOptionId,
    setting: restoredChoices.settingOptionId,
  });

  /**
   * The one submit both routes use. Reflecting the choice here rather than
   * at each call site is what makes the card light the portrait too: a
   * child who answers from the card still sees their hero lit when they
   * walk into the gallery afterwards.
   */
  const stepId = currentStep?.id ?? null;
  const submitAnswerAndReflect = useCallback(
    async (answer: StepAnswer) => {
      if (answer.kind === 'creative-choice' && stepId) {
        onChoice(stepId, answer.optionId);
        if (stepId === CHOOSE_HERO_STEP_ID) {
          setChoices((prev) => ({ ...prev, hero: answer.optionId }));
        } else if (stepId === CHOOSE_SETTING_STEP_ID) {
          setChoices((prev) => ({ ...prev, setting: answer.optionId }));
        }
      }
      /*
        Beat 7. The easel fills as the child says they have pictured their
        story, not after some later step - the reflection *is* the picture,
        and painting it here means a child standing in the studio watches
        the page fill while one who is elsewhere finds it painted when they
        walk in. Nothing is graded (`REFLECTION` is `not_applicable`), so
        this is presentation reacting to a step, never a step outcome.
      */
      if (answer.kind === 'reflection' && stepId === STORY_REFLECTION_STEP_ID) {
        engineRef.current?.showEaselPainting(choices.hero, choices.setting);
      }
      return submitAnswer(answer);
    },
    [submitAnswer, stepId, onChoice, engineRef, choices],
  );

  const submitRef = useRef(submitAnswerAndReflect);
  submitRef.current = submitAnswerAndReflect;

  /**
   * Beat 5's physical hint. Quill turns and points at the hearth mantel
   * from rung 3 of the *existing* ladder onward, and turns back to the hall
   * when the check is answered.
   *
   * This reads `hintLevel`; it never writes one. The rung the child is on,
   * when it advances, and what each rung says all stay exactly where they
   * were, in `theStorykeepersTale.ts` and `useAdventureSession`.
   */
  const pointingAtMantel =
    stepId === COMPREHENSION_CHECK_STEP_ID && hintLevel >= QUILL_POINTS_AT_MANTEL_FROM_RUNG;
  const wasPointingAtMantel = useRef(false);
  useEffect(() => {
    if (pointingAtMantel) {
      engineRef.current?.playQuillClip('Point', 'hearth');
    } else if (wasPointingAtMantel.current) {
      engineRef.current?.playQuillClip('Idle');
    }
    wasPointingAtMantel.current = pointingAtMantel;
  }, [pointingAtMantel, engineRef]);

  /**
   * Beat 6. The lectern always works as furniture - a child can pick a
   * plate up and put it down whenever they like - so the step starts by
   * clearing whatever they were playing with, and every arrangement the
   * room reports outside this step is ignored.
   */
  const orderingStepOpen = stepId === ORDER_THE_STORY_STEP_ID;
  useEffect(() => {
    if (!orderingStepOpen) return;
    engineRef.current?.resetBindingPlates();
  }, [orderingStepOpen, engineRef]);

  useEffect(() => {
    if (!orderingStepOpen) return;
    return bus.on('BuildActionRequested', ({ entityId, order }) => {
      if (entityId !== BINDING_LECTERN_ENTITY_ID) return;
      const answer = seatedPlatesToOrder(order ?? []);
      if (!answer) return;
      void submitRef.current({ kind: 'ordering', order: answer }).then((correctness) => {
        /*
          Beat 6's promise on a wrong order: the plates lift back out and
          settle on the table, Quill looks concerned, and nothing is lost.
          The child picks up again from exactly where they started, with
          the hint ladder one rung further along - which the engine has
          already advanced, because this went through the same
          `submitAnswer` the HUD list goes through.
        */
        if (correctness === 'correct') return;
        engineRef.current?.resetBindingPlates();
        engineRef.current?.playQuillClip('ReactConcerned');
      });
    });
  }, [bus, orderingStepOpen, engineRef]);

  useEffect(() => {
    if (!stepId || !SPATIAL_STEP_IDS.includes(stepId)) return;

    const answerWith = (entityId: string) => {
      const binding = resolveCastleChoiceBinding(entityId);
      if (!binding) return;
      if (binding.templateSlug !== THE_STORYKEEPERS_TALE_SLUG) return;
      if (binding.stepId !== stepId) return;
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
  }, [bus, stepId]);

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

interface InteractionPanelProps {
  childId: string;
  interaction: WorldInteraction;
  ageBand: AgeBandValue;
  /** Whether the tale is authored for this child's band at all. */
  taleForBand: boolean;
  onStartTale: () => void;
  onDismiss: () => void;
}

function InteractionPanel({
  childId,
  interaction,
  ageBand,
  taleForBand,
  onStartTale,
  onDismiss,
}: InteractionPanelProps) {
  return (
    <div className={styles.panel} role="dialog" aria-label={interaction.title}>
      <h2 className={styles.panelTitle}>{interaction.title}</h2>
      <div className={styles.panelActions}>
        <InteractionPanelAction
          childId={childId}
          action={interaction.action}
          ageBand={ageBand}
          taleForBand={taleForBand}
          onStartTale={onStartTale}
          onDismiss={onDismiss}
        />
        <button type="button" className={styles.dismissButton} onClick={onDismiss}>
          Not now
        </button>
      </div>
    </div>
  );
}

interface InteractionPanelActionProps {
  childId: string;
  action: WorldAction;
  ageBand: AgeBandValue;
  taleForBand: boolean;
  onStartTale: () => void;
  onDismiss: () => void;
}

/**
 * Resolves one `WorldAction` into UI. Only the kinds the castle actually
 * wires are handled; `DISCOVER` arrives with the two secrets in SC-7.
 *
 * `START_ADVENTURE` is the one that behaves differently here from the bay:
 * it opens the tale *in this room* rather than navigating to the card
 * route, because in the castle the room is how two of its steps are
 * answered. Walking out of the castle to answer them would defeat the
 * phase.
 */
function InteractionPanelAction({
  childId,
  action,
  ageBand,
  taleForBand,
  onStartTale,
  onDismiss,
}: InteractionPanelActionProps) {
  if (action.kind === 'NAVIGATE') {
    return (
      <Link className={styles.goLink} to={`/island/${childId}/${action.to}`}>
        Go there
      </Link>
    );
  }

  if (action.kind === 'SHOW_MESSAGE') {
    return <p>{action.message}</p>;
  }

  if (action.kind === 'TALK_TO') {
    return (
      <NpcConversation childId={childId} npcId={action.npcId} ageBand={ageBand} onEnd={onDismiss} />
    );
  }

  if (action.kind !== 'START_ADVENTURE') {
    return null;
  }

  if (!taleForBand) {
    return <p>This adventure is not available for your age yet.</p>;
  }

  return (
    <button type="button" className={styles.goLink} onClick={onStartTale}>
      Start the adventure
    </button>
  );
}
