import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import parentStyles from './ParentDashboard.module.css';
import styles from './ChildDashboard.module.css';
import { getChildProfile, setChildProfileAIEnabled } from '../features/child-profile/api';
import type { ChildProfile } from '../features/child-profile/api';
import { deleteChildProfileData } from '../features/child-profile/deletion';
import { listAllWorldChanges, listSessions, listStoryArtifacts } from '../features/adventures/api';
import type {
  AdventureSession,
  SkillProgress,
  StoryArtifact,
  WorldChange,
} from '../features/adventures/api';
import { listSkillProgress } from '../features/mastery/api';
import { LEARNING_OBJECTIVES, getAdventureTemplate } from '../features/adventures/content';
import { getIslandLocation } from '../features/island/locations';
import { AGE_BAND_LABELS, READING_MODE_OPTIONS } from '../features/child-profile/constants';
import { buildWeeklySummary } from '../features/parent-dashboard/weeklySummary';
import { clearAIHistory, listSafetyEvents } from '../features/parent-dashboard/api';
import type { SafetyEvent } from '../features/parent-dashboard/api';

type LoadState = 'loading' | 'ready' | 'not-found' | 'error';

const SESSION_STATUS_LABELS: Record<AdventureSession['status'], string> = {
  ACTIVE: 'In progress',
  PAUSED: 'Paused',
  COMPLETED: 'Completed',
  ABANDONED: 'Not finished',
  SAFETY_STOPPED: 'Stopped for safety',
};

const SAFETY_SEVERITY_LABELS: Record<SafetyEvent['severity'], string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
};

const SAFETY_REVIEW_STATUS_LABELS: Record<SafetyEvent['reviewStatus'], string> = {
  OPEN: 'Not yet reviewed by our team',
  REVIEWED: 'Reviewed',
  DISMISSED: 'Reviewed, no action needed',
};

function formatDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function sessionTitle(session: AdventureSession): string {
  return getAdventureTemplate(session.templateSlug)?.title ?? session.templateSlug;
}

function objectiveTitle(code: string): string {
  return LEARNING_OBJECTIVES.find((objective) => objective.code === code)?.title ?? code;
}

function locationTitle(slug: string): string {
  return getIslandLocation(slug)?.title ?? slug;
}

function skillProgressMeta(row: SkillProgress): string {
  const parts = [`Practiced ${row.exposureCount} ${row.exposureCount === 1 ? 'time' : 'times'}`];
  if (row.supportedSuccessCount > 0) {
    parts.push(
      `needed a hint ${row.supportedSuccessCount} ${row.supportedSuccessCount === 1 ? 'time' : 'times'}`,
    );
  }
  if (row.independentSuccessCount > 0) {
    parts.push(
      `solved it alone ${row.independentSuccessCount} ${
        row.independentSuccessCount === 1 ? 'time' : 'times'
      }`,
    );
  }
  return parts.join(' · ');
}

/**
 * Per-child parent dashboard (docs/ROADMAP.md Phase 7): recent adventures,
 * skills practiced with their support/hint pattern, creations and world
 * changes, a plain-language weekly summary, and controls for AI, voice,
 * session time, and retention. Everything shown is aggregated from records
 * already collected by earlier phases (`AdventureSession`, `SkillProgress`,
 * `WorldChange`, `StoryArtifact`) — this route adds no new gameplay data,
 * only a parent-facing view over it, per CLAUDE.md section 9's "parent
 * dashboard summarizing activity by skill, not raw chat transcripts."
 */
