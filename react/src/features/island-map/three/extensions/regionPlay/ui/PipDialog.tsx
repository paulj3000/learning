import { useState } from 'react';
import type { DialogueNodeView, LaunchPoint, QuestEntry } from '../../../../../../api/play/types';
import { PLAY_COPY } from '../../../../../region-play/regionPlayUi';
import { AdventureLaunchChoices } from './AdventureLaunchChoices';
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
  /** TR-14: where the next treasure is, in Pip's words (the server's clue). */
  clue?: string | null;
  /** Adventures this NPC can begin (ADR-041); absent or empty shows nothing extra. */
  launches?: readonly LaunchPoint[];
  launchStarting?: string | null;
  launchError?: string | null;
  onLaunch?(launchId: string): void;
  /**
   * The NPC's own authored lines (ADR-043), when the server sends them: the first one that is
   * not a follow-up is how they greet the child, and its choices can lead to follow-ups.
   * Without them the built-in Treasure Rush lines are used, as before.
   */
  dialogue?: readonly DialogueNodeView[];
  /** What to do next in the quest, in this NPC's words (the current stage's authored intro). */
  stageLine?: string | null;
  /** A "come back and show me" stage this NPC completes (Firepeak stage 5). */
  returnAction?: { label: string; busy: boolean; onReturn(): void } | null;
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
  clue = null,
  launches = [],
  launchStarting = null,
  launchError = null,
  onLaunch,
  dialogue = [],
  stageLine = null,
  returnAction = null,
}: PipDialogProps) {
  const quest =
    quests.find((q) => q.status === 'AVAILABLE') ??
    quests.find((q) => q.status === 'ACTIVE') ??
    quests[0];
  const greeting = dialogue.find((node) => !node.followUpOnly) ?? null;
  const [nodeId, setNodeId] = useState<string | null>(null);
  const node = dialogue.find((candidate) => candidate.nodeId === nodeId) ?? greeting;

  return (
    <GameDialog titleId="region-play-npc-title" title={name} onClose={onClose}>
      {node ? (
        <>
          <p className={styles.speech}>{node.text}</p>
          {node.choices.some((choice) => choice.nextNodeId) ? (
            <div className={styles.actions}>
              {node.choices
                .filter((choice) => choice.nextNodeId)
                .map((choice) => (
                  <button
                    key={choice.choiceId}
                    type="button"
                    className={styles.button}
                    onClick={() => setNodeId(choice.nextNodeId)}
                  >
                    {choice.label}
                  </button>
                ))}
            </div>
          ) : null}
        </>
      ) : null}
      {!quest && !node ? <p className={styles.speech}>{PLAY_COPY.pipNoQuest}</p> : null}
      {returnAction ? (
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.primary}
            disabled={returnAction.busy}
            aria-busy={returnAction.busy}
            onClick={returnAction.onReturn}
          >
            {returnAction.label}
          </button>
        </div>
      ) : null}

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
            {stageLine ?? PLAY_COPY.pipActive}
          </p>
          {clue ? (
            <p className={styles.speech}>
              {PLAY_COPY.pipClue} {clue}
            </p>
          ) : null}
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
          <p className={styles.speech}>
            {greeting ? `${PLAY_COPY.questComplete} ${quest.title}` : PLAY_COPY.pipCompleted}
          </p>
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

      {onLaunch ? (
        <AdventureLaunchChoices
          launches={launches}
          starting={launchStarting}
          error={launchError}
          onStart={onLaunch}
        />
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
