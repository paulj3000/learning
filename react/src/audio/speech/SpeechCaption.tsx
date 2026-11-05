import type { SpeechState } from './SpeechPlayer';
import styles from './SpeechCaption.module.css';

export interface SpeechCaptionProps {
  state: SpeechState;
  onReplay(): void;
  onStop(): void;
  onPause(): void;
  onResume(): void;
  /** A name for the speaker shown before the words, such as "Keeper Quill". */
  speaker?: string;
}

/**
 * The caption and the narration controls (SM-P8-07). The words are always shown, whatever happens
 * to the audio: muted, blocked by the browser, offline, switched off or failed. The controls are
 * real buttons, large enough to tap, and each one is only offered when it can do something.
 * Utterance-level only: the whole line is shown, with no word highlighting.
 */
export function SpeechCaption({
  state,
  onReplay,
  onStop,
  onPause,
  onResume,
  speaker,
}: SpeechCaptionProps) {
  if (!state.caption && state.phase !== 'loading') return null;
  const speaking = state.phase === 'playing' || state.phase === 'paused';
  return (
    <section className={styles.caption} aria-label="What is being said">
      <p className={styles.text} role="status" aria-live="polite">
        {speaker ? <strong className={styles.speaker}>{speaker}: </strong> : null}
        {state.caption ?? 'Getting ready to talk...'}
      </p>
      {state.phase === 'loading' && state.caption ? (
        <p className={styles.note}>Getting ready to talk...</p>
      ) : null}
      {state.textOnly ? (
        <p className={styles.note}>Read along. There is no sound for this one.</p>
      ) : null}
      <div className={styles.controls}>
        {state.phase === 'playing' ? (
          <button type="button" className={styles.button} onClick={onPause}>
            Pause
          </button>
        ) : null}
        {state.phase === 'paused' ? (
          <button type="button" className={styles.button} onClick={onResume}>
            Keep going
          </button>
        ) : null}
        {speaking || state.phase === 'loading' ? (
          <button type="button" className={styles.button} onClick={onStop}>
            Skip
          </button>
        ) : null}
        {state.canReplay && !speaking && state.phase !== 'loading' ? (
          <button type="button" className={styles.button} onClick={onReplay}>
            Hear it again
          </button>
        ) : null}
      </div>
    </section>
  );
}
