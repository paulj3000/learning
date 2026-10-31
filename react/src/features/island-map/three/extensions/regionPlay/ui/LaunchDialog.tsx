import type { LaunchPoint } from '../../../../../../api/play/types';
import { PLAY_COPY } from '../../../../../region-play/regionPlayUi';
import { AdventureLaunchChoices } from './AdventureLaunchChoices';
import { GameDialog } from './GameDialog';
import styles from './RegionPlayPanels.module.css';

export interface LaunchDialogProps {
  /** The object's child-facing label ("Bridge signpost"). */
  label: string;
  launches: readonly LaunchPoint[];
  starting: string | null;
  error: string | null;
  onStart(launchId: string): void;
  onClose(): void;
}

/** A sign, door or other object that begins one of this Place's Adventures (ADR-041). */
export function LaunchDialog({
  label,
  launches,
  starting,
  error,
  onStart,
  onClose,
}: LaunchDialogProps) {
  return (
    <GameDialog titleId="region-play-launch-title" title={label} onClose={onClose}>
      <AdventureLaunchChoices
        launches={launches}
        starting={starting}
        error={error}
        onStart={onStart}
      />
      <div className={styles.actions}>
        <button type="button" className={styles.button} onClick={onClose}>
          {PLAY_COPY.launchNotNow}
        </button>
      </div>
    </GameDialog>
  );
}
