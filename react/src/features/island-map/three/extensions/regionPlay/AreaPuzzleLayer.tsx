import { useEffect, useMemo, useState } from 'react';
import type { PuzzleOutcome, PuzzleState, RegionBootstrap } from '../../../../../api/play/types';
import {
  AREA_COPY,
  asRevealOutcome,
  fittingSlots,
  placeStone,
  removeStone,
  solvedPlacements,
} from '../../../../region-play/areaPuzzleUi';
import {
  parsePuzzleParams,
  simulateValves,
  type PlatformParams,
  type PuzzleParams,
  type ValveParams,
} from '../../../../region-play/areaPuzzles';
import type { RegionPlayInteractionEvent } from '../../../../region-play/regionPlayInteractions';
import { completedQuests } from '../../../../region-play/regionPlayUi';
import type { RegionPlaySceneApi } from './regionPlayScene';
import { CrossingPanel, DiscoveryPanel, TelescopePanel, ValvePanel } from './ui/AreaPuzzlePanels';
import { RewardReveal } from './ui/RewardReveal';
import area from './ui/AreaPuzzlePanels.module.css';

/**
 * The React side of 3D Area puzzles (ADR-043 F, Firepeak FP-5 to FP-10), inside `region-play`'s
 * companion so one visit has one session and one bootstrap.
 *
 * - Holds the child's moves while they work (features looked at, stones carried and placed,
 *   valves turned) and shows them in the scene; none of it is progress.
 * - Sends a finished attempt to the server and shows what the server answers. A stage is done,
 *   a passage opens and a reward appears only after the play API says so.
 * - Keeps the scene in step with the server's world changes (lava made safe, passage open).
 * - Says, kindly, when the child stepped into lava and was brought back to safety.
 */

export interface AreaPuzzleLayerProps {
  bootstrap: RegionBootstrap;
  /** `effects` and `puzzles` may be absent from a scene built before them; nothing is drawn then. */
  sceneApi: Partial<RegionPlaySceneApi> | null;
  /** The interaction the child just opened, if it is a puzzle object or the way back. */
  event: RegionPlayInteractionEvent | null;
  busy: boolean;
  solvePuzzle(
    puzzleId: string,
    submission: Record<string, unknown>,
  ): Promise<PuzzleOutcome | undefined>;
  onClose(): void;
  showToast(message: string): void;
}

interface Typed {
  puzzle: PuzzleState;
  params: PuzzleParams;
}