export function ChildDashboard() {
  const { childId } = useParams<{ childId: string }>();
  const navigate = useNavigate();
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [childProfile, setChildProfile] = useState<ChildProfile | null>(null);
  const [sessions, setSessions] = useState<AdventureSession[]>([]);
  const [skillProgress, setSkillProgress] = useState<SkillProgress[]>([]);
  const [worldChanges, setWorldChanges] = useState<WorldChange[]>([]);
  const [stories, setStories] = useState<StoryArtifact[]>([]);
  const [safetyEvents, setSafetyEvents] = useState<SafetyEvent[]>([]);
  const [savingAI, setSavingAI] = useState(false);
  const [confirmingClearHistory, setConfirmingClearHistory] = useState(false);
  const [clearingHistory, setClearingHistory] = useState(false);
  const [historyCleared, setHistoryCleared] = useState(false);
  const [confirmingDeleteChild, setConfirmingDeleteChild] = useState(false);
  const [deletingChild, setDeletingChild] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!childId) {
        setLoadState('not-found');
        return;
      }
      try {
        const [profile, sessionRows, skillRows, worldChangeRows, storyRows, safetyEventRows] =
          await Promise.all([
            getChildProfile(childId),
            listSessions(childId),
            listSkillProgress(childId),
            listAllWorldChanges(childId),
            listStoryArtifacts(childId),
            listSafetyEvents(childId),
          ]);
        if (cancelled) return;
        if (!profile) {
          setLoadState('not-found');
          return;
        }
        setChildProfile(profile);
        setSessions(sessionRows);
        setSkillProgress(skillRows);
        setWorldChanges(worldChangeRows);
        setStories(storyRows);
        setSafetyEvents(safetyEventRows);
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
  }, [childId]);

  async function handleToggleAI() {
    if (!childProfile) return;
    setSavingAI(true);
    try {
      const updated = await setChildProfileAIEnabled(
        childProfile.id,
        !(childProfile.aiEnabled ?? true),
      );
      setChildProfile(updated);
    } finally {
      setSavingAI(false);
    }
  }

  async function handleClearHistory() {
    if (!childProfile) return;
    setClearingHistory(true);
    try {
      await clearAIHistory(childProfile.id);
      setConfirmingClearHistory(false);
      setHistoryCleared(true);
    } finally {
      setClearingHistory(false);
    }
  }

  async function handleDeleteChild() {
    if (!childProfile) return;
    setDeletingChild(true);
    setDeleteError(null);
    try {
      await deleteChildProfileData(childProfile.id);
      navigate('/home');
    } catch (error) {
      setDeleteError(
        error instanceof Error ? error.message : 'Could not delete this child profile.',
      );
      setDeletingChild(false);
    }
  }

  const aiEnabled = childProfile?.aiEnabled ?? true;

  const weeklySummary = childProfile
    ? buildWeeklySummary({
        nickname: childProfile.nickname,
        sessions,
        worldChanges,
        skillProgress,
        stories,
        now: new Date(),
      })
    : [];

  return (
    <div className={parentStyles.page}>
      <header className={parentStyles.header}>
        <h1 className={parentStyles.title}>
          {childProfile ? `${childProfile.nickname}'s activity` : 'Activity and controls'}
        </h1>
        <Link to="/home">Back to dashboard</Link>
      </header>
      <main className={parentStyles.main} id="main-content">
        {loadState === 'loading' ? <p>Loading activity...</p> : null}
        {loadState === 'not-found' ? (
          <p role="alert">We could not find that child profile.</p>
        ) : null}
        {loadState === 'error' ? (
          <p className={parentStyles.error} role="alert">
            Something went wrong loading this activity.
          </p>
        ) : null}

        {loadState === 'ready' && childProfile ? (
          <div className={styles.sections}>
            <section className={styles.section}>
              <h2 className={styles.heading}>This week</h2>
              {weeklySummary.map((line) => (
                <p className={styles.summaryLine} key={line}>
                  {line}
                </p>
              ))}
            </section>

            <section className={styles.section}>
              <h2 className={styles.heading}>Recent adventures</h2>
              {sessions.length === 0 ? (
                <p className={styles.hint}>No adventures started yet.</p>
              ) : (
                <ul className={styles.list}>
                  {sessions.slice(0, 8).map((session) => (
                    <li className={styles.card} key={session.id}>
                      <p className={styles.cardTitle}>{sessionTitle(session)}</p>
                      <p className={styles.cardMeta}>
                        {SESSION_STATUS_LABELS[session.status]} &middot;{' '}
                        {formatDate(session.lastActivityAt)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className={styles.section}>
              <h2 className={styles.heading}>Skills practiced</h2>
              {skillProgress.length === 0 ? (
                <p className={styles.hint}>No skills practiced yet.</p>
              ) : (
                <ul className={styles.list}>
                  {skillProgress.map((row) => (
                    <li className={styles.card} key={row.id}>
                      <p className={styles.cardTitle}>
                        {objectiveTitle(row.learningObjectiveCode)}
                      </p>
                      <p className={styles.cardMeta}>{skillProgressMeta(row)}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className={styles.section}>
              <h2 className={styles.heading}>Creations and world changes</h2>
              {worldChanges.length === 0 ? (
                <p className={styles.hint}>Nothing has changed on the island yet.</p>
              ) : (
                <ul className={styles.list}>
                  {worldChanges.map((change) => (
                    <li className={styles.card} key={change.id}>
                      <p className={styles.cardTitle}>{locationTitle(change.locationSlug)}</p>
                      <p className={styles.cardMeta}>{formatDate(change.createdAt)}</p>
                    </li>
                  ))}
                </ul>
              )}
              {stories.length > 0 ? (
                <Link className={styles.link} to={`/home/children/${childProfile.id}/stories`}>
                  View {stories.length} saved {stories.length === 1 ? 'story' : 'stories'}
                </Link>
              ) : null}
            </section>

            <section className={styles.section}>
              <h2 className={styles.heading}>Safety check-ins</h2>
              <p className={styles.hint}>
                Sometimes Chatty's AI response does not pass our safety checks. When that happens,
                Chatty always uses a pre-written, reviewed reply instead, so your child never sees
                an unchecked response. Here is when that happened for {childProfile.nickname}.
              </p>
              {safetyEvents.length === 0 ? (
                <p className={styles.hint}>No safety check-ins yet.</p>
              ) : (
                <ul className={styles.list}>
                  {safetyEvents.map((event) => (
                    <li className={styles.card} key={event.id}>
                      <p className={styles.cardTitle}>
                        {SAFETY_SEVERITY_LABELS[event.severity]} &middot;{' '}
                        {formatDate(event.createdAt)}
                      </p>
                      <p className={styles.cardMeta}>{event.actionTaken}</p>
                      <p className={styles.cardMeta}>
                        {SAFETY_REVIEW_STATUS_LABELS[event.reviewStatus]}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className={styles.section}>
              <h2 className={styles.heading}>Controls</h2>

              <div className={styles.controlRow}>
                <div>
                  <p className={styles.controlLabel}>AI-powered companion dialogue</p>
                  <p className={styles.hint}>
                    {aiEnabled
                      ? 'Chatty may use AI to vary hints, celebrations, and narration.'
                      : 'AI is off. Chatty only uses pre-written lines.'}
                  </p>
                </div>
                <button
                  className={styles.buttonSecondary}
                  type="button"
                  disabled={savingAI}
                  onClick={() => void handleToggleAI()}
                >
                  {aiEnabled ? 'Turn AI off' : 'Turn AI on'}
                </button>
              </div>

              <div className={styles.controlRow}>
                <div>
                  <p className={styles.controlLabel}>Voice and reading mode</p>
                  <p className={styles.hint}>
                    Currently:{' '}
                    {READING_MODE_OPTIONS.find(
                      (option) => option.value === childProfile.readingMode,
                    )?.label ?? childProfile.readingMode}
                  </p>
                </div>
                <Link
                  className={styles.buttonSecondary}
                  to={`/home/children/${childProfile.id}/edit`}
                >
                  Change
                </Link>
              </div>

              <div className={styles.controlRow}>
                <div>
                  <p className={styles.controlLabel}>Session time</p>
                  <p className={styles.hint}>
                    {childProfile.sessionMinutes} minutes per visit (
                    {AGE_BAND_LABELS[childProfile.ageBand]})
                  </p>
                </div>
                <Link
                  className={styles.buttonSecondary}
                  to={`/home/children/${childProfile.id}/edit`}
                >
                  Change
                </Link>
              </div>

              <div className={styles.controlRow}>
                <div>
                  <p className={styles.controlLabel}>AI interaction history</p>
                  <p className={styles.hint}>
                    {historyCleared
                      ? 'Cleared.'
                      : 'Delete the stored record of AI hints, celebrations, and safety checks for this child. Saved stories are managed on the story keepsakes page.'}
                  </p>
                </div>
                {confirmingClearHistory ? (
                  <div className={styles.confirm} role="alert">
                    <p className={styles.confirmText}>Delete this history for good?</p>
                    <button
                      className={styles.buttonDanger}
                      type="button"
                      disabled={clearingHistory}
                      onClick={() => void handleClearHistory()}
                    >
                      Yes, delete
                    </button>
                    <button
                      className={styles.buttonSecondary}
                      type="button"
                      onClick={() => setConfirmingClearHistory(false)}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    className={styles.buttonDanger}
                    type="button"
                    disabled={historyCleared}
                    onClick={() => setConfirmingClearHistory(true)}
                  >
                    Clear history
                  </button>
                )}
              </div>

              <div className={styles.controlRow}>
                <div>
                  <p className={styles.controlLabel}>Delete this child's account</p>
                  <p className={styles.hint}>
                    Permanently deletes every adventure, saved story, skill record, and world change
                    for {childProfile.nickname}. This cannot be undone.
                  </p>
                  {deleteError ? (
                    <p className={parentStyles.error} role="alert">
                      {deleteError}
                    </p>
                  ) : null}
                </div>
                {confirmingDeleteChild ? (
                  <div className={styles.confirm} role="alert">
                    <p className={styles.confirmText}>
                      Delete {childProfile.nickname}'s account and all data for good?
                    </p>
                    <button
                      className={styles.buttonDanger}
                      type="button"
                      disabled={deletingChild}
                      onClick={() => void handleDeleteChild()}
                    >
                      Yes, delete everything
                    </button>
                    <button
                      className={styles.buttonSecondary}
                      type="button"
                      onClick={() => setConfirmingDeleteChild(false)}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    className={styles.buttonDanger}
                    type="button"
                    onClick={() => setConfirmingDeleteChild(true)}
                  >
                    Delete permanently
                  </button>
                )}
              </div>
            </section>
          </div>
        ) : null}
      </main>
    </div>
  );
}
