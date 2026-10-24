import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getChildProfile } from '../features/child-profile/api';
import type { ChildProfile } from '../features/child-profile/api';
import { listAllParentProfiles } from '../features/admin/api';
import type { ParentProfile } from '../features/admin/api';
import { listAllWorldChanges, listSessions } from '../features/adventures/api';
import type { AdventureSession, SkillProgress, WorldChange } from '../features/adventures/api';
import { listSkillProgress } from '../features/mastery/api';
import { LEARNING_OBJECTIVES, getAdventureTemplate } from '../features/adventures/content';
import { getIslandLocation } from '../features/island/locations';
import { AGE_BAND_LABELS, READING_MODE_OPTIONS } from '../features/child-profile/constants';
import { AdminPageHeader } from '../features/admin/AdminPageHeader';
import { Alert } from '../features/admin/ui/Alert';
import { Card, CardContent, CardHeader, CardTitle } from '../features/admin/ui/Card';

interface ProgressItem {
  key: string;
  title: string;
  meta: string;
}

/** One card of the progress page: a heading and a list, or a muted empty line. */
function ProgressSection({
  title,
  emptyText,
  items,
}: {
  title: string;
  emptyText: string;
  items: ProgressItem[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle asChild>
          <h2>{title}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyText}</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {items.map((item) => (
              <li className="grid gap-0.5 px-4 py-3" key={item.key}>
                <p className="font-medium">{item.title}</p>
                <p className="text-sm text-muted-foreground">{item.meta}</p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

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

  const profileFacts: { label: string; value: string }[] = childProfile
    ? [
        { label: 'Parent', value: parentProfile?.displayName ?? 'Unknown' },
        { label: 'Age band', value: AGE_BAND_LABELS[childProfile.ageBand] },
        {
          label: 'Reading mode',
          value:
            READING_MODE_OPTIONS.find((option) => option.value === childProfile.readingMode)
              ?.label ?? childProfile.readingMode,
        },
        { label: 'Status', value: childProfile.active ? 'Active' : 'Deactivated' },
      ]
    : [];

  return (
    <>
      <AdminPageHeader
        title={childProfile ? `${childProfile.nickname}'s progress` : 'Child progress'}
        back={{ to: '/admin', label: 'Back to families' }}
      />
      {loadState === 'loading' ? (
        <p className="text-sm text-muted-foreground">Loading progress...</p>
      ) : null}
      {loadState === 'not-found' ? (
        <Alert variant="destructive" role="alert">
          We could not find that child profile.
        </Alert>
      ) : null}
      {loadState === 'error' ? (
        <Alert variant="destructive" role="alert">
          Something went wrong loading this progress.
        </Alert>
      ) : null}

      {loadState === 'ready' && childProfile ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle asChild>
                <h2>Profile</h2>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
                {profileFacts.map((fact) => (
                  <div className="contents" key={fact.label}>
                    <dt className="text-muted-foreground">{fact.label}</dt>
                    <dd className="font-medium">{fact.value}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
          <ProgressSection
            title="Recent adventures"
            emptyText="No adventures started yet."
            items={sessions.slice(0, 8).map((session) => ({
              key: session.id,
              title: sessionTitle(session),
              meta: `${SESSION_STATUS_LABELS[session.status]} · ${formatDate(session.lastActivityAt)}`,
            }))}
          />
          <ProgressSection
            title="Skills practiced"
            emptyText="No skills practiced yet."
            items={skillProgress.map((row) => ({
              key: row.id,
              title: objectiveTitle(row.learningObjectiveCode),
              meta: skillProgressMeta(row),
            }))}
          />
          <ProgressSection
            title="Creations and world changes"
            emptyText="Nothing has changed on the island yet."
            items={worldChanges.map((change) => ({
              key: change.id,
              title: locationTitle(change.locationSlug),
              meta: formatDate(change.createdAt),
            }))}
          />
        </div>
      ) : null}
    </>
  );
}
