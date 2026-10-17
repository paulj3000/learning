import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { IslandLayout } from '../features/island/IslandLayout';
import { AdventureLibraryView } from '../features/library';
import { listStoryProgress } from '../features/story/api';
import { getChildProfile } from '../features/child-profile/api';
import type { ChildProfile } from '../features/child-profile/api';

type LoadState = 'loading' | 'ready' | 'not-found' | 'error';

/**
 * Route shell for the Adventure Library (docs/ROADMAP.md Phase 15). It only
 * loads what the shelf needs (the child profile for age band and interests,
 * and this child's story progress for the "keep going"/"finished" labels)
 * and hands it to the pure `AdventureLibraryView`, the same split every
 * other Phase 9-14 page/view pair uses.
 *
 * Story progress is best effort: a failure there loses the two status
 * labels, not the library, so it must not turn a browsable shelf into an
 * error screen.
 */
export function AdventureLibraryPage() {
  const { childId } = useParams<{ childId: string }>();
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [childProfile, setChildProfile] = useState<ChildProfile | null>(null);
  const [startedStorySlugs, setStartedStorySlugs] = useState<string[]>([]);
  const [completedStorySlugs, setCompletedStorySlugs] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!childId) {
        setLoadState('not-found');
        return;
      }
      try {
        const child = await getChildProfile(childId);
        if (cancelled) return;
        if (!child) {
          setLoadState('not-found');
          return;
        }
        setChildProfile(child);
        setLoadState('ready');
      } catch {
        if (cancelled) return;
        setLoadState('error');
        return;
      }

      try {
        const progress = await listStoryProgress(childId);
        if (cancelled) return;
        setStartedStorySlugs(progress.filter((row) => !row.completedAt).map((row) => row.storyId));
        setCompletedStorySlugs(progress.filter((row) => row.completedAt).map((row) => row.storyId));
      } catch {
        // Best effort: the shelf is still fully usable without status labels.
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [childId]);

  if (!childId) {
    return null;
  }

  if (loadState === 'loading') {
    return (
      <IslandLayout childId={childId}>
        <p>Opening the adventure library...</p>
      </IslandLayout>
    );
  }

  if (loadState !== 'ready' || !childProfile) {
    return (
      <IslandLayout childId={childId}>
        <p role="alert">Something went wrong opening the adventure library.</p>
        <Link to={`/island/${childId}`}>Back to the map</Link>
      </IslandLayout>
    );
  }

  return (
    <IslandLayout childId={childId}>
      <AdventureLibraryView
        childId={childId}
        ageBand={childProfile.ageBand}
        interests={childProfile.interests}
        startedStorySlugs={startedStorySlugs}
        completedStorySlugs={completedStorySlugs}
      />
    </IslandLayout>
  );
}
