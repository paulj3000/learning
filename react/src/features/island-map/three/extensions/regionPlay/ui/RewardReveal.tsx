import type { AnswerOutcome, QuestEntry } from '../../../../../../api/play/types';
import { PLAY_COPY } from '../../../../../region-play/regionPlayUi';
import { GameDialog } from './GameDialog';
import styles from './RegionPlayPanels.module.css';

export interface RewardRevealProps {
  /** A correct outcome the server returned for an answer just submitted. */
  outcome: AnswerOutcome;
  /** Quests the server says this answer completed. */
  completed: readonly QuestEntry[];
  onClose(): void;
}

/**
 * The payoff (TR-8): the chest is open, here is what was inside, and the
 * quest is done. Everything shown is the server's outcome; the companion
 * only opens this once per attempt, after the server confirmed it.
 */
export function RewardReveal({ outcome, completed, onClose }: RewardRevealProps) {
  return (
    <GameDialog
      titleId="region-play-reward-title"
      title={PLAY_COPY.chestOpened}
      onClose={onClose}
      className={styles.reward}
    >
      {outcome.newItems.map((item) => (
        <div key={item.itemId}>
          <div className={styles.burst} aria-hidden="true">
            <div className={styles.doubloon} />
          </div>
          <p className={styles.speech}>{PLAY_COPY.youFound}</p>
          <p className={styles.itemName}>{item.displayName}</p>
          <p className={styles.speech}>{item.description}</p>
        </div>
      ))}
      {outcome.rewardMessage ? <p className={styles.speech}>{outcome.rewardMessage}</p> : null}
      {completed.map((quest) => (
        <p key={quest.questId} className={styles.questDone} role="status">
          {PLAY_COPY.questComplete} {quest.title}
        </p>
      ))}
      <div className={styles.actions} style={{ justifyContent: 'center' }}>
        <button type="button" className={styles.primary} onClick={onClose}>
          {PLAY_COPY.keepExploring}
        </button>
      </div>
    </GameDialog>
  );
}
