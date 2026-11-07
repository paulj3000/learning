import { ManagerAudioControls } from '../../../../../../audio/ui';
import { PLAY_COPY } from '../../../../../region-play/regionPlayUi';
import { GameDialog } from './GameDialog';
import styles from './RegionPlayPanels.module.css';

/**
 * The child's sound settings inside Treasure Rush (SM-P5). The same shell as the backpack, so it
 * works on the stage in full screen, closes on Escape and hands focus back. The controls are the
 * shared audio controls bound to the Sound Manager; nothing about the game is touched.
 */
export function SoundPanel({ onClose }: { onClose(): void }) {
  return (
    <GameDialog titleId="region-play-sound-title" title={PLAY_COPY.soundTitle} onClose={onClose}>
      <ManagerAudioControls idPrefix="region-play-audio" />
      <div className={styles.actions}>
        <button type="button" className={styles.primary} onClick={onClose}>
          {PLAY_COPY.close}
        </button>
      </div>
    </GameDialog>
  );
}
