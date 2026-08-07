import styles from './HintPanel.module.css';
import { MAX_HINT_LEVEL } from './engine/hints';

interface HintPanelProps {
  hintLevel: number;
  hintText: string | undefined;
  disabled: boolean;
  onRequestHint: () => void;
}

export function HintPanel({ hintLevel, hintText, disabled, onRequestHint }: HintPanelProps) {
  return (
    <div className={styles.panel}>
      {hintText ? <p className={styles.hintText}>{hintText}</p> : null}
      {hintLevel < MAX_HINT_LEVEL ? (
        <button className={styles.button} type="button" disabled={disabled} onClick={onRequestHint}>
          {hintLevel === 0 ? 'Need a hint?' : 'Need another hint?'}
        </button>
      ) : null}
    </div>
  );
}
