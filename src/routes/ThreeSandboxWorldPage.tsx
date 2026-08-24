import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { IslandLayout } from '../features/island/IslandLayout';
import { ThreeSandboxWorldView } from '../features/island-map/three/ThreeSandboxWorldView';
import { getChildProfile } from '../features/child-profile/api';

type LoadState = 'loading' | 'ready' | 'not-found' | 'error';

/**
 * Route shell for the Phase 31 Three.js sandbox (`docs/ROADMAP.md` Phase
 * 31). Deliberately thin, mirroring `PirateBuilderBayWorldPage.tsx`: this
 * only confirms the child profile exists before handing off to the view,
 * since the sandbox itself needs no age-band-specific content yet.
 */
export function ThreeSandboxWorldPage() {
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
        <p>Loading the sandbox...</p>
      </IslandLayout>
    );
  }
  if (loadState === 'not-found' || loadState === 'error') {
    return (
      <IslandLayout childId={childId}>
        <p role="alert">Something went wrong loading the sandbox.</p>
      </IslandLayout>
    );
  }

  return (
    <IslandLayout childId={childId}>
      <ThreeSandboxWorldView childId={childId} />
    </IslandLayout>
  );
}
