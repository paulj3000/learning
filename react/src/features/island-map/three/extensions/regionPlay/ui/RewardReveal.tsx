import type { CompletionReward, ItemView, QuestEntry } from '../../../../../../api/play/types';
import { PLAY_COPY } from '../../../../../region-play/regionPlayUi';
import { GameDialog } from './GameDialog';
import styles from './RegionPlayPanels.module.css';

export interface RewardRevealProps {
  /**
   * What the server granted for something just done here: a correct answer, a pickup (TR-14),
   * or finishing a quest (its `completionRewards`).
   */
  outcome: {
    newItems: readonly ItemView[];
    rewardMessage: string | null;
    completionRewards?: readonly CompletionReward[];
  };
  /** Quests the server says this completed. */
  completed: readonly QuestEntry[];
  onClose(): void;
  /** Defaults to "Click! The chest is open!". A puzzle names its own moment (ADR-047 F). */
  title?: string;
  /**
   * A line before the items, such as Pip's thanks at the finale or a puzzle's authored
   * `completeMessage` (ADR-047 F).
   */
  lead?: string | null;
}

/**
 * The payoff (TR-8): the chest is open, here is what was inside, and the
 * quest is done. Everything shown is the server's outcome; the companion
 * only opens this once per attempt, after the server confirmed it.
 */
export function RewardReveal({
  outcome,
  completed,
  onClose,
  title = PLAY_COPY.chestOpened,
  lead,
}: RewardRevealProps) {
  const completionItems = (outcome.completionRewards ?? []).flatMap((reward) => reward.items);
  return (
    <GameDialog
      titleId="region-play-reward-title"
      title={title}
      onClose={onClose}
      className={styles.reward}
    >
      {lead ? <p className={styles.speech}>{lead}</p> : null}
      {[...outcome.newItems, ...completionItems].map((item) => (
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
      {(outcome.completionRewards ?? []).map((reward) =>
        reward.message ? (
          <p key={reward.ruleId} className={styles.speech}>
            {reward.message}
          </p>
        ) : null,
      )}
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
