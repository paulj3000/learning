import { PLAY_COPY } from '../../../../../region-play/regionPlayUi';
import { GameDialog } from './GameDialog';
import styles from './RegionPlayPanels.module.css';

export interface ReplayDonePanelProps {
  label: string;
  /** Asks the server for another round. */
  onAgain(): void;
  onClose(): void;
  busy?: boolean;
}

/**
 * What a right answer shows at the Lookout spyglass (TR-20). The activity can be played as often
 * as the child likes, so there is no chest and no reward reveal: the server granted nothing, and
 * the panel says so kindly instead of pretending otherwise.
 */
export function ReplayDonePanel({ label, onAgain, onClose, busy = false }: ReplayDonePanelProps) {
  return (
    <GameDialog titleId="region-play-replay-title" title={PLAY_COPY.replayGreat} onClose={onClose}>
      <p className={styles.speech} role="status">
        {PLAY_COPY.replayNote}
      </p>
      <div className={styles.actions}>
        <button type="button" className={styles.primary} onClick={onAgain} disabled={busy}>
          {PLAY_COPY.replayAgain}
        </button>
        <button type="button" className={styles.button} onClick={onClose}>
          {PLAY_COPY.close}
        </button>
      </div>
      <span className={styles.visuallyHidden}>{label}</span>
    </GameDialog>
  );
}
