import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { JsonObject } from '../../../../../api/parse';
import type { AnswerOutcome } from '../../../../../api/play/types';
import { AREA_COPY, asRevealOutcome, currentPuzzle } from '../../../../region-play/areaPuzzleUi';
import { parsePuzzleParams } from '../../../../region-play/areaPuzzles';
import { useAuth } from '../../../../auth/AuthContext';
import { tryParseRegionPlayConfig } from '../../../../region-play/regionPlayConfig';
import {
  chestStateChanges,
  resolveRegionPlayInteraction,
} from '../../../../region-play/regionPlayInteractions';
import {
  PLAY_COPY,
  completedQuests,
  launchErrorMessage,
  playErrorMessage,
  shouldCelebrate,
} from '../../../../region-play/regionPlayUi';
import { adventurePath, useAdventureLaunch } from '../../../../region-play/useAdventureLaunch';
import { usePlayerProgress } from '../../../../region-play/usePlayerProgress';
import { useRegionPlay } from '../../../../region-play/useRegionPlay';
import type { LocationCompanionProps } from '../../runtime/viewExtensionRegistry';
import type { RegionPlaySceneApi } from './regionPlayScene';
import { AreaPuzzleLayer } from './AreaPuzzleLayer';
import { BackpackPanel } from './ui/BackpackPanel';
import { ChestChallengePanel, type ChestPanelPhase } from './ui/ChestChallengePanel';
import { LaunchDialog } from './ui/LaunchDialog';
import { PipDialog } from './ui/PipDialog';
import { RewardReveal } from './ui/RewardReveal';
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
 * - Begins an Adventure from an object that offers one (ADR-041): the server
 *   checks and starts it, then the child goes to the Adventure with a way
 *   back to this 3D Area.
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
  } = props;
  const auth = useAuth();
  const onUnauthenticated = () => void auth.refresh();
  const parsed = useMemo(() => tryParseRegionPlayConfig(config), [config]);
  const controls = useRegionPlay(childId, regionId, { onUnauthenticated });
  const progress = usePlayerProgress(childId, { onUnauthenticated });
  const {
    state,
    startSession,
    changeSession,
    acceptQuest,
    requestChallenge,
    submitAnswer,
    solvePuzzle,
  } = controls;
  const refreshProgress = progress.refresh;
  const navigate = useNavigate();
  const launcher = useAdventureLaunch(childId, regionId);

  const [backpackOpen, setBackpackOpen] = useState(false);
  const [celebration, setCelebration] = useState<AnswerOutcome | null>(null);
  const [returned, setReturned] = useState<{
    outcome: AnswerOutcome;
    title: string;
    message: string | null;
  } | null>(null);
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

  // The reward reveal: once per attempt, only for a server-confirmed correct answer sent here.
  useEffect(() => {
    const outcome = state.lastOutcome;
    if (!shouldCelebrate(outcome, submittedAttempt.current, celebrated.current)) return;
    celebrated.current.add(outcome.attemptId);
    setCelebration(outcome);
    void refreshProgress();
  }, [state.lastOutcome, refreshProgress]);

  const event =
    parsed && claimedInteraction && state.bootstrap
      ? resolveRegionPlayInteraction(
          parsed,
          state.bootstrap,
          claimedInteraction.id,
          state.session !== null,
        )
      : null;

  const chestEntity = event?.kind === 'chest' ? event.entityId : null;
  const challenge =
    chestEntity && state.challenge?.targetEntityId === chestEntity ? state.challenge : null;
  const lastOutcome = state.lastOutcome;
  const wrong =
    !challenge &&
    lastOutcome !== null &&
    !lastOutcome.correct &&
    lastOutcome.attemptId === submittedAttempt.current;

  // Opening an unopened chest asks the server for its challenge, once per time it is opened.
  useEffect(() => {
    if (event?.kind !== 'chest' || !event.canRequestChallenge || challenge || wrong) return;
    if (state.busy || autoRequestedFor.current === claimedInteraction) return;
    autoRequestedFor.current = claimedInteraction;
    void requestChallenge(event.entityId);
  }, [event, challenge, wrong, state.busy, claimedInteraction, requestChallenge]);

  function closeInteraction() {
    autoRequestedFor.current = null;
    onCloseInteraction();
  }

  function submit(answer: number, hintLevel: number) {
    if (!challenge || state.busy) return;
    submittedAttempt.current = challenge.attemptId;
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

  // ADR-043 F: puzzle objects and the way back are the puzzle layer's; everything else is here.
  const areaEvent = event?.kind === 'puzzle' || event?.kind === 'return' ? event : null;
  const currentStage = state.bootstrap ? currentPuzzle(state.bootstrap.puzzles) : undefined;
  const stageParams = currentStage
    ? parsePuzzleParams(currentStage.kind, currentStage.parameters)
    : null;

  async function returnToNpc(puzzleId: string, title: string) {
    const outcome = await solvePuzzle(puzzleId, {});
    if (!outcome?.correct) return;
    const params = state.bootstrap?.puzzles.find((p) => p.puzzleId === puzzleId);
    const parsed = params ? parsePuzzleParams(params.kind, params.parameters) : null;
    setReturned({
      outcome: asRevealOutcome(outcome),
      title,
      message: parsed?.completeMessage ?? null,
    });
    void refreshProgress();
  }

  let panel = null;
  if (returned) {
    panel = (
      <RewardReveal
        outcome={returned.outcome}
        completed={completedQuests(returned.outcome, state.bootstrap?.quests ?? [])}
        title={returned.title}
        message={returned.message}
        onClose={() => {
          setReturned(null);
          closeInteraction();
        }}
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
  } else if (event?.kind === 'npc') {
    const returnPuzzle = event.returnPuzzle;
    panel = (
      <PipDialog
        name={event.label}
        dialogue={event.dialogue}
        stageLine={stageParams?.intro ?? null}
        returnAction={
          returnPuzzle && !returnPuzzle.locked && !returnPuzzle.solved
            ? {
                label: AREA_COPY.showProfessor,
                busy: state.busy === 'solvePuzzle',
                onReturn: () => void returnToNpc(returnPuzzle.puzzleId, returnPuzzle.title),
              }
            : null
        }
        quests={event.quests}
        accepting={state.busy === 'acceptQuest'}
        justAccepted={event.quests.some((q) => q.questId === acceptedHere && q.status === 'ACTIVE')}
        error={state.errorAction === 'acceptQuest' ? errorMessage : null}
        onAccept={accept}
        onClose={closeInteraction}
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
  } else if (event?.kind === 'chest') {
    let phase: ChestPanelPhase;
    if (event.isOpen) phase = { kind: 'open' };
    else if (!event.challengeAvailable) phase = { kind: 'not-ready' };
    else if (challenge)
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
      />
    );
  } else if (backpackOpen) {
    panel = <BackpackPanel progress={progress} onClose={() => setBackpackOpen(false)} />;
  }

  const itemCount = progress.progress?.inventory.length ?? 0;
  return (
    <>
      {state.bootstrap ? (
        <AreaPuzzleLayer
          bootstrap={state.bootstrap}
          sceneApi={(sceneApi as RegionPlaySceneApi | null) ?? null}
          event={areaEvent}
          busy={state.busy === 'solvePuzzle'}
          solvePuzzle={async (puzzleId, submission) => {
            const outcome = await solvePuzzle(puzzleId, submission as JsonObject);
            if (outcome?.correct) void refreshProgress();
            return outcome;
          }}
          onClose={closeInteraction}
          showToast={props.showToast}
        />
      ) : null}
      {areaEvent ? null : panel}
      {!panel ? (
        <button
          type="button"
          className={styles.backpackButton}
          onClick={() => {
            setBackpackOpen(true);
            void progress.refresh();
          }}
        >
          {PLAY_COPY.backpack}
          {itemCount > 0 ? <span className={styles.count}>{itemCount}</span> : null}
        </button>
      ) : null}
    </>
  );
}
