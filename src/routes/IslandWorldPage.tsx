import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { IslandLayout } from '../features/island/IslandLayout';
import { IslandWorldView } from '../features/island-map/IslandWorldView';
import { getChildProfile } from '../features/child-profile/api';

type LoadState = 'loading' | 'ready' | 'not-found' | 'error';

export function IslandWorldPage() {
  const { childId } = useParams<{ childId: string }>();
  const [loadState, setLoadState] = useState<LoadState>('loading');

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
        setLoadState(child ? 'ready' : 'not-found');
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

  if (!childId) {
    return null;
  }

  if (loadState === 'loading') {
    return (
      <IslandLayout childId={childId}>
        <p>Loading the island...</p>
      </IslandLayout>
    );
  }
  if (loadState === 'not-found' || loadState === 'error') {
    return (
      <IslandLayout childId={childId}>
        <p role="alert">Something went wrong loading the island.</p>
      </IslandLayout>
    );
  }

  return (
    <IslandLayout childId={childId}>
      <IslandWorldView childId={childId} />
    </IslandLayout>
  );
}
