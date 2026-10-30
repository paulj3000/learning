import type { QuestEntry } from '../../../../../../api/play/types';
import { PLAY_COPY } from '../../../../../region-play/regionPlayUi';
import { GameDialog } from './GameDialog';
import styles from './RegionPlayPanels.module.css';

export interface PipDialogProps {
  /** The NPC's name as the server gives it ("Pirate Pip"). */
  name: string;
  /** This NPC's quests as the server reports them: offers and progress. */
  quests: readonly QuestEntry[];
  /** True while accepting is in flight: the button is disabled, so a double tap sends one request. */
  accepting: boolean;
  /** True right after this child accepted here, to say so; a returning visit just shows the steps. */
  justAccepted?: boolean;
  error: string | null;
  onAccept(questId: string): void;
  onClose(): void;
}

/**
 * Talking to a quest giver (TR-8). What they say follows the quest's
 * server state: an offer the child may accept, the steps of a quest they
 * are on (ticked as the server completes them), or thanks for a finished
 * one. Accepting is always the child's choice; nothing here starts a quest
 * on its own.
 */
export function PipDialog({
  name,
  quests,
  accepting,
  justAccepted = false,
  error,
  onAccept,
  onClose,
}: PipDialogProps) {
  const quest =
    quests.find((q) => q.status === 'AVAILABLE') ??
    quests.find((q) => q.status === 'ACTIVE') ??
    quests[0];

  return (
    <GameDialog titleId="region-play-npc-title" title={name} onClose={onClose}>
      {!quest ? <p className={styles.speech}>{PLAY_COPY.pipNoQuest}</p> : null}

      {quest?.status === 'AVAILABLE' ? (
        <>
          <p className={styles.speech}>
            {quest.summary} {PLAY_COPY.pipAsk}
          </p>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.primary}
              disabled={accepting}
              aria-busy={accepting}
              onClick={() => onAccept(quest.questId)}
            >
              {PLAY_COPY.pipAccept}
            </button>
            <button type="button" className={styles.button} onClick={onClose}>
              {PLAY_COPY.pipLater}
            </button>
          </div>
        </>
      ) : null}

      {quest?.status === 'ACTIVE' ? (
        <>
          <p className={styles.speech} role="status">
            {justAccepted ? `${PLAY_COPY.questAccepted} ` : ''}
            {PLAY_COPY.pipActive}
          </p>
          <QuestSteps quest={quest} />
          <div className={styles.actions}>
            <button type="button" className={styles.primary} onClick={onClose}>
              {PLAY_COPY.keepExploring}
            </button>
          </div>
        </>
      ) : null}

      {quest?.status === 'COMPLETED' ? (
        <>
          <p className={styles.speech}>{PLAY_COPY.pipCompleted}</p>
          <QuestSteps quest={quest} />
          <div className={styles.actions}>
            <button type="button" className={styles.primary} onClick={onClose}>
              {PLAY_COPY.keepExploring}
            </button>
          </div>
        </>
      ) : null}

      {!quest ? (
        <div className={styles.actions}>
          <button type="button" className={styles.primary} onClick={onClose}>
            {PLAY_COPY.close}
          </button>
        </div>
      ) : null}

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </GameDialog>
  );
}

/** A quest's objectives with a tick for each the server has completed. */
export function QuestSteps({ quest }: { quest: QuestEntry }) {
  const objectives = quest.stages.flatMap((stage) => stage.objectives);
  return (
    <ul className={styles.list} aria-label={quest.title}>
      {objectives.map((objective) => (
        <li key={objective.id} className={styles.listItem}>
          <span
            className={[styles.mark, objective.complete ? styles.markDone : ''].join(' ')}
            aria-hidden="true"
          >
            {objective.complete ? '✓' : ''}
          </span>
          <span>{objective.label}</span>
          <span className={styles.visuallyHidden}>
            {objective.complete ? PLAY_COPY.questDone : PLAY_COPY.questDoing}
          </span>
        </li>
      ))}
    </ul>
  );
}
