import type { LaunchPoint } from '../../../../../../api/play/types';
import { PLAY_COPY } from '../../../../../region-play/regionPlayUi';
import styles from './RegionPlayPanels.module.css';

export interface AdventureLaunchChoicesProps {
  /** Already filtered by the server for this child; shown in its order. */
  launches: readonly LaunchPoint[];
  /** The launch id being started, or null. Every button is disabled while one is. */
  starting: string | null;
  error: string | null;
  onStart(launchId: string): void;
}

/**
 * The Adventures an object in a 3D Area offers (ADR-041), as one button each. Shared by the NPC
 * dialog and the launch-object dialog, so there is one way to begin an Adventure from the world.
 * Beginning is always the child's tap; nothing here starts one on its own.
 */
export function AdventureLaunchChoices({
  launches,
  starting,
  error,
  onStart,
}: AdventureLaunchChoicesProps) {
  if (launches.length === 0) return null;
  return (
    <div className={styles.group}>
      {launches.map((launch) => (
        <div key={launch.launchId}>
          {launch.prompt ? <p className={styles.speech}>{launch.prompt}</p> : null}
          <button
            type="button"
            className={styles.primary}
            disabled={starting !== null}
            aria-busy={starting === launch.launchId}
            onClick={() => onStart(launch.launchId)}
          >
            {starting === launch.launchId ? PLAY_COPY.launchStarting : launch.label}
          </button>
        </div>
      ))}
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
