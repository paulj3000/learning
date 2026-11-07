import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import type { AnswerOutcome, PickupOutcome, TalkOutcome } from '../../../../../api/play/types';
import { prefersReducedMotion } from '../../../../../lib/motionPreference';
import { useAuth } from '../../../../auth/AuthContext';
import type { PlayOutcome } from '../../../../npc-manager/dialogue/triggers';
import {
  useNpcSceneHost,
  type NpcSceneHost,
  type NpcSoundMoment,
} from '../../../../npc-manager/host';
import { tryParseRegionPlayConfig } from '../../../../region-play/regionPlayConfig';
import {
  chestStateChanges,
  resolveRegionPlayInteraction,
} from '../../../../region-play/regionPlayInteractions';
import {
  PLAY_COPY,
  completedQuests,
  launchErrorMessage,
  nextStepHint,
  objectiveCue,
  playErrorMessage,
  questObjective,
  shouldCelebrate,
} from '../../../../region-play/regionPlayUi';
import { adventurePath, useAdventureLaunch } from '../../../../region-play/useAdventureLaunch';
import { usePlayerProgress } from '../../../../region-play/usePlayerProgress';
import {
  hasSceneAudio,
  useTreasureRushAudio,
} from '../../../../region-play/audio/useTreasureRushAudio';
import { playCue, type SoundCue } from '../../../../region-play/soundCues';
import { useRegionPlay } from '../../../../region-play/useRegionPlay';
import type { LocationCompanionProps } from '../../runtime/viewExtensionRegistry';
import type { RegionPlaySceneApi } from './regionPlayScene';
import { BackpackPanel } from './ui/BackpackPanel';
import { ChestChallengePanel, type ChestPanelPhase } from './ui/ChestChallengePanel';
import { LaunchDialog } from './ui/LaunchDialog';
import { PipDialog } from './ui/PipDialog';
import { ReplayDonePanel } from './ui/ReplayDonePanel';
import { RewardReveal } from './ui/RewardReveal';
import { SoundPanel } from './ui/SoundPanel';
import styles from './ui/RegionPlayPanels.module.css';

/**
 * The React half of `region-play`, mounted for the whole visit (TR-7, with
 * the TR-8 game UI).
 *
 * - Starts or resumes the child's session once the region is loaded and
 *   completes it at the calm stop. It never accepts a quest: Pip offers it
 *   and the child chooses (TR-D11).
 * - Keeps the chests in the scene matching the server, so a chest opens in
 *   the cove only after the play API says so.
 * - Opens Pip's dialogue or the chest's lock for a claimed interaction,
 *   asks the server for the chest's challenge, sends the child's answer,
 *   and shows the reward reveal once, for a correct answer the server
 *   confirmed for an attempt submitted in this visit.
 * - Offers the backpack: the child's items and quests from `GET progress/`.
 * - Shows the objective in the HUD ("Treasure Rush: 1 of 4") and a hint on
 *   request (TR-12), both from the server's quest and chest state.
 * - Pip's Missing Treasure (TR-14): keeps each chest's lock and the key in
 *   the scene matching the server; picks the key up through the play API;
 *   shows the server's numbers on the rune stones while the ruins puzzle is
 *   out and answers it with the stone the child touches (the server grades
 *   it); and tells the server each time the child talks to Pip, whose reply
 *   may complete the quest and bring the finale.
 * - Lookout Point (TR-17): when the server's world changes include the quest's completion, tells
 *   the scene to open the gate and lay the bridge (it already knows on a later visit, from the
 *   build). Whether the spyglass beyond may be used is the server's lock, not this file's.
 * - The spyglass (TR-20) is a replay activity: a right answer shows a kind note instead of a
 *   chest or a reward, and "Play again" asks the server for a fresh challenge.
 * - Pip reacts (TR-18) and the rune stones show the verdict (TR-16), as presentation only; each
 *   moment also raises a sound cue (TR-19), silent until a player is registered.
 * - Begins an Adventure from an object that offers one (ADR-041): the server
 *   checks and starts it, then the child goes to the Adventure with a way
 *   back to this 3D Area.
 * - NPC Manager (LAI-NPC-010, -015, -016): the NPC scene host serves this 3D Area's published
 *   NPCs. When it serves Pip, the manifest Pip is handed over (hidden, its root following the
 *   managed Pip so focus and taps still reach him) and `PipDialog` is not used: talking runs the
 *   published dialogue, after the same "talked" call the play API always had, and Pip's
 *   `OFFER_QUEST` choice accepts through the same quest flow. Every play outcome also goes to the
 *   host as NPC triggers and reactions; rewards and progress are untouched. When the host serves
 *   nothing (no release, Django off, a failed load), the legacy Pip and `PipDialog` stay exactly
 *   as before, so the adventure is never blocked.
 *
 * Remounted per child and region (`key`), so a switch starts from nothing.
 */
