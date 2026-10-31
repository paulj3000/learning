import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { IslandLayout } from '../features/island/IslandLayout';
import { ThreeLocationWorldView } from '../features/island-map/three/runtime/ThreeLocationWorldView';
import { locationRepositoryForThisBuild } from '../features/multiplayer/devMultiplayerRepository';
import { getChildPlaySettings } from '../features/child-profile/playSettings';
import type { AgeBandValue } from '../features/child-profile/constants';
import { regionRepositoryForChild } from '../features/region-play/regionRepositoryForChild';
import { regionAssetsFor } from '../features/region-play/regionAssets';

type LoadState = 'loading' | 'ready' | 'not-found' | 'error';

/**
 * Fails closed, matching every per-region world page: `SPROUT` supports the
 * fewest conversation branches, so a profile that somehow renders the view
 * without having loaded offers less rather than more.
 */
const DEFAULT_AGE_BAND: AgeBandValue = 'SPROUT';

/**
 * The one route page for every manifest-driven 3D location
 * (`/island/:childId/explore/:regionId`, engine Phase 6, ADR-032). It
 * replaces the near-identical per-region shells (`*WorldPage3D.tsx`): it
 * confirms the child profile exists, resolves its age band, and hands the
 * region id to `ThreeLocationWorldView`, which loads the manifest and says
 * calmly when a region has none. Adding an ordinary location never touches
 * this file or `AppRoutes.tsx`.
 *
 * With the Django API enabled, a region that is not source-controlled is
 * read from the play API for this child (TR-7, `regionRepositoryForChild`),
 * and its models come from the Django asset manager (TR-10, `regionAssetsFor`).
 */
export function LocationWorldPage() {
  const { childId, regionId } = useParams<{ childId: string; regionId: string }>();
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [ageBand, setAgeBand] = useState<AgeBandValue>(DEFAULT_AGE_BAND);
  /**
   * Fails closed too: no profile read means no AI, matching `AdventurePage`'s
   * own default of the stored flag. Only a region whose learning runs in the
   * room uses it (an adventure host needs it for the same reason the card
   * route does).
   */
  const [aiEnabled, setAiEnabled] = useState(false);
  const repository = useMemo(
    () => regionRepositoryForChild(childId ?? '', locationRepositoryForThisBuild),
    [childId],
  );
  // One resolver and loader per visit, so re-entering picks up a newly published default.
  const assets = useMemo(
    () => regionAssetsFor(childId ?? '', regionId ?? '', locationRepositoryForThisBuild),
    [childId, regionId],
  );

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!childId) {
        setLoadState('not-found');
        return;
      }
      try {
        const child = await getChildPlaySettings(childId);
        if (cancelled) return;
        if (child) {
          setAgeBand(child.ageBand);
          setAiEnabled(child.aiEnabled);
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
        aiEnabled={aiEnabled}
        repository={repository}
        assets={assets}
      />
    </IslandLayout>
  );
}
