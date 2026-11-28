import { useEffect, useMemo, useState } from 'react';
import type { PuzzleOutcome, PuzzleState, RegionBootstrap } from '../../../../../api/play/types';
import {
  addToOrder,
  AREA_COPY,
  askChoiceHint,
  asRevealOutcome,
  clearOrder,
  differentChoiceState,
  fittingSlots,
  openChoiceState,
  placeStone,
  recordChoiceResult,
  removeStone,
  reopenChoiceState,
  selectOption,
  solvedPlacements,
  successLines,
  symbolGlyph,
  undoOrder,
  type ChoiceState,
} from '../../../../region-play/areaPuzzleUi';
import {
  chooseAnswerCorrect,
  hintsShown,
  orderSequenceCorrect,
  parsePuzzleParams,
  simulateValves,
  type ChoiceKindParams,
  type PlatformParams,
  type PuzzleParams,
  type ValveParams,
} from '../../../../region-play/areaPuzzles';
import { playCue } from '../../../../region-play/soundCues';
import type { RegionPlayInteractionEvent } from '../../../../region-play/regionPlayInteractions';
import { completedQuests } from '../../../../region-play/regionPlayUi';
import type { RegionPlaySceneApi } from './regionPlayScene';
import {
  ChooseAnswerPanel,
  CrossingPanel,
  DiscoveryPanel,
  OrderSequencePanel,
  TelescopePanel,
  ValvePanel,
} from './ui/AreaPuzzlePanels';
import type { WorldEngineEventBus } from '../../worldEngineEvents';
import type { ChoiceSceneView } from './areaPuzzleScene';
import { RewardReveal } from './ui/RewardReveal';
import area from './ui/AreaPuzzlePanels.module.css';

/**
 * The React side of 3D Area puzzles (ADR-047 F, Firepeak FP-5 to FP-10), inside `region-play`'s
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
  /**
   * `options.hintsUsed`: the hints shown before this answer (issue #102). It only lowers the
   * evidence support level; rewards are the same with or without hints.
   */
  solvePuzzle(
    puzzleId: string,
    submission: Record<string, unknown>,
    options?: { hintsUsed: number },
  ): Promise<PuzzleOutcome | undefined>;
  onClose(): void;
  showToast(message: string): void;
  /**
   * The region's event bus: a platforming hazard (Firepeak lava, a lake) puts the child back
   * through `PlayerRecovered`, and the same gentle fade as the effects lava plays. The engine's
   * own recovery toast already says why (`platforming.recoveryLead`).
   */
  bus?: Pick<WorldEngineEventBus, 'on'>;
}

interface Typed {
  puzzle: PuzzleState;
  params: PuzzleParams;
}

function isChoiceKind(params: PuzzleParams): params is ChoiceKindParams {
  return params.kind === 'CHOOSE_ANSWER' || params.kind === 'ORDER_SEQUENCE';
}

/**
 * What the scene shows for one CHOOSE_ANSWER or ORDER_SEQUENCE puzzle: a label on every mapped
 * entity, a glow on what the child picked, and a stronger glow on the right ones once the server
 * agreed. `null` when the puzzle has no scene objects.
 */
export function choiceSceneView(
  params: ChoiceKindParams,
  state: ChoiceState,
): ChoiceSceneView | null {
  const entities = params.kind === 'CHOOSE_ANSWER' ? params.optionEntities : params.itemEntities;
  if (Object.keys(entities).length === 0) return null;
  const faces =
    params.kind === 'CHOOSE_ANSWER'
      ? (params.variants[state.variantIndex] ?? params.variants[0]).options
      : (params.variants[state.variantIndex] ?? params.variants[0]).items;
  const labels: Record<string, string> = {};
  for (const face of faces) {
    const entity = entities[face.id];
    if (entity) labels[entity] = `${symbolGlyph(face.symbol)} ${face.label}`.trim();
  }
  const picked =
    params.kind === 'CHOOSE_ANSWER' ? (state.selected ? [state.selected] : []) : state.order;
  const right =
    state.result !== 'correct'
      ? []
      : params.kind === 'CHOOSE_ANSWER'
        ? [(params.variants[state.variantIndex] ?? params.variants[0]).answer]
        : (params.variants[state.variantIndex] ?? params.variants[0]).answer;
  const entityOf = (ids: readonly string[]) =>
    ids.map((id) => entities[id]).filter((id): id is string => Boolean(id));
  return { labels, highlighted: entityOf(picked), correct: entityOf(right) };
}

/**
 * A choice puzzle's scene objects this child's age band never uses. The seed places the union of
 * every band's answer objects (`entityIds`), but a band's parameters map only its own options, so a
 * Pathfinder switch or story puzzle would otherwise leave one or two unlabelled objects that do
 * nothing. They are hidden and taken out of focus instead.
 */