export function RegionPlayCompanion(props: LocationCompanionProps) {
  return <RegionPlayGame key={`${props.childId}/${props.regionId}`} {...props} />;
}

function RegionPlayGame(props: LocationCompanionProps) {
  const {
    childId,
    regionId,
    config,
    sceneApi,
    claimedInteraction,
    limitReached,
    onCloseInteraction,
    setQuestCue,
    hudSlot,
    speechSlot,
    showToast,
    bus,
  } = props;
  // Sound (SM-P3): registered first so every moment below finds its player. Silent without audio.
  const audio = useTreasureRushAudio({
    childId,
    regionId,
    bus,
    scene: hasSceneAudio(sceneApi) ? sceneApi : null,
  });
  const auth = useAuth();
  const onUnauthenticated = () => void auth.refresh();
  const parsed = useMemo(() => tryParseRegionPlayConfig(config), [config]);
  // LAI-NPC-016: play outcomes go to the NPC scene host (wired below, once it exists).
  const playOutcomeRef = useRef<((outcome: PlayOutcome) => void) | null>(null);
  const onOutcome = useCallback((outcome: PlayOutcome) => playOutcomeRef.current?.(outcome), []);
  const controls = useRegionPlay(childId, regionId, { onUnauthenticated, onOutcome });
  const progress = usePlayerProgress(childId, { onUnauthenticated });
  const {
    state,
    startSession,
    changeSession,
    acceptQuest,
    requestChallenge,
    submitAnswer,
    collectPickup,
    talkToNpc,
  } = controls;
  const refreshProgress = progress.refresh;
  const navigate = useNavigate();
  const launcher = useAdventureLaunch(childId, regionId);

  const [backpackOpen, setBackpackOpen] = useState(false);
  const [soundOpen, setSoundOpen] = useState(false);
  const [hintOpen, setHintOpen] = useState(false);
  const [celebration, setCelebration] = useState<AnswerOutcome | null>(null);
  const [found, setFound] = useState<PickupOutcome | null>(null);
  /** The replay activity (TR-20) the child just got right, until they play again or close. */
  const [replayWon, setReplayWon] = useState<string | null>(null);
  const [finale, setFinale] = useState<TalkOutcome | null>(null);
  /** The chest each submitted attempt was for, so a puzzle's outcome is told apart (TR-14). */
  const submittedTargets = useRef(new Map<string, string>());
  const handledFor = useRef<unknown>(null);
  const [acceptedHere, setAcceptedHere] = useState<string | null>(null);
  const submittedAttempt = useRef<string | null>(null);
  const celebrated = useRef(new Set<string>());
  const autoRequestedFor = useRef<unknown>(null);

  // Enter: start or resume once, after the region loads.
  const startedOnce = useRef(false);
  useEffect(() => {
    if (state.status !== 'ready' || state.session || startedOnce.current) return;
    startedOnce.current = true;
    void startSession();
  }, [startSession, state.session, state.status]);

  // The calm stop ends the session; the room stays as it is.
  const sessionStatus = state.session?.status;
  useEffect(() => {
    if (limitReached && sessionStatus) void changeSession('complete');
  }, [changeSession, limitReached, sessionStatus]);

  // The objective, from the server's quests: the HUD cue now, the hint when asked.
  const bootstrap = state.bootstrap;
  const objective = useMemo(() => {
    if (!bootstrap) return null;
    const giverName = (npcId: string | null) =>
      bootstrap.npcs.find((npc) => npc.npcId === npcId)?.label ?? PLAY_COPY.defaultGiver;
    return questObjective(bootstrap.quests, giverName);
  }, [bootstrap]);
  const cue = objective ? objectiveCue(objective) : null;
  useEffect(() => {
    setQuestCue?.(cue);
  }, [cue, setQuestCue]);
  useEffect(() => () => setQuestCue?.(null), [setQuestCue]);

  // Chest appearance follows the server, never the interaction or the answer.
  const chests = state.bootstrap?.chests;
  useEffect(() => {
    const api = sceneApi as RegionPlaySceneApi | null;
    if (!api || !chests) return;
    const drawn = new Map<string, boolean>();
    for (const chest of chests) {
      const open = api.isChestOpen(chest.entityId);
      if (open !== undefined) drawn.set(chest.entityId, open);
    }
    for (const change of chestStateChanges(
      drawn,
      chests.filter((c) => drawn.has(c.entityId)),
    )) {
      api.setChestOpen(change.entityId, change.isOpen);
    }
  }, [chests, sceneApi]);

  // TR-17: the way to Lookout Point opens when the server's world changes say the quest is done.
  const unlockKey = parsed?.unlock?.changeKey;
  const locationSlug = bootstrap?.region.locationSlug;
  const unlockedByServer = Boolean(
    unlockKey &&
    bootstrap?.worldChanges.some(
      (change) => change.changeKey === unlockKey && change.locationSlug === locationSlug,
    ),
  );
  useEffect(() => {
    const api = sceneApi as RegionPlaySceneApi | null;
    if (!api?.setUnlocked || !unlockedByServer) return;
    // True only on the visit that completes the quest; a later visit is built open already.
    if (api.setUnlocked(true)) {
      playCue('bridgeOpen', { unlock: true });
      showToast(PLAY_COPY.bridgeOpened);
    }
  }, [unlockedByServer, sceneApi, showToast]);

  // TR-18: Pip and every other character reacts to a find, as presentation only. An NPC the
  // NPC Manager draws reacts through the host instead (its `react` commands).
  const managedRef = useRef<ReadonlySet<string>>(new Set());
  const npcs = bootstrap?.npcs;
  const react = useCallback(
    (reaction: 'talk' | 'cheer') => {
      const api = sceneApi as RegionPlaySceneApi | null;
      for (const npc of npcs ?? []) {
        if (!managedRef.current.has(npc.npcId)) api?.reactNpc?.(npc.entityId, reaction);
      }
    },
    [npcs, sceneApi],
  );

  // TR-14: locks and pickups in the scene follow the server, like chest lids.
  const objects = state.bootstrap?.objects;
  useEffect(() => {
    const api = sceneApi as RegionPlaySceneApi | null;
    if (!api) return;
    for (const chest of chests ?? []) {
      api.setChestLock?.(chest.entityId, chest.isOpen ? null : chest.lockReason);
    }
    for (const object of objects ?? []) {
      if (object.pickup && object.collected) api.setPickupCollected?.(object.entityId);
    }
  }, [chests, objects, sceneApi]);

  // TR-14: the rune stones show the outstanding puzzle's choices, one per stone, in order.
  const puzzleIds = useMemo(
    () => new Set((chests ?? []).filter((c) => c.presentation === 'PUZZLE').map((c) => c.entityId)),
    [chests],
  );
  const replayIds = useMemo(
    () => new Set((chests ?? []).filter((c) => c.presentation === 'REPLAY').map((c) => c.entityId)),
    [chests],
  );
  const outstanding = state.challenge;
  const puzzleOut = Boolean(outstanding && puzzleIds.has(outstanding.targetEntityId));
  const setPuzzleMusic = audio.setPuzzleActive;
  useEffect(() => setPuzzleMusic(puzzleOut), [puzzleOut, setPuzzleMusic]);
  useEffect(() => {
    const api = sceneApi as RegionPlaySceneApi | null;
    if (!api?.setRuneNumbers) return;
    const puzzle =
      outstanding && puzzleIds.has(outstanding.targetEntityId)
        ? chests?.find((c) => c.entityId === outstanding.targetEntityId)
        : undefined;
    if (!puzzle || !outstanding) {
      api.setRuneNumbers(null);
      return;
    }
    const numbers = new Map<string, number>();
    puzzle.answerEntityIds.forEach((entityId, index) => {
      const choice = outstanding.challenge.choices[index];
      if (choice !== undefined) numbers.set(entityId, choice);
    });
    api.setRuneNumbers(numbers);
  }, [outstanding, puzzleIds, chests, sceneApi]);

  // The reward reveal: once per attempt, only for a server-confirmed correct answer sent here.
  // A puzzle is not a chest: it says so in the HUD, and a wrong stone brings new numbers.
  useEffect(() => {
    const outcome = state.lastOutcome;
    if (!outcome || outcome.attemptId !== submittedAttempt.current) return;
    if (celebrated.current.has(outcome.attemptId)) return;
    const target = submittedTargets.current.get(outcome.attemptId);
    if (target && puzzleIds.has(target)) {
      celebrated.current.add(outcome.attemptId);
      const api = sceneApi as RegionPlaySceneApi | null;
      api?.flashRunes?.(outcome.correct);
      if (outcome.correct) {
        playCue('stoneRight');
        showToast(PLAY_COPY.puzzleSolved);
      } else {
        playCue('stoneWrong');
        showToast(PLAY_COPY.puzzleWrong);
        void requestChallenge(target);
      }
      return;
    }
    if (target && replayIds.has(target)) {
      // TR-20: practice. A right answer is a kind note, never a reveal; a wrong one is the
      // chest panel's "try again", which asks for a new challenge.
      celebrated.current.add(outcome.attemptId);
      if (outcome.correct) {
        playCue('replayWin');
        react('cheer');
        setReplayWon(target);
        void refreshProgress();
      } else {
        playCue('answerRetry');
      }
      return;
    }
    if (!outcome.correct) {
      // A wrong chest answer: a gentle "try again" sound, once for this attempt.
      celebrated.current.add(outcome.attemptId);
      playCue('answerRetry');
      return;
    }
    if (!shouldCelebrate(outcome, submittedAttempt.current, celebrated.current)) return;
    celebrated.current.add(outcome.attemptId);
    playCue('answerRight');
    playCue(
      outcome.chestOpened ? 'chestOpen' : 'celebrate',
      target ? { entityId: target } : undefined,
    );
    if (completedQuests(outcome, state.bootstrap?.quests ?? []).length > 0)
      playCue('questComplete');
    react('cheer');
    setCelebration(outcome);
    void refreshProgress();
  }, [
    state.lastOutcome,
    state.bootstrap?.quests,
    refreshProgress,
    puzzleIds,
    replayIds,
    showToast,
    requestChallenge,
    sceneApi,
    react,
  ]);

  // TR-14: what the server said about a pickup and a talk made here. Each outcome is revealed
  // once: `react` and `refreshProgress` change with every new bootstrap, which re-runs these.
  const lastPickup = state.lastPickup;
  const revealedPickup = useRef<PickupOutcome | null>(null);
  useEffect(() => {
    if (!lastPickup || revealedPickup.current === lastPickup) return;
    revealedPickup.current = lastPickup;
    if (lastPickup.pickedUp && lastPickup.newItems.length > 0) {
      playCue('keyPickup', { entityId: lastPickup.entityId });
      react('cheer');
      setFound(lastPickup);
      void refreshProgress();
    }
  }, [lastPickup, refreshProgress, react]);
  const lastTalk = state.lastTalk;
  const revealedTalk = useRef<TalkOutcome | null>(null);
  useEffect(() => {
    if (!lastTalk || revealedTalk.current === lastTalk) return;
    revealedTalk.current = lastTalk;
    if (lastTalk.questUpdates.some((update) => update.justCompleted)) {
      playCue('questComplete');
      react('cheer');
      setFinale(lastTalk);
      void refreshProgress();
    }
  }, [lastTalk, refreshProgress, react]);

  const event =
    parsed && claimedInteraction && state.bootstrap
      ? resolveRegionPlayInteraction(
          parsed,
          state.bootstrap,
          claimedInteraction.id,
          state.session !== null,
        )
      : null;

  // --- NPC Manager (LAI-NPC-010, -015, -016) ---------------------------------------------
  const npcScene = useMemo(
    () => (sceneApi as RegionPlaySceneApi | null)?.npcHostScene?.() ?? null,
    [sceneApi],
  );
  const bootstrapRef = useRef(bootstrap);
  bootstrapRef.current = bootstrap;
  const onNpcInteract = useCallback(
    async (npcId: string) => {
      // The same "talked" call the legacy Pip made (it may finish the quest and bring the
      // finale), before the conversation, so the line matches the quest's new state.
      const entity = bootstrapRef.current?.npcs.find((npc) => npc.npcId === npcId);
      if (entity) await talkToNpc(entity.entityId);
    },
    [talkToNpc],
  );
  const onQuestOffer = useCallback(
    (questId: string) => {
      // The child's own tap on "Yes, I will help!", through the existing accept flow.
      const quest = bootstrapRef.current?.quests.find((q) => q.questId === questId);
      if (quest?.status !== 'AVAILABLE') return;
      setAcceptedHere(questId);
      void acceptQuest(questId);
    },
    [acceptQuest],
  );
  const onNpcSound = useCallback((moment: NpcSoundMoment, npcId: string) => {
    playCue(NPC_SOUND_CUES[moment], { npcId });
  }, []);
  const npcHost: NpcSceneHost = useNpcSceneHost({
    childId,
    scope: { kind: 'area', regionId },
    scene: npcScene,
    reducedMotion: prefersReducedMotion(),
    suspended: Boolean(
      finale || found || celebration || soundOpen || backpackOpen || event !== null,
    ),
    onInteract: onNpcInteract,
    onQuestOffer,
    onSound: onNpcSound,
    // Unprompted lines sit at the top of the stage, so they stay in full screen and never
    // cover the HUD or the reticle's action prompt (F-B).
    ambientLayout: speechSlot ? 'inline' : 'floating',
  });
  const { managedNpcIds, notifyPlay } = npcHost;
  managedRef.current = managedNpcIds;
  const hostRef = useRef(npcHost);
  hostRef.current = npcHost;

  // Every play outcome becomes NPC triggers and reactions. The calm stop's session completion
  // is not the adventure's completion, so it is left out; completion comes from world changes.
  useEffect(() => {
    playOutcomeRef.current = (outcome) => {
      if (outcome.kind !== 'session_changed') notifyPlay(outcome);
    };
    return () => {
      playOutcomeRef.current = null;
    };
  }, [notifyPlay]);
  const seenChanges = useRef<Set<string> | null>(null);
  const worldChanges = bootstrap?.worldChanges;
  useEffect(() => {
    if (!worldChanges) return;
    const keyOf = (change: { locationSlug: string; changeKey: string }) =>
      `${change.locationSlug}:${change.changeKey}`;
    if (seenChanges.current === null) {
      seenChanges.current = new Set(worldChanges.map(keyOf));
      return;
    }
    const added = worldChanges.filter((change) => !seenChanges.current?.has(keyOf(change)));
    for (const change of added) seenChanges.current.add(keyOf(change));
    if (added.length > 0) notifyPlay({ kind: 'world_changes', added });
  }, [worldChanges, notifyPlay]);

  // Exactly one Pip: a manifest NPC the host serves is handed over to it.
  useEffect(() => {
    const api = sceneApi as RegionPlaySceneApi | null;
    if (!api?.setNpcProxy || !npcs) return undefined;
    const handed: string[] = [];
    for (const npc of npcs) {
      if (managedNpcIds.has(npc.npcId)) {
        api.setNpcProxy(npc.entityId, () => hostRef.current.positionOf(npc.npcId));
        handed.push(npc.entityId);
      }
    }
    return () => {
      for (const entityId of handed) api.setNpcProxy?.(entityId, null);
    };
  }, [sceneApi, npcs, managedNpcIds]);

  const chestEntity = event?.kind === 'chest' ? event.entityId : null;
  const challenge =
    chestEntity && state.challenge?.targetEntityId === chestEntity ? state.challenge : null;
  const lastOutcome = state.lastOutcome;
  const wrong =
    !challenge &&
    lastOutcome !== null &&
    !lastOutcome.correct &&
    lastOutcome.attemptId === submittedAttempt.current;

  // TR-14: talking to an NPC, picking something up, or touching a rune stone is sent once per
  // time the child does it; the server decides what it means.
  useEffect(() => {
    if (!event || !claimedInteraction || handledFor.current === claimedInteraction) return;
    if (event.kind === 'npc' && managedNpcIds.has(event.npcId)) {
      // The NPC Manager's Pip: the host runs the talk call and the conversation.
      handledFor.current = claimedInteraction;
      hostRef.current.interact(event.npcId, 'pointer');
      onCloseInteraction();
    } else if (event.kind === 'npc') {
      handledFor.current = claimedInteraction;
      (sceneApi as RegionPlaySceneApi | null)?.reactNpc?.(event.entityId, 'talk');
      void talkToNpc(event.entityId);
    } else if (event.kind === 'pickup') {
      handledFor.current = claimedInteraction;
      void collectPickup(event.entityId).then(() => onCloseInteraction());
    } else if (event.kind === 'rune') {
      handledFor.current = claimedInteraction;
      (sceneApi as RegionPlaySceneApi | null)?.pressRune?.(event.entityId);
      const puzzle = state.challenge;
      if (puzzle && puzzle.targetEntityId === event.puzzleEntityId && !state.busy) {
        const choice = puzzle.challenge.choices[event.index];
        if (choice !== undefined) {
          submittedAttempt.current = puzzle.attemptId;
          submittedTargets.current.set(puzzle.attemptId, puzzle.targetEntityId);
          void submitAnswer({ answer: choice, hintLevel: 0 });
        }
      } else {
        showToast(PLAY_COPY.puzzleFirst);
      }
      onCloseInteraction();
    }
  }, [
    event,
    claimedInteraction,
    talkToNpc,
    collectPickup,
    submitAnswer,
    onCloseInteraction,
    showToast,
    state.challenge,
    state.busy,
    sceneApi,
    managedNpcIds,
  ]);

  // The same interaction is claimed again on the next touch, so "once" lasts until it closes.
  useEffect(() => {
    if (!claimedInteraction) handledFor.current = null;
  }, [claimedInteraction]);

  // Opening an unopened chest asks the server for its challenge, once per time it is opened.
  useEffect(() => {
    if (event?.kind !== 'chest' || !event.canRequestChallenge || challenge || wrong) return;
    if (state.busy || autoRequestedFor.current === claimedInteraction) return;
    autoRequestedFor.current = claimedInteraction;
    void requestChallenge(event.entityId);
  }, [event, challenge, wrong, state.busy, claimedInteraction, requestChallenge]);

  function closeInteraction() {
    autoRequestedFor.current = null;
    setReplayWon(null);
    handledFor.current = null;
    onCloseInteraction();
  }

  function submit(answer: number, hintLevel: number) {
    if (!challenge || state.busy) return;
    submittedAttempt.current = challenge.attemptId;
    submittedTargets.current.set(challenge.attemptId, challenge.targetEntityId);
    void submitAnswer({ answer, hintLevel });
  }

  async function launch(launchId: string) {
    const started = await launcher.start(launchId);
    if (started) navigate(adventurePath(childId, started));
  }

  const launchError = launchErrorMessage(launcher.error);

  function accept(questId: string) {
    if (state.busy) return;
    setAcceptedHere(questId);
    void acceptQuest(questId);
  }

  const errorMessage = playErrorMessage(state.error);

  const nextClue =
    state.bootstrap?.chests.find((c) => !c.isOpen && c.lockReason !== 'PROGRESS')?.clue ?? null;

  let panel = null;
  if (finale) {
    panel = (
      <RewardReveal
        title={PLAY_COPY.finaleTitle}
        lead={PLAY_COPY.finaleThanks}
        outcome={{ newItems: [], rewardMessage: null, completionRewards: finale.completionRewards }}
        completed={(state.bootstrap?.quests ?? []).filter((quest) =>
          finale.questUpdates.some((u) => u.justCompleted && u.questId === quest.questId),
        )}
        onClose={() => {
          setFinale(null);
          closeInteraction();
        }}
      />
    );
  } else if (found) {
    panel = (
      <RewardReveal
        title={PLAY_COPY.youPickedUp}
        outcome={found}
        completed={[]}
        onClose={() => setFound(null)}
      />
    );
  } else if (celebration) {
    panel = (
      <RewardReveal
        outcome={celebration}
        completed={completedQuests(celebration, state.bootstrap?.quests ?? [])}
        onClose={() => {
          setCelebration(null);
          closeInteraction();
        }}
      />
    );
  } else if (event?.kind === 'npc' && !managedNpcIds.has(event.npcId)) {
    panel = (
      <PipDialog
        name={event.label}
        quests={event.quests}
        accepting={state.busy === 'acceptQuest'}
        justAccepted={event.quests.some((q) => q.questId === acceptedHere && q.status === 'ACTIVE')}
        error={state.errorAction === 'acceptQuest' ? errorMessage : null}
        onAccept={accept}
        onClose={closeInteraction}
        clue={nextClue}
        launches={event.launches}
        launchStarting={launcher.starting}
        launchError={launchError}
        onLaunch={(launchId) => void launch(launchId)}
      />
    );
  } else if (event?.kind === 'launch') {
    panel = (
      <LaunchDialog
        label={event.label}
        launches={event.launches}
        starting={launcher.starting}
        error={launchError}
        onStart={(launchId) => void launch(launchId)}
        onClose={closeInteraction}
      />
    );
  } else if (replayWon && event?.kind === 'chest' && event.entityId === replayWon) {
    panel = (
      <ReplayDonePanel
        label={event.label}
        busy={state.busy === 'requestChallenge'}
        onAgain={() => {
          setReplayWon(null);
          void requestChallenge(event.entityId);
        }}
        onClose={closeInteraction}
      />
    );
  } else if (event?.kind === 'chest') {
    let phase: ChestPanelPhase;
    if (event.isOpen) phase = { kind: 'open' };
    else if (!event.challengeAvailable) phase = { kind: 'not-ready' };
    else if (event.lockReason) {
      const clue = state.bootstrap?.chests.find((c) => c.entityId === event.entityId)?.clue ?? '';
      phase = { kind: 'locked', reason: event.lockReason, clue };
    } else if (challenge)
      phase = { kind: 'answering', challenge, submitting: state.busy === 'submitAnswer' };
    else if (wrong) phase = { kind: 'wrong' };
    else if (state.busy === 'requestChallenge') phase = { kind: 'requesting' };
    else phase = { kind: 'waiting' };
    const chestError =
      state.errorAction === 'requestChallenge' || state.errorAction === 'submitAnswer'
        ? errorMessage
        : null;
    panel = (
      <ChestChallengePanel
        label={event.label}
        phase={phase}
        error={chestError}
        onSubmit={submit}
        onTryAgain={() => void requestChallenge(event.entityId)}
        onClose={closeInteraction}
        puzzle={event.presentation === 'PUZZLE'}
      />
    );
  } else if (soundOpen) {
    panel = <SoundPanel onClose={() => setSoundOpen(false)} />;
  } else if (backpackOpen) {
    panel = <BackpackPanel progress={progress} onClose={() => setBackpackOpen(false)} />;
  } else if (npcHost.panel) {
    panel = npcHost.panel;
  }

  const itemCount = progress.progress?.inventory.length ?? 0;
  // On the stage when the view offers a slot (so they stay in full screen), fixed to the page otherwise.
  const onStage = Boolean(hudSlot);
  const ambient = panel ? null : npcHost.ambient;
  const hudControls = panel ? null : (
    <>
      {npcHost.prompt}
      {hintOpen ? (
        <div className={onStage ? styles.stageHintBubble : styles.hintBubble} role="status">
          <p>{nextStepHint(objective, bootstrap?.chests ?? [])}</p>
          <button type="button" className={styles.hintClose} onClick={() => setHintOpen(false)}>
            {PLAY_COPY.hintClose}
          </button>
        </div>
      ) : null}
      <button
        type="button"
        className={onStage ? styles.stageHintButton : styles.hintButton}
        aria-expanded={hintOpen}
        onClick={() => setHintOpen((open) => !open)}
      >
        {PLAY_COPY.hint}
      </button>
      <button
        type="button"
        className={onStage ? styles.stageHintButton : styles.soundButton}
        onClick={() => setSoundOpen(true)}
      >
        {PLAY_COPY.sound}
      </button>
      <button
        type="button"
        className={onStage ? styles.stageBackpackButton : styles.backpackButton}
        onClick={() => {
          setBackpackOpen(true);
          void progress.refresh();
        }}
      >
        {PLAY_COPY.backpack}
        {itemCount > 0 ? <span className={styles.count}>{itemCount}</span> : null}
      </button>
    </>
  );
  return (
    <>
      {panel}
      {hudControls && hudSlot ? createPortal(hudControls, hudSlot) : hudControls}
      {ambient && speechSlot ? createPortal(ambient, speechSlot) : ambient}
    </>
  );
}

/** LAI-NPC-015: the Sound Manager's NPC events as Treasure Rush sound moments. */
const NPC_SOUND_CUES: Readonly<Record<NpcSoundMoment, SoundCue>> = {
  on_approach: 'npcGreet',
  on_interact: 'npcInteract',
  on_dialogue_start: 'npcTalk',
  on_exit: 'npcLeave',
};
