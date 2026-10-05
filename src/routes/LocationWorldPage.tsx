import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { IslandLayout } from '../features/island/IslandLayout';
import { ThreeLocationWorldView } from '../features/island-map/three/runtime/ThreeLocationWorldView';
import { getChildProfile } from '../features/child-profile/api';
import type { AgeBandValue } from '../features/child-profile/constants';

type LoadState = 'loading' | 'ready' | 'not-found' | 'error';

/**
 * Fails closed, matching every per-region world page: `SPROUT` supports the
 * fewest conversation branches, so a profile that somehow renders the view
 * without having loaded offers less rather than more.
 */
const DEFAULT_AGE_BAND: AgeBandValue = 'SPROUT';

/**
 * The one route page for every manifest-driven 3D location
 * (`/island/:childId/explore/:regionId`, engine Phase 6, ADR-025). It
 * replaces the near-identical per-region shells (`*WorldPage3D.tsx`): it
 * confirms the child profile exists, resolves its age band, and hands the
 * region id to `ThreeLocationWorldView`, which loads the manifest and says
 * calmly when a region has none. Adding an ordinary location never touches
 * this file or `AppRoutes.tsx`.
 */
export function LocationWorldPage() {
  const { childId, regionId } = useParams<{ childId: string; regionId: string }>();
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [ageBand, setAgeBand] = useState<AgeBandValue>(DEFAULT_AGE_BAND);

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
        if (child) {
          setAgeBand(child.ageBand);
        }
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

  if (!childId || !regionId) {
    return null;
  }

  if (loadState === 'loading') {
    return (
      <IslandLayout childId={childId}>
        <p>Loading...</p>
      </IslandLayout>
    );
  }
  if (loadState === 'not-found' || loadState === 'error') {
    return (
      <IslandLayout childId={childId}>
        <p role="alert">Something went wrong loading this part of the island.</p>
      </IslandLayout>
    );
  }

  return (
    <IslandLayout childId={childId}>
      <ThreeLocationWorldView
        key={regionId}
        childId={childId}
        regionId={regionId}
        ageBand={ageBand}
      />
    </IslandLayout>
  );
}
