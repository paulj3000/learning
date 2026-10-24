import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { IslandLayout } from '../features/island/IslandLayout';
import { StorykeeperCastleWorldView } from '../features/island-map/three/StorykeeperCastleWorldView';
import { getChildProfile } from '../features/child-profile/api';
import type { AgeBandValue } from '../features/child-profile/constants';

type LoadState = 'loading' | 'ready' | 'not-found' | 'error';

/**
 * Fails closed, matching `PirateBuilderBayWorldPage3D.tsx`/
 * `WelcomeHarborWorldPage.tsx`: `SPROUT` supports the fewest conversation
 * branches, so a profile that somehow renders this view without having
 * loaded offers less rather than more.
 */
const DEFAULT_AGE_BAND: AgeBandValue = 'SPROUT';

/**
 * Route shell for the SC-2 first-person Storykeeper Castle region
 * (`docs/STORYKEEPER_CASTLE_3D_ROADMAP.md`), named with a `3D` suffix
 * because `StorykeeperCastleWorldPage.tsx` (the Phase 14 Phaser route)
 * already owns the un-suffixed name.
 *
 * Confirms the child profile exists and resolves their age band and AI
 * setting before handing off. Since SC-3 the castle holds a conversation
 * with Keeper Quill and an adventure start, both age-gated exactly as every
 * other explorable region's are; since SC-4 it runs the tale itself, which
 * needs the parent's AI setting for the same reason `AdventurePage` does.
 */
export function StorykeeperCastleWorldPage3D() {
  const { childId } = useParams<{ childId: string }>();
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [ageBand, setAgeBand] = useState<AgeBandValue>(DEFAULT_AGE_BAND);
  /** Fails closed too: no profile read means no AI, matching `AdventurePage`'s own default of the stored flag. */
  const [aiEnabled, setAiEnabled] = useState(false);

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
          setAiEnabled(child.aiEnabled ?? true);
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
        <p>Loading Storykeeper Castle...</p>
      </IslandLayout>
    );
  }
  if (loadState === 'not-found' || loadState === 'error') {
    return (
      <IslandLayout childId={childId}>
        <p role="alert">Something went wrong loading Storykeeper Castle.</p>
      </IslandLayout>
    );
  }

  return (
    <IslandLayout childId={childId}>
      <StorykeeperCastleWorldView childId={childId} ageBand={ageBand} aiEnabled={aiEnabled} />
    </IslandLayout>
  );
}
