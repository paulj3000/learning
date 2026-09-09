import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { IslandLayout } from '../features/island/IslandLayout';
import { ClockworkHarborWorldView } from '../features/island-map/three/ClockworkHarborWorldView';
import { getChildProfile } from '../features/child-profile/api';
import type { AgeBandValue } from '../features/child-profile/constants';

type LoadState = 'loading' | 'ready' | 'not-found' | 'error';

/**
 * Fails closed, matching `WelcomeHarborWorldPage.tsx`: `SPROUT` supports the
 * fewest conversation branches, so a profile that somehow renders this view
 * without having loaded offers less rather than more.
 */
const DEFAULT_AGE_BAND: AgeBandValue = 'SPROUT';

/**
 * Route shell for Clockwork Harbor (`docs/regions/clockwork.md` section 9),
 * mirroring `WelcomeHarborWorldPage.tsx`: confirms the child profile exists
 * and resolves their age band before handing off to the view, since the
 * region's NPC conversations are age-gated the same way every other
 * explorable region's are.
 *
 * Note on age bands and difficulty: the age band resolved here gates
 * *conversation*, not challenge difficulty. Section 2.2 of the roadmap is
 * explicit that educational difficulty comes from demonstrated skill rather
 * than age, and that is the Learning Profile's job
 * (`src/features/learning-profile/`), not this shell's.
 */
export function ClockworkHarborWorldPage() {
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
        <p>Loading Clockwork Harbor...</p>
      </IslandLayout>
    );
  }
  if (loadState === 'not-found' || loadState === 'error') {
    return (
      <IslandLayout childId={childId}>
        <p role="alert">Something went wrong loading Clockwork Harbor.</p>
      </IslandLayout>
    );
  }

  return (
    <IslandLayout childId={childId}>
      <ClockworkHarborWorldView childId={childId} ageBand={ageBand} />
    </IslandLayout>
  );
}
