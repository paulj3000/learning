import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import styles from './ParentDashboard.module.css';
import { listChildProfiles } from '../features/child-profile/api';
import type { ChildProfile } from '../features/child-profile/api';
import { startCoopSession } from '../features/coop/api';
import type { CoopSession } from '../features/coop/api';
import { REPAIR_THE_MOONLIGHT_BRIDGE } from '../features/adventures/content';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * The one proven coop-eligible adventure so far (docs/ADVENTURE_ENGINE.md
 * "Co-op sessions"): "Repair the Moonlight Bridge" has a `NUMBER_INPUT`
 * step (count-planks), an `ORDERING` step (order-planks), and a
 * shared-construction `WORLD_CHANGE` step (bridge-repaired) —
 * `useAdventureSession.ts` claims a coop slot on any of those when a
 * `coopSessionId` is present. Restricting the picker to this template (and
 * to Pathfinder-band children, matching its own `ageBands`) keeps this
 * entry point from offering a shared session an adventure can't actually
 * support yet.
 */
const COOP_TEMPLATE = REPAIR_THE_MOONLIGHT_BRIDGE;

/**
 * Parent-facing entry point to start a household coop session between two
 * of the signed-in parent's own children (docs/DATA_MODEL.md CoopSession:
 * "no invite or matchmaking system, since v1 is household-only and the
 * parent already owns both profiles"). Deliberately just two launch links
 * rather than any live handoff — both children are expected to be in the
 * same household, playing on their own devices or turns, with the parent
 * supervising.
 */
export function CoopSessionNew() {
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [eligibleChildren, setEligibleChildren] = useState<ChildProfile[]>([]);
  const [childAId, setChildAId] = useState('');
  const [childBId, setChildBId] = useState('');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [launchedSession, setLaunchedSession] = useState<CoopSession | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const children = await listChildProfiles();
        if (cancelled) return;
        setEligibleChildren(
          children.filter(
            (child) => child.active && COOP_TEMPLATE.ageBands.includes(child.ageBand),
          ),
        );
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
  }, []);

  async function handleStart(event: FormEvent) {
    event.preventDefault();
    if (!childAId || !childBId || childAId === childBId) return;
    setStarting(true);
    setError(null);
    try {
      const session = await startCoopSession(COOP_TEMPLATE.slug, COOP_TEMPLATE.version, [
        childAId,
        childBId,
      ]);
      setLaunchedSession(session);
    } catch (startError) {
      setError(
        startError instanceof Error ? startError.message : 'Could not start a shared adventure.',
      );
    } finally {
      setStarting(false);
    }
  }

  function childNickname(id: string): string {
    return eligibleChildren.find((child) => child.id === id)?.nickname ?? 'this child';
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Play together</h1>
        <Link to="/parent">Back to dashboard</Link>
      </header>
      <main className={styles.main} id="main-content">
        <div className={styles.content}>
          {loadState === 'loading' ? <p>Loading your children's profiles...</p> : null}
          {loadState === 'error' ? (
            <p className={styles.error} role="alert">
              Something went wrong loading your children's profiles.
            </p>
          ) : null}

          {loadState === 'ready' && eligibleChildren.length < 2 ? (
            <p>
              Playing together needs two Pathfinder-band (ages 5-6) child profiles, since{' '}
              {COOP_TEMPLATE.title} is the only shared adventure so far. Add or edit a child profile
              to get started.
            </p>
          ) : null}

          {loadState === 'ready' && eligibleChildren.length >= 2 && !launchedSession ? (
            <form onSubmit={(event) => void handleStart(event)}>
              <p>Choose two children to play {COOP_TEMPLATE.title} together, in real time.</p>
              {error ? (
                <p className={styles.error} role="alert">
                  {error}
                </p>
              ) : null}
              <label htmlFor="coop-child-a">First child</label>
              <select
                id="coop-child-a"
                value={childAId}
                onChange={(event) => setChildAId(event.target.value)}
                required
              >
                <option value="">Choose a child</option>
                {eligibleChildren.map((child) => (
                  <option key={child.id} value={child.id}>
                    {child.nickname}
                  </option>
                ))}
              </select>
              <label htmlFor="coop-child-b">Second child</label>
              <select
                id="coop-child-b"
                value={childBId}
                onChange={(event) => setChildBId(event.target.value)}
                required
              >
                <option value="">Choose a child</option>
                {eligibleChildren
                  .filter((child) => child.id !== childAId)
                  .map((child) => (
                    <option key={child.id} value={child.id}>
                      {child.nickname}
                    </option>
                  ))}
              </select>
              <button type="submit" disabled={starting || !childAId || !childBId}>
                {starting ? 'Starting...' : 'Start shared adventure'}
              </button>
            </form>
          ) : null}

          {launchedSession ? (
            <div>
              <p>
                {childNickname(launchedSession.participantChildProfileIds[0] ?? '')} and{' '}
                {childNickname(launchedSession.participantChildProfileIds[1] ?? '')} can now open{' '}
                {COOP_TEMPLATE.title} together. Open each link on that child's own device or turn:
              </p>
              <ul>
                {launchedSession.participantChildProfileIds.map((childId) =>
                  childId ? (
                    <li key={childId}>
                      <Link
                        to={`/island/${childId}/locations/${COOP_TEMPLATE.locationSlug}/adventures/${COOP_TEMPLATE.slug}?coop=${launchedSession.id}`}
                      >
                        Enter as {childNickname(childId)}
                      </Link>
                    </li>
                  ) : null,
                )}
              </ul>
            </div>
          ) : null}
        </div>
      </main>
    </div>
  );
}
