import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { IslandLayout } from '../features/island/IslandLayout';
import { DragonsSanctuaryWorldView } from '../features/island-map/three/DragonsSanctuaryWorldView';
import { getChildProfile } from '../features/child-profile/api';
import type { AgeBandValue } from '../features/child-profile/constants';

type LoadState = 'loading' | 'ready' | 'not-found' | 'error';

/**
 * Fails closed. `SPROUT` supports the fewest adventures, so a profile that
 * somehow renders a world view without having loaded (which the load states
 * below already prevent) offers less rather than more. The alternative
 * default would hand a three-year-old an Explorer adventure on a bug.
 */
const DEFAULT_AGE_BAND: AgeBandValue = 'SPROUT';

/**
 * The Dragon's Sanctuary's page.
 *
 * Points at the first-person Three.js view since ADR-021: the region is 3D
 * only, and the 2D `island-map/DragonsSanctuaryWorldView.tsx` it used to
 * render is superseded. There is no `3D`-suffixed sibling route the way
 * Storykeeper Castle has one, because there is no second view to
 * disambiguate from.
 */
export function DragonsSanctuaryWorldPage() {
  const { childId } = useParams<{ childId: string }>();
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

  if (!childId) {
    return null;
  }

  if (loadState === 'loading') {
    return (
      <IslandLayout childId={childId}>
        <p>Loading the Dragon's Sanctuary...</p>
      </IslandLayout>
    );
  }
  if (loadState === 'not-found' || loadState === 'error') {
    return (
      <IslandLayout childId={childId}>
        <p role="alert">Something went wrong loading the Dragon's Sanctuary.</p>
      </IslandLayout>
    );
  }

  return (
    <IslandLayout childId={childId}>
      <DragonsSanctuaryWorldView childId={childId} ageBand={ageBand} />
    </IslandLayout>
  );
}
