import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import styles from './QuestJournal.module.css';
import { IslandLayout } from '../features/island/IslandLayout';
import { buildQuestJournal } from '../features/quests/journal';
import {
  buildQuestContext,
  listQuestStates,
  startQuest,
  syncQuestProgress,
} from '../features/quests/api';
import { QUEST_DEFINITIONS, getQuestDefinition } from '../features/quests/content';
import { findNpc } from '../features/npc/content';
import { getChildProfile } from '../features/child-profile/api';
import type { QuestJournalEntry } from '../features/quests/journal';

type LoadState = 'loading' | 'ready' | 'error';

const STATUS_LABELS: Record<QuestJournalEntry['status'], string> = {
  ACTIVE: 'Doing now',
  AVAILABLE: 'You can start this',
  COMPLETED: 'Finished',
};

/**
 * The child-facing quest journal (docs/ROADMAP.md Phase 25).
 *
 * "Resume" needs no cursor: the journal is projected from world state every
 * time it is opened, so a child sees credit for anything they did since they
 * last looked. It also persists that projection on open (`syncQuestProgress`)
 * so a quest finished by wandering gets its world changes and rewards even if
 * the child never returns to the adventure that completed it.
 *
 * An `AVAILABLE` quest can be started from here (Phase 29). Until a second
 * world existed, every startable quest was either offered by an NPC in a
 * conversation or opened by a discovery, so this screen could label a quest
 * "You can start this" and leave it at that. Creature Care Cove has neither
 * an explorable map nor a character to talk to, so its quest had no entrance
 * at all: the journal was showing a door with no handle. Starting a quest
 * here changes nothing about how progress works, since objectives stay
 * derived from world state either way.
 */
export function QuestJournal() {
  const { childId } = useParams<{ childId: string }>();
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [entries, setEntries] = useState<QuestJournalEntry[]>([]);
  const [startingQuestId, setStartingQuestId] = useState<string | null>(null);
  const [startError, setStartError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const handleStart = useCallback(
    async (questId: string) => {
      const definition = getQuestDefinition(questId);
      if (!childId || !definition) return;
      setStartingQuestId(questId);
      setStartError(false);
      try {
        await startQuest(childId, definition);
        // Reload rather than patch state locally: the first stage may already
        // be complete from work the child did before accepting, and only a
        // fresh projection knows that.
        setReloadKey((key) => key + 1);
      } catch {
        setStartError(true);
      } finally {
        setStartingQuestId(null);
      }
    },
    [childId],
  );

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!childId) return;
      try {
        // Persist first, then read: a quest that finished elsewhere should
        // already show as finished the moment the journal opens.
        await syncQuestProgress(childId).catch(() => undefined);
        const [context, states, child] = await Promise.all([
          buildQuestContext(childId),
          listQuestStates(childId),
          // The journal hides quests authored for other age bands, matching
          // what the NPCs will actually offer and what the world will let the
          // child start (`buildQuestJournal`).
          getChildProfile(childId),
        ]);
        if (cancelled) return;
        if (!child) {
          setLoadState('error');
          return;
        }
        setEntries(buildQuestJournal(QUEST_DEFINITIONS, states, context, child.ageBand));
        setLoadState('ready');
      } catch {
        if (cancelled) return;
        setLoadState('error');
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [childId, reloadKey]);

  if (!childId) {
    return null;
  }

  return (
    <IslandLayout childId={childId}>
      <div className={styles.content}>
        <h1 className={styles.heading}>Quest journal</h1>

        {loadState === 'loading' ? <p className={styles.lead}>Loading your quests...</p> : null}
        {loadState === 'error' ? (
          <p className={styles.lead} role="alert">
            Something went wrong loading your quests.
          </p>
        ) : null}
        {startError ? (
          <p className={styles.lead} role="alert">
            We could not start that quest. Try again in a moment.
          </p>
        ) : null}
        {loadState === 'ready' && entries.length === 0 ? (
          <p className={styles.lead}>
            No quests yet. Talk to the people on the island and someone will ask for your help.
          </p>
        ) : null}

        {loadState === 'ready' && entries.length > 0 ? (
          <ul className={styles.list}>
            {entries.map((entry) => {
              const giver = entry.giverNpcId ? findNpc(entry.giverNpcId) : null;
              return (
                <li className={styles.entry} key={entry.questId}>
                  <p className={styles.entryStatus}>{STATUS_LABELS[entry.status]}</p>
                  <h2 className={styles.entryTitle}>{entry.title}</h2>
                  <p className={styles.entrySummary}>{entry.summary}</p>
                  {giver ? <p className={styles.entryMeta}>Asked by {giver.displayName}</p> : null}

                  {entry.stageTitle ? (
                    <p className={styles.stageTitle}>Now: {entry.stageTitle}</p>
                  ) : null}

                  {entry.objectives.length > 0 ? (
                    <ul className={styles.objectives}>
                      {entry.objectives.map((objective) => (
                        <li className={styles.objective} key={objective.id}>
                          <span className={styles.check} aria-hidden="true">
                            {objective.done ? '✓' : '○'}
                          </span>
                          <span className={objective.done ? styles.objectiveDone : undefined}>
                            {objective.label}
                            {objective.optional ? ' (if you want to)' : ''}
                          </span>
                          <span className={styles.visuallyHidden}>
                            {objective.done ? ' - done' : ' - not done yet'}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  {entry.journalNote ? (
                    <p className={styles.entryNote}>{entry.journalNote}</p>
                  ) : null}

                  {entry.status === 'AVAILABLE' ? (
                    <button
                      className={styles.startButton}
                      type="button"
                      /*
                        Several quests can be available at once, so the visible
                        label alone would name every button the same thing for
                        a screen reader. The visible text stays inside the
                        accessible name rather than being replaced by it.
                      */
                      aria-label={`Start this quest: ${entry.title}`}
                      onClick={() => void handleStart(entry.questId)}
                      disabled={startingQuestId === entry.questId}
                    >
                      {startingQuestId === entry.questId ? 'Starting...' : 'Start this quest'}
                    </button>
                  ) : null}

                  {entry.status === 'ACTIVE' ? (
                    <p className={styles.entryMeta}>
                      Part {Math.min(entry.stagesCompleted + 1, entry.stageCount)} of{' '}
                      {entry.stageCount}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}

        <Link className={styles.backLink} to={`/island/${childId}`}>
          Back to the map
        </Link>
      </div>
    </IslandLayout>
  );
}
