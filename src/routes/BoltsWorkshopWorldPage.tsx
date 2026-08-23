import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { IslandLayout } from '../features/island/IslandLayout';
import { BoltsWorkshopWorldView } from '../features/island-map/BoltsWorkshopWorldView';
import { getChildProfile } from '../features/child-profile/api';
import type { AgeBandValue } from '../features/child-profile/constants';

type LoadState = 'loading' | 'ready' | 'not-found' | 'error';

/** Fallback used if the profile has no avatarKey, matching `avatarAppearance.ts`'s own fallback intent. */
const DEFAULT_AVATAR_KEY = 'FOX';

/**
 * Fails closed. `SPROUT` supports the fewest adventures, so a profile that
 * somehow renders a world view without having loaded (which the load states
 * below already prevent) offers less rather than more. The alternative
 * default would hand a three-year-old an Explorer adventure on a bug.
 */
const DEFAULT_AGE_BAND: AgeBandValue = 'SPROUT';

export function BoltsWorkshopWorldPage() {
  const { childId } = useParams<{ childId: string }>();
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [avatarKey, setAvatarKey] = useState(DEFAULT_AVATAR_KEY);
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
          setAvatarKey(child.avatarKey);
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
        <p>Loading Bolt's Workshop...</p>
      </IslandLayout>
    );
  }
  if (loadState === 'not-found' || loadState === 'error') {
    return (
      <IslandLayout childId={childId}>
        <p role="alert">Something went wrong loading Bolt's Workshop.</p>
      </IslandLayout>
    );
  }

  return (
    <IslandLayout childId={childId}>
      <BoltsWorkshopWorldView childId={childId} avatarKey={avatarKey} ageBand={ageBand} />
    </IslandLayout>
  );
}
