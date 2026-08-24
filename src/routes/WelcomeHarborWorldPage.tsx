import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { IslandLayout } from '../features/island/IslandLayout';
import { WelcomeHarborWorldView } from '../features/island-map/three/WelcomeHarborWorldView';
import { getChildProfile } from '../features/child-profile/api';
import type { AgeBandValue } from '../features/child-profile/constants';

type LoadState = 'loading' | 'ready' | 'not-found' | 'error';

/**
 * Fails closed, matching `PirateBuilderBayWorldPage.tsx`: `SPROUT` supports
 * the fewest conversation branches, so a profile that somehow renders this
 * view without having loaded offers less rather than more.
 */
const DEFAULT_AGE_BAND: AgeBandValue = 'SPROUT';

/**
 * Route shell for the Phase 32 Welcome Harbor first-person region
 * (`docs/ROADMAP.md` Phase 32), mirroring `PirateBuilderBayWorldPage.tsx`:
 * confirms the child profile exists and resolves their age band before
 * handing off to the view, since the region's one NPC conversation is
 * age-gated the same way every other explorable region's is.
 */
export function WelcomeHarborWorldPage() {
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
        <p>Loading Welcome Harbor...</p>
      </IslandLayout>
    );
  }
  if (loadState === 'not-found' || loadState === 'error') {
    return (
      <IslandLayout childId={childId}>
        <p role="alert">Something went wrong loading Welcome Harbor.</p>
      </IslandLayout>
    );
  }

  return (
    <IslandLayout childId={childId}>
      <WelcomeHarborWorldView childId={childId} ageBand={ageBand} />
    </IslandLayout>
  );
}
