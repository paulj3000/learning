import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import parentStyles from './ParentDashboard.module.css';
import styles from './ChildDashboard.module.css';
import { getChildProfile } from '../features/child-profile/api';
import type { ChildProfile } from '../features/child-profile/api';
import { listAllParentProfiles } from '../features/admin/api';
import type { ParentProfile } from '../features/admin/api';
import { listAllWorldChanges, listSessions, listSkillProgress } from '../features/adventures/api';
import type { AdventureSession, SkillProgress, WorldChange } from '../features/adventures/api';
import { LEARNING_OBJECTIVES, getAdventureTemplate } from '../features/adventures/content';
import { getIslandLocation } from '../features/island/locations';
import { AGE_BAND_LABELS, READING_MODE_OPTIONS } from '../features/child-profile/constants';

type LoadState = 'loading' | 'ready' | 'not-found' | 'error';

const SESSION_STATUS_LABELS: Record<AdventureSession['status'], string> = {
  ACTIVE: 'In progress',
  PAUSED: 'Paused',
  COMPLETED: 'Completed',
  ABANDONED: 'Not finished',
  SAFETY_STOPPED: 'Stopped for safety',
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
 * Read-only admin view of one child's learning progress
 * (docs/AUTHORIZATION_REVIEW.md section 4.3, CLAUDE.md section 9's "parent
 * dashboard summarizing activity by skill, not raw chat transcripts" — same
 * principle applied to the admin role). Deliberately a strict subset of
 * `ChildDashboard`: no AI on/off toggle, no retention/delete controls (those
 * remain parent-only actions), and no safety-event or saved-story content,
 * since `SafetyEvent`/`AIInteractionAudit`/`StoryArtifact` are not
 * admin-group readable (see the comment atop amplify/data/resource.ts) —
 * that review workflow is separate, not-yet-built scope.
 */
export function AdminChildProgress() {
  const { childId } = useParams<{ childId: string }>();
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [childProfile, setChildProfile] = useState<ChildProfile | null>(null);
  const [parentProfile, setParentProfile] = useState<ParentProfile | null>(null);
  const [sessions, setSessions] = useState<AdventureSession[]>([]);
  const [skillProgress, setSkillProgress] = useState<SkillProgress[]>([]);
  const [worldChanges, setWorldChanges] = useState<WorldChange[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!childId) {
        setLoadState('not-found');
        return;
      }
      try {
        const [profile, parents, sessionRows, skillRows, worldChangeRows] = await Promise.all([
          getChildProfile(childId),
          listAllParentProfiles(),
          listSessions(childId),
          listSkillProgress(childId),
          listAllWorldChanges(childId),
        ]);
        if (cancelled) return;
        if (!profile) {
          setLoadState('not-found');
          return;
        }
        setChildProfile(profile);
        setParentProfile(parents.find((parent) => parent.id === profile.parentProfileId) ?? null);
        setSessions(sessionRows);
        setSkillProgress(skillRows);
        setWorldChanges(worldChangeRows);
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

  return (
    <div className={parentStyles.page}>
      <header className={parentStyles.header}>
        <h1 className={parentStyles.title}>
          {childProfile ? `${childProfile.nickname}'s progress` : 'Child progress'}
        </h1>
        <Link to="/admin">Back to admin</Link>
      </header>
      <main className={parentStyles.main} id="main-content">
        {loadState === 'loading' ? <p>Loading progress...</p> : null}
        {loadState === 'not-found' ? (
          <p role="alert">We could not find that child profile.</p>
        ) : null}
        {loadState === 'error' ? (
          <p className={parentStyles.error} role="alert">
            Something went wrong loading this progress.
          </p>
        ) : null}

        {loadState === 'ready' && childProfile ? (
          <div className={styles.sections}>
            <section className={styles.section}>
              <h2 className={styles.heading}>Profile</h2>
              <p className={styles.summaryLine}>
                Parent: {parentProfile?.displayName ?? 'Unknown'}
              </p>
              <p className={styles.summaryLine}>{AGE_BAND_LABELS[childProfile.ageBand]}</p>
              <p className={styles.summaryLine}>
                {READING_MODE_OPTIONS.find((option) => option.value === childProfile.readingMode)
                  ?.label ?? childProfile.readingMode}
              </p>
              <p className={styles.summaryLine}>{childProfile.active ? 'Active' : 'Deactivated'}</p>
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
            </section>
          </div>
        ) : null}
      </main>
    </div>
  );
}