export function unusedChoiceEntities(
  entityIds: readonly string[],
  params: ChoiceKindParams,
): string[] {
  const entities = params.kind === 'CHOOSE_ANSWER' ? params.optionEntities : params.itemEntities;
  const used = new Set(Object.values(entities));
  if (used.size === 0) return [];
  return entityIds.filter((entityId) => !used.has(entityId));
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
  // The object the child touched, by its label: "Pick up the torn map piece" (#102).
  const [touched, setTouched] = useState<string | null>(null);
  const [observed, setObserved] = useState<string[]>([]);
  const [placements, setPlacements] = useState<Record<string, string>>({});
  const [carried, setCarried] = useState<string | null>(null);
  const [sequence, setSequence] = useState<string[]>([]);
  const [lastTurnMoved, setLastTurnMoved] = useState<boolean | null>(null);
  const [wrong, setWrong] = useState<string | null>(null);
  // One discovery phase per COLLECT_OBJECT puzzle: an Area may hide many (Treasure Cove's map
  // pieces and carvings), and finding one must never show another as found.
  const [discoveries, setDiscoveries] = useState<Record<string, 'ready' | 'discovering' | 'found'>>(
    {},
  );
  const setDiscovery = (puzzleId: string, phase: 'ready' | 'discovering' | 'found') =>
    setDiscoveries((all) => ({ ...all, [puzzleId]: phase }));
  const [reveal, setReveal] = useState<{
    outcome: PuzzleOutcome;
    title: string;
    message: string | null;
  } | null>(null);
  const [flash, setFlash] = useState(0);
  // Multi-instance kinds: one state per puzzle id (FPV), never one per kind.
  const [choice, setChoice] = useState<Record<string, ChoiceState>>({});
  /** Puzzles (not CHOOSE_ANSWER or ORDER_SEQUENCE) whose hint the child asked for this visit. */
  const [hintAsked, setHintAsked] = useState<Record<string, true>>({});
  const sessionId = bootstrap.session?.sessionId ?? '';

  const crossing = byKind('PLACE_PLATFORMS');
  const valves = byKind('VALVE_SEQUENCE');
  const collects = useMemo(
    () => [...typed.values()].filter((entry) => entry.params.kind === 'COLLECT_OBJECT'),
    [typed],
  );
  const location = bootstrap.region.locationSlug;

  // The scene follows the server's world changes only.
  useEffect(() => {
    sceneApi?.effects?.setChangeKeys(
      bootstrap.worldChanges.filter((c) => c.locationSlug === location).map((c) => c.changeKey),
    );
  }, [bootstrap.worldChanges, location, sceneApi]);

  // A solved crossing stays built; a found object stays gone (resume, FP scenario 10).
  useEffect(() => {
    if (crossing?.puzzle.solved) setPlacements(solvedPlacements(crossing.params));
  }, [crossing?.puzzle.solved, crossing?.params]);
  useEffect(() => {
    if (!sceneApi) return;
    for (const { puzzle } of collects) {
      for (const entityId of puzzle.entityIds) {
        sceneApi.puzzles?.setVisible(entityId, !puzzle.solved);
      }
    }
  }, [collects, sceneApi]);

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

  // A band's unused answer objects are never shown (`unusedChoiceEntities`).
  useEffect(() => {
    const puzzles = sceneApi?.puzzles;
    if (!puzzles) return;
    for (const { puzzle, params } of typed.values()) {
      if (!isChoiceKind(params)) continue;
      for (const entityId of unusedChoiceEntities(puzzle.entityIds, params)) {
        puzzles.setVisible(entityId, false);
      }
    }
  }, [sceneApi, typed]);

  // Labels and glow on the scene objects of every choice puzzle, each keyed by its own id.
  useEffect(() => {
    const puzzles = sceneApi?.puzzles;
    if (!puzzles?.showChoices) return;
    const shown: string[] = [];
    for (const [puzzleId, { puzzle, params }] of typed) {
      if (!isChoiceKind(params) || puzzle.locked) continue;
      const state = choice[puzzleId] ?? openChoiceState(sessionId, puzzleId, params, puzzle.solved);
      const view = choiceSceneView(params, state);
      if (!view) continue;
      puzzles.showChoices(puzzleId, view);
      shown.push(puzzleId);
    }
    return () => {
      for (const puzzleId of shown) puzzles.clearChoices?.(puzzleId);
    };
  }, [choice, sceneApi, sessionId, typed]);

  const bus = props.bus;
  useEffect(() => {
    if (!bus) return;
    return bus.on('PlayerRecovered', ({ reason }) => {
      if (reason === 'HAZARD') setFlash((n) => n + 1);
    });
  }, [bus]);

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
    const entry = typed.get(puzzleId);
    const hintsUsed = entry
      ? hintsShown(entry.params, entry.puzzle.failedAttempts, hintAsked[puzzleId] === true)
      : 0;
    const outcome = await props.solvePuzzle(puzzleId, submission, { hintsUsed });
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
    setTouched(event.label && event.label !== event.entityId ? event.label : null);
    if (isChoiceKind(entry.params)) {
      openChoice(entry.puzzle, entry.params, active !== puzzle.puzzleId, event.entityId);
      setActive(puzzle.puzzleId);
      return;
    }
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

  /** Opens a choice puzzle: its state for this visit, with the touched scene object applied. */
  function openChoice(
    puzzle: PuzzleState,
    params: ChoiceKindParams,
    fresh: boolean,
    entityId: string | null,
  ) {
    setChoice((all) => {
      const known = all[puzzle.puzzleId];
      let state = known
        ? fresh
          ? reopenChoiceState(known, params, puzzle.solved)
          : known
        : openChoiceState(sessionId, puzzle.puzzleId, params, puzzle.solved);
      if (entityId && state.result !== 'correct') {
        const entities =
          params.kind === 'CHOOSE_ANSWER' ? params.optionEntities : params.itemEntities;
        const id = Object.keys(entities).find((key) => entities[key] === entityId);
        if (id && params.kind === 'ORDER_SEQUENCE' && params.presentation === 'SWITCHES')
          playCue('switchFlip', { entityId });
        if (id)
          state = params.kind === 'CHOOSE_ANSWER' ? selectOption(state, id) : addToOrder(state, id);
      }
      return { ...all, [puzzle.puzzleId]: state };
    });
  }

  function askHint(puzzleId: string) {
    setHintAsked((asked) => (asked[puzzleId] ? asked : { ...asked, [puzzleId]: true }));
  }

  function patchChoice(puzzleId: string, change: (state: ChoiceState) => ChoiceState) {
    setChoice((all) => (all[puzzleId] ? { ...all, [puzzleId]: change(all[puzzleId]) } : all));
  }

  async function submitChoice(puzzle: PuzzleState, params: ChoiceKindParams, state: ChoiceState) {
    const variant = params.variants[state.variantIndex] ?? params.variants[0];
    let submission: Record<string, unknown>;
    try {
      // The same rules as the server, to refuse a malformed answer before sending it.
      if (params.kind === 'CHOOSE_ANSWER') {
        const picked = state.selected ?? '';
        chooseAnswerCorrect(params.variants[state.variantIndex] ?? params.variants[0], picked);
        submission = { variantId: variant.id, choice: picked };
      } else {
        orderSequenceCorrect(
          params.variants[state.variantIndex] ?? params.variants[0],
          state.order,
        );
        submission = { variantId: variant.id, order: state.order };
      }
    } catch {
      return;
    }
    const outcome = await props.solvePuzzle(puzzle.puzzleId, submission, {
      hintsUsed: hintsShown(params, state.wrongCount, state.hintAsked),
    });
    if (!outcome) return;
    // Practice: the puzzle was solved already, so the server graded and recorded nothing.
    const practice = state.practice || outcome.practice || puzzle.solved;
    patchChoice(puzzle.puzzleId, (current) => ({
      ...recordChoiceResult(current, outcome.correct),
      practice,
    }));
    if (outcome.correct && !practice) {
      setActive(null);
      setReveal({
        outcome,
        title: puzzle.title,
        message: successLines(variant.explanation, params).join(' '),
      });
    }
  }

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
          onHintAsked={() => askHint(puzzle.puzzleId)}
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
          onHintAsked={() => askHint(puzzle.puzzleId)}
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
          onHintAsked={() => askHint(puzzle.puzzleId)}
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
    } else if (params.kind === 'CHOOSE_ANSWER' || params.kind === 'ORDER_SEQUENCE') {
      const state = choice[puzzle.puzzleId];
      if (state) {
        const common = {
          title: puzzle.title,
          state,
          busy: props.busy,
          onDifferent: () => patchChoice(puzzle.puzzleId, (c) => differentChoiceState(c, params)),
          onHintAsked: () => patchChoice(puzzle.puzzleId, askChoiceHint),
          onSubmit: () => void submitChoice(puzzle, params, state),
          onClose: close,
        };
        panel =
          params.kind === 'CHOOSE_ANSWER' ? (
            <ChooseAnswerPanel
              {...common}
              params={params}
              onSelect={(id) => patchChoice(puzzle.puzzleId, (c) => selectOption(c, id))}
            />
          ) : (
            <OrderSequencePanel
              {...common}
              params={params}
              onAdd={(id) => {
                if (params.presentation === 'SWITCHES') playCue('switchFlip');
                patchChoice(puzzle.puzzleId, (c) => addToOrder(c, id));
              }}
              onUndo={() => patchChoice(puzzle.puzzleId, undoOrder)}
              onClear={() => patchChoice(puzzle.puzzleId, clearOrder)}
            />
          );
      }
    } else if (params.kind === 'COLLECT_OBJECT') {
      const discovery = discoveries[puzzle.puzzleId] ?? 'ready';
      panel = (
        <DiscoveryPanel
          title={puzzle.title}
          objectLabel={touched}
          params={params}
          phase={puzzle.solved && discovery === 'ready' ? 'found' : discovery}
          busy={props.busy}
          onCollect={() => {
            setDiscovery(puzzle.puzzleId, 'discovering');
            void props.solvePuzzle(puzzle.puzzleId, {}).then(async (outcome) => {
              if (!outcome?.correct) {
                setDiscovery(puzzle.puzzleId, 'ready');
                return;
              }
              for (const entityId of puzzle.entityIds) await sceneApi?.puzzles?.discover(entityId);
              setDiscovery(puzzle.puzzleId, 'found');
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
