import styles from './CompanionBubble.module.css';
import type { CompanionTurnState } from './useCompanionTurn';

interface CompanionBubbleProps {
  state: CompanionTurnState;
  onChoose?: (choiceId: string) => void;
}

/**
 * Renders Chatty's current turn. Covers the loading/response/fallback/error
 * states docs/TESTING_STRATEGY.md calls for; "invalid output" from the AI
 * never reaches this component directly — `requestCompanionTurn` already
 * replaced it with authored fallback content, which renders identically to
 * any other companion turn (source is available in state for parent-facing
 * transparency UI, not shown to the child).
 */
export function CompanionBubble({ state, onChoose }: CompanionBubbleProps) {
  if (state.status === 'idle') {
    return null;
  }

  if (state.status === 'loading') {
    return (
      <div className={styles.bubble} aria-live="polite">
        <p className={styles.speaker}>Chatty the Parrot</p>
        <p className={styles.loading}>Chatty is thinking...</p>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className={styles.bubble} role="alert">
        <p className={styles.speaker}>Chatty the Parrot</p>
        <p className={styles.text}>Chatty is resting for a moment.</p>
      </div>
    );
  }

  const { turn, source } = state;

  return (
    <div className={styles.bubble} aria-live="polite" data-source={source}>
      <p className={styles.speaker}>Chatty the Parrot</p>
      <p className={styles.text}>{turn.spokenText}</p>
      {turn.choices?.length ? (
        <div className={styles.choices}>
          {turn.choices.map((choice) => (
            <button
              key={choice.id}
              type="button"
              className={styles.choiceButton}
              onClick={() => onChoose?.(choice.id)}
            >
              {choice.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
