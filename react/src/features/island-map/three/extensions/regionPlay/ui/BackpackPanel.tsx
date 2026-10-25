import type { PlayerProgressState } from '../../../../../region-play/usePlayerProgress';
import { PLAY_COPY, playErrorMessage, questStatusLabel } from '../../../../../region-play/regionPlayUi';
import { GameDialog } from './GameDialog';
import styles from './RegionPlayPanels.module.css';

export interface BackpackPanelProps {
  progress: PlayerProgressState;
  onClose(): void;
}

/**
 * What the child has collected and the quests they are on (TR-8), straight
 * from `GET progress/` (TR-6). There is no second inventory: this only shows
 * what the server reports. Picture-first: a coin for each keepsake, a tick
 * for each finished quest, with the words beside them for a grown-up to read.
 */
export function BackpackPanel({ progress, onClose }: BackpackPanelProps) {
  const data = progress.progress;
  const error = playErrorMessage(progress.error);
  return (
    <GameDialog titleId="region-play-backpack-title" title={PLAY_COPY.backpackTitle} onClose={onClose}>
      {progress.status === 'loading' && !data ? <p className={styles.speech}>{PLAY_COPY.chestWaiting}</p> : null}
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      {data ? (
        <>
          {data.inventory.length === 0 ? (
            <p className={styles.speech}>{PLAY_COPY.backpackEmpty}</p>
          ) : (
            <ul className={styles.list} aria-label={PLAY_COPY.backpackTitle}>
              {data.inventory.map((entry) => (
                <li key={entry.item.itemId} className={styles.listItem}>
                  <span className={styles.itemIcon} aria-hidden="true" />
                  <span>{entry.item.displayName}</span>
                </li>
              ))}
            </ul>
          )}
          {data.quests.length > 0 ? (
            <>
              <h3 className={styles.speech}>{PLAY_COPY.myQuests}</h3>
              <ul className={styles.list} aria-label={PLAY_COPY.myQuests}>
                {data.quests.map((quest) => (
                  <li key={quest.questId} className={styles.listItem}>
                    <span
                      className={[styles.mark, quest.status === 'COMPLETED' ? styles.markDone : ''].join(' ')}
                      aria-hidden="true"
                    >
                      {quest.status === 'COMPLETED' ? '✓' : ''}
                    </span>
                    <span>{quest.title}</span>
                    <span className={styles.status}>{questStatusLabel(quest.status)}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </>
      ) : null}
      <div className={styles.actions}>
        <button type="button" className={styles.primary} onClick={onClose}>
          {PLAY_COPY.close}
        </button>
      </div>
    </GameDialog>
  );
}
