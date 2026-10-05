import { useEffect, useReducer, useRef, useState } from 'react';
import styles from './TideTrialPanel.module.css';
import { ChattyAvatar } from '../../companion/ChattyAvatar';
import {
  DECK_MAX_CM,
  DECK_MIN_CM,
  DECK_STEP_CM,
  TIDE_TRIAL_COPY,
  TIDE_TRIAL_HINTS,
  initialTideTrialState,
  isTideTrialWon,
  outcomeMessage,
  tideBoardLines,
  tideTrialReducer,
} from '../tideTrial';
import type { TideTrialScene } from './pirateBuilderBayScene';

export interface TideTrialPanelProps {
  /** The bay engine's tide controls, or `null` before the engine is up (the panel still plays; the scene just stays still). */
  scene: TideTrialScene | null;
  /** Called once, when the deck first survives a tide. Rejecting shows a calm "not saved" note; the bridge still works this visit. */
  onWon: () => Promise<void>;
  onClose: () => void;
}

/**
 * The HTML half of "Beat the Tide" (`../tideTrial.ts`): the tide board, the
 * deck-height control, the live water counter, and the result. An overlay
 * inside `WorldStage` (not below it like the bay's other interaction panels)
 * because the whole point is watching the scene while choosing: the deck
 * moves as the child changes its height, and the water rises past it.
 *
 * State lives in `tideTrialReducer`; this component only forwards each
 * transition to the scene, in order.
 */
export function TideTrialPanel({ scene, onWon, onClose }: TideTrialPanelProps) {
  const [state, dispatch] = useReducer(tideTrialReducer, undefined, initialTideTrialState);
  const [waterCm, setWaterCm] = useState<number | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const won = isTideTrialWon(state);

  // Read inside effects/callbacks without re-running them when these change.
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  const onWonRef = useRef(onWon);
  onWonRef.current = onWon;
  const wonRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    sceneRef.current?.begin(initialTideTrialState().deckCm);
    return () => {
      mountedRef.current = false;
      if (!wonRef.current) sceneRef.current?.cancel();
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.setDeckHeight(state.deckCm);
  }, [state.deckCm]);

  useEffect(() => {
    if (!won || wonRef.current) return;
    wonRef.current = true;
    sceneRef.current?.complete();
    onWonRef.current().catch(() => {
      if (mountedRef.current) setSaveFailed(true);
    });
  }, [won]);

  function bringTide() {
    dispatch({ type: 'BRING_TIDE' });
    const tide = sceneRef.current?.runTide((cm) => {
      if (mountedRef.current) setWaterCm(cm);
    });
    void (tide ?? Promise.resolve()).then(() => {
      if (mountedRef.current) dispatch({ type: 'TIDE_FINISHED' });
    });
  }

  function tryAgain() {
    dispatch({ type: 'TRY_AGAIN' });
    setWaterCm(null);
    sceneRef.current?.rebuild(state.deckCm);
  }

  const planning = state.phase === 'PLANNING';

  return (
    <section className={styles.panel} aria-labelledby="tide-trial-title">
      <h2 id="tide-trial-title" className={styles.title}>
        {TIDE_TRIAL_COPY.title}
      </h2>

      {state.attempts === 0 ? <p className={styles.speech}>Pip: {TIDE_TRIAL_COPY.intro}</p> : null}

      {won ? null : (
        <div className={styles.board}>
          <p className={styles.boardHeading}>{TIDE_TRIAL_COPY.boardHeading}</p>
          <ul className={styles.boardList}>
            {tideBoardLines().map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}

      <div className={styles.readouts}>
        <div className={styles.readout}>
          <span className={styles.readoutLabel}>{TIDE_TRIAL_COPY.deckLabel}</span>
          <span className={styles.readoutValue} data-testid="deck-height">
            {state.deckCm} cm
          </span>
        </div>
        {waterCm !== null ? (
          <div className={styles.readout}>
            <span className={styles.readoutLabel}>{TIDE_TRIAL_COPY.waterLabel}</span>
            <span className={styles.readoutValue} data-testid="water-level">
              {waterCm} cm
            </span>
          </div>
        ) : null}
      </div>

      {planning ? (
        <>
          <div className={styles.stepper}>
            <button
              type="button"
              className={styles.stepButton}
              aria-label={TIDE_TRIAL_COPY.lowerDeck}
              onClick={() => dispatch({ type: 'LOWER_DECK' })}
              disabled={state.deckCm <= DECK_MIN_CM}
            >
              - {DECK_STEP_CM} cm
            </button>
            <button
              type="button"
              className={styles.stepButton}
              aria-label={TIDE_TRIAL_COPY.raiseDeck}
              onClick={() => dispatch({ type: 'RAISE_DECK' })}
              disabled={state.deckCm >= DECK_MAX_CM}
            >
              + {DECK_STEP_CM} cm
            </button>
          </div>
          <button type="button" className={styles.primaryButton} onClick={bringTide}>
            {TIDE_TRIAL_COPY.bringTide}
          </button>
        </>
      ) : null}

      {state.phase === 'TIDE_RISING' ? (
        <p className={styles.speech}>{TIDE_TRIAL_COPY.tideRising}</p>
      ) : null}

      <div aria-live="polite">
        {state.phase === 'RESULT' && state.outcome ? (
          <div className={won ? styles.resultWon : styles.result}>
            {outcomeMessage(state.outcome, state.attempts).map((line) => (
              <p key={line} className={styles.resultLine}>
                {line}
              </p>
            ))}
          </div>
        ) : null}
        {saveFailed ? (
          <p role="alert" className={styles.saveNote}>
            The bridge is fixed for now, but the island could not remember it. You may need to build
            it again next time.
          </p>
        ) : null}
      </div>

      {state.phase === 'RESULT' && !won ? (
        <button type="button" className={styles.primaryButton} onClick={tryAgain}>
          {TIDE_TRIAL_COPY.tryAgain}
        </button>
      ) : null}
      {won ? (
        <button type="button" className={styles.primaryButton} onClick={onClose}>
          {TIDE_TRIAL_COPY.cross}
        </button>
      ) : null}

      {!won && state.hintsShown > 0 ? (
        <ol className={styles.hints}>
          {TIDE_TRIAL_HINTS.slice(0, state.hintsShown).map((hint) => (
            <li key={hint} className={styles.hint}>
              <ChattyAvatar size={24} />
              <span>{hint}</span>
            </li>
          ))}
        </ol>
      ) : null}

      <div className={styles.footer}>
        {!won && state.hintsShown < TIDE_TRIAL_HINTS.length ? (
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() => dispatch({ type: 'SHOW_HINT' })}
          >
            {TIDE_TRIAL_COPY.hint}
          </button>
        ) : null}
        {!won ? (
          <button type="button" className={styles.secondaryButton} onClick={onClose}>
            {TIDE_TRIAL_COPY.close}
          </button>
        ) : null}
      </div>
    </section>
  );
}