export function AreaPuzzleLayer(props: AreaPuzzleLayerProps) {
  const { bootstrap, sceneApi, event } = props;
  const typed = useMemo(() => {
    const out = new Map<string, Typed>();
    for (const puzzle of bootstrap.puzzles) {
      const params = parsePuzzleParams(puzzle.kind, puzzle.parameters);
      if (params) out.set(puzzle.puzzleId, { puzzle, params });
    }
    return out;
  }, [bootstrap.puzzles]);
  const byKind = <K extends PuzzleParams['kind']>(kind: K) =>
    [...typed.values()].find((entry) => entry.params.kind === kind) as
      { puzzle: PuzzleState; params: Extract<PuzzleParams, { kind: K }> } | undefined;

  const [active, setActive] = useState<string | null>(null);
  const [observed, setObserved] = useState<string[]>([]);
  const [placements, setPlacements] = useState<Record<string, string>>({});
  const [carried, setCarried] = useState<string | null>(null);
  const [sequence, setSequence] = useState<string[]>([]);
  const [lastTurnMoved, setLastTurnMoved] = useState<boolean | null>(null);
  const [wrong, setWrong] = useState<string | null>(null);
  const [discovery, setDiscovery] = useState<'ready' | 'discovering' | 'found'>('ready');
  const [reveal, setReveal] = useState<{
    outcome: PuzzleOutcome;
    title: string;
    message: string | null;
  } | null>(null);
  const [flash, setFlash] = useState(0);

  const crossing = byKind('PLACE_PLATFORMS');
  const valves = byKind('VALVE_SEQUENCE');
  const crystal = byKind('COLLECT_OBJECT');
  const location = bootstrap.region.locationSlug;

  // The scene follows the server's world changes only.
  useEffect(() => {
    sceneApi?.effects?.setChangeKeys(
      bootstrap.worldChanges.filter((c) => c.locationSlug === location).map((c) => c.changeKey),
    );
  }, [bootstrap.worldChanges, location, sceneApi]);

  // A solved crossing stays built; a found crystal stays gone (resume, FP scenario 10).
  useEffect(() => {
    if (crossing?.puzzle.solved) setPlacements(solvedPlacements(crossing.params));
  }, [crossing?.puzzle.solved, crossing?.params]);
  useEffect(() => {
    if (!sceneApi || !crystal) return;
    for (const entityId of crystal.puzzle.entityIds) {
      sceneApi.puzzles?.setVisible(entityId, !crystal.puzzle.solved);
    }
  }, [crystal, sceneApi]);

  useEffect(() => {
    if (!sceneApi || !crossing) return;
    const params: PlatformParams = crossing.params;
    sceneApi.puzzles?.showArrangement({
      placements,
      carried,
      stoneSizes: Object.fromEntries(params.stones.map((s) => [s.id, s.size])),
      gapSizes: Object.fromEntries(params.slots.map((s) => [s.id, s.gap])),
      fits: fittingSlots(params, placements),
      outlines: params.showOutlines,
    });
  }, [carried, crossing, placements, sceneApi]);

  const steamAt = valves ? simulateValves(valves.params.valves, valves.params.start, sequence) : '';
  useEffect(() => {
    if (!sceneApi || !valves) return;
    sceneApi.puzzles?.showValveTurns(
      valves.puzzle.solved ? valves.params.valves.map((v) => v.id) : sequence,
    );
  }, [sceneApi, sequence, valves]);

  useEffect(() => {
    if (!sceneApi?.effects) return;
    return sceneApi.effects.subscribe({
      respawned: () => {
        props.showToast(AREA_COPY.lavaTooHot);
        setFlash((n) => n + 1);
      },
    });
    // showToast is stable for the visit; re-subscribing on every render would drop events.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneApi]);

  async function submit(
    puzzleId: string,
    submission: Record<string, unknown>,
    title: string,
    message: string | null,
  ) {
    const outcome = await props.solvePuzzle(puzzleId, submission);
    if (!outcome) return undefined;
    if (outcome.correct) {
      setWrong(null);
      setActive(null);
      setReveal({ outcome, title, message });
    } else {
      setWrong(puzzleId);
    }
    return outcome;
  }

  // What opening a puzzle object means: a move in the puzzle, then its panel.
  useEffect(() => {
    if (!event) return;
    if (event.kind === 'return') {
      if (!sceneApi?.effects?.useReturn(event.entityId))
        props.showToast(AREA_COPY.ropeLiftNotReady);
      props.onClose();
      return;
    }
    if (event.kind !== 'puzzle') return;
    const { puzzle } = event;
    if (puzzle.locked) {
      props.showToast(AREA_COPY.lockedStage);
      props.onClose();
      return;
    }
    const entry = typed.get(puzzle.puzzleId);
    if (!entry) return;
    setActive(puzzle.puzzleId);
    if (entry.params.kind === 'PLACE_PLATFORMS' && !puzzle.solved) {
      const isStone = entry.params.stones.some((s) => s.id === event.entityId);
      if (isStone) setCarried((current) => (current === event.entityId ? null : event.entityId));
      else if (carried) {
        setPlacements((current) => placeStone(current, carried, event.entityId));
        setCarried(null);
      }
    }
    if (entry.params.kind === 'VALVE_SEQUENCE' && !puzzle.solved)
      turnValve(entry.puzzle, entry.params, event.entityId);
    // Only a new interaction counts as a move.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event]);

  function turnValve(puzzle: PuzzleState, params: ValveParams, valveId: string) {
    const before = simulateValves(params.valves, params.start, sequence);
    const next = [...sequence, valveId];
    const after = simulateValves(params.valves, params.start, next);
    setSequence(next);
    setLastTurnMoved(after !== before);
    sceneApi?.effects?.previewSteamCleared(after !== params.start);
    if (after === params.goal)
      void submit(puzzle.puzzleId, { sequence: next }, puzzle.title, params.completeMessage);
  }

  function close() {
    setActive(null);
    props.onClose();
  }

  if (reveal) {
    return (
      <RewardReveal
        outcome={asRevealOutcome(reveal.outcome)}
        completed={completedQuests(asRevealOutcome(reveal.outcome), bootstrap.quests)}
        title={reveal.title}
        lead={reveal.message}
        onClose={() => {
          setReveal(null);
          props.onClose();
        }}
      />
    );
  }

  const entry = active ? typed.get(active) : undefined;
  let panel = null;
  if (entry) {
    const { puzzle, params } = entry;
    const failed = puzzle.failedAttempts;
    const isWrong = wrong === puzzle.puzzleId;
    if (params.kind === 'OBSERVE_FEATURES') {
      panel = (
        <TelescopePanel
          title={puzzle.title}
          params={params}
          observed={observed}
          failedAttempts={failed}
          wrong={isWrong}
          busy={props.busy}
          onObserve={(id) => setObserved((seen) => (seen.includes(id) ? seen : [...seen, id]))}
          onSubmit={() =>
            void submit(puzzle.puzzleId, { observed }, puzzle.title, params.completeMessage)
          }
          onClose={close}
        />
      );
    } else if (params.kind === 'PLACE_PLATFORMS') {
      panel = (
        <CrossingPanel
          title={puzzle.title}
          params={params}
          placements={placements}
          carried={carried}
          fits={fittingSlots(params, placements)}
          failedAttempts={failed}
          wrong={isWrong}
          busy={props.busy}
          onCarry={setCarried}
          onPlace={(stone, slot) => {
            setPlacements((current) => placeStone(current, stone, slot));
            setCarried(null);
          }}
          onRemove={(stone) => setPlacements((current) => removeStone(current, stone))}
          onSubmit={() =>
            void submit(puzzle.puzzleId, { placements }, puzzle.title, params.completeMessage)
          }
          onClose={close}
        />
      );
    } else if (params.kind === 'VALVE_SEQUENCE') {
      panel = (
        <ValvePanel
          title={puzzle.title}
          params={params}
          sequence={sequence}
          steamAt={steamAt}
          lastTurnMoved={lastTurnMoved}
          failedAttempts={failed}
          wrong={isWrong}
          busy={props.busy}
          onTurn={(id) => turnValve(puzzle, params, id)}
          onReset={() => {
            setSequence([]);
            setLastTurnMoved(null);
            sceneApi?.effects?.previewSteamCleared(false);
          }}
          onClose={close}
        />
      );
    } else if (params.kind === 'COLLECT_OBJECT') {
      panel = (
        <DiscoveryPanel
          title={puzzle.title}
          params={params}
          phase={puzzle.solved && discovery === 'ready' ? 'found' : discovery}
          busy={props.busy}
          onCollect={() => {
            setDiscovery('discovering');
            void props.solvePuzzle(puzzle.puzzleId, {}).then(async (outcome) => {
              if (!outcome?.correct) {
                setDiscovery('ready');
                return;
              }
              for (const entityId of puzzle.entityIds) await sceneApi?.puzzles?.discover(entityId);
              setDiscovery('found');
              setReveal({ outcome, title: params.discoveryMessage, message: params.scienceNote });
            });
          }}
          onClose={close}
        />
      );
    }
  }

  return (
    <>
      {flash > 0 ? <div key={flash} className={area.respawnFlash} aria-hidden="true" /> : null}
      {panel}
    </>
  );
}
