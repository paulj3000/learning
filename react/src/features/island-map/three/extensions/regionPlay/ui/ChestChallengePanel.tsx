import { useState, type FormEvent } from 'react';
import type { IssuedChallenge } from '../../../../../../api/play/types';
import {
  MAX_HINT_LEVEL,
  PLAY_COPY,
  describeChallenge,
  hintsFor,
  parseTypedAnswer,
} from '../../../../../region-play/regionPlayUi';
import { GameDialog } from './GameDialog';
import styles from './RegionPlayPanels.module.css';

export type ChestPanelPhase =
  | { kind: 'waiting' }
  | { kind: 'requesting' }
  | { kind: 'answering'; challenge: IssuedChallenge; submitting: boolean }
  | { kind: 'wrong' }
  | { kind: 'open' }
  | { kind: 'not-ready' };

export interface ChestChallengePanelProps {
  label: string;
  phase: ChestPanelPhase;
  error: string | null;
  /** Called with the child's answer and how many hints they asked for. The server grades it. */
  onSubmit(answer: number, hintLevel: number): void;
  /** Asks the server for another challenge, after a wrong answer or a failed request. */
  onTryAgain(): void;
  onClose(): void;
}

/**
 * The chest's lock (TR-8): the server's challenge as a picture of coins and a
 * question, answered with big buttons (`CHOICE`) or a number (`NUMBER_INPUT`).
 * It only collects an answer. It never knows the right one, so it cannot
 * grade, hint at, or reveal it; the server's outcome decides what happens.
 */
export function ChestChallengePanel({ label, phase, error, onSubmit, onTryAgain, onClose }: ChestChallengePanelProps) {
  return (
    <GameDialog titleId="region-play-chest-title" title={label} onClose={onClose}>
      {phase.kind === 'waiting' ? <p className={styles.speech}>{PLAY_COPY.chestWaiting}</p> : null}
      {phase.kind === 'requesting' ? (
        <p className={styles.speech} role="status">
          {PLAY_COPY.chestOpening}
        </p>
      ) : null}
      {phase.kind === 'open' ? <p className={styles.speech}>{PLAY_COPY.chestOpen}</p> : null}
      {phase.kind === 'not-ready' ? <p className={styles.speech}>{PLAY_COPY.chestNotReady}</p> : null}
      {phase.kind === 'answering' ? (
        <ChallengeForm
          key={phase.challenge.attemptId}
          challenge={phase.challenge}
          submitting={phase.submitting}
          onSubmit={onSubmit}
        />
      ) : null}
      {phase.kind === 'wrong' ? (
        <>
          <p className={styles.feedbackWrong} role="status">
            {PLAY_COPY.wrong}
          </p>
          <div className={styles.actions}>
            <button type="button" className={styles.primary} onClick={onTryAgain}>
              {PLAY_COPY.tryAgain}
            </button>
          </div>
        </>
      ) : null}
      {error ? (
        <>
          <p className={styles.error} role="alert">
            {error}
          </p>
          {/* A failed request leaves nothing to answer, so offer to ask again. */}
          {phase.kind === 'waiting' ? (
            <div className={styles.actions}>
              <button type="button" className={styles.button} onClick={onTryAgain}>
                {PLAY_COPY.retry}
              </button>
            </div>
          ) : null}
        </>
      ) : null}
      <div className={styles.actions}>
        <button type="button" className={styles.button} onClick={onClose}>
          {PLAY_COPY.close}
        </button>
      </div>
    </GameDialog>
  );
}

function ChallengeForm({
  challenge,
  submitting,
  onSubmit,
}: {
  challenge: IssuedChallenge;
  submitting: boolean;
  onSubmit(answer: number, hintLevel: number): void;
}) {
  const [hintLevel, setHintLevel] = useState(0);
  const [typed, setTyped] = useState('');
  const picture = describeChallenge(challenge.challenge);
  const hints = hintsFor(challenge.challenge, hintLevel);
  const typedAnswer = parseTypedAnswer(typed);

  function submitTyped(event: FormEvent) {
    event.preventDefault();
    if (typedAnswer !== null && !submitting) onSubmit(typedAnswer, hintLevel);
  }

  return (
    <>
      <div className={styles.picture} role="img" aria-label={picture.spoken}>
        {picture.groups.map((group, index) => (
          <span key={index} style={{ display: 'contents' }}>
            {index > 0 && picture.join ? (
              <span className={styles.join} aria-hidden="true">
                {picture.join}
              </span>
            ) : null}
            <span className={styles.group} aria-hidden="true">
              {Array.from({ length: group.count }, (_, coin) => (
                <span key={coin} className={[styles.coin, group.takenAway ? styles.coinTaken : ''].join(' ')} />
              ))}
            </span>
          </span>
        ))}
      </div>
      <p className={styles.speech}>{picture.spoken}</p>
      <p className={styles.question} id="region-play-question">
        {picture.question}
      </p>

      {challenge.challenge.responseMode === 'CHOICE' ? (
        <div className={styles.choices} role="group" aria-labelledby="region-play-question">
          {challenge.challenge.choices.map((choice) => (
            <button
              key={choice}
              type="button"
              className={styles.choice}
              disabled={submitting}
              onClick={() => onSubmit(choice, hintLevel)}
            >
              {choice}
            </button>
          ))}
        </div>
      ) : (
        <form className={styles.answerRow} onSubmit={submitTyped}>
          <label className={styles.visuallyHidden} htmlFor="region-play-answer">
            {PLAY_COPY.typeAnswer}
          </label>
          <input
            id="region-play-answer"
            className={styles.answerInput}
            inputMode="numeric"
            autoComplete="off"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            disabled={submitting}
          />
          <button type="submit" className={styles.primary} disabled={submitting || typedAnswer === null}>
            {PLAY_COPY.openIt}
          </button>
        </form>
      )}

      {submitting ? (
        <p className={styles.speech} role="status">
          {PLAY_COPY.checking}
        </p>
      ) : null}

      {hints.length > 0 ? (
        <ol className={styles.hints} aria-live="polite">
          {hints.map((hint) => (
            <li key={hint}>{hint}</li>
          ))}
        </ol>
      ) : null}
      {hintLevel < MAX_HINT_LEVEL ? (
        <div className={styles.actions}>
          <button type="button" className={styles.button} disabled={submitting} onClick={() => setHintLevel((level) => level + 1)}>
            {PLAY_COPY.helpMe}
          </button>
        </div>
      ) : null}
    </>
  );
}
