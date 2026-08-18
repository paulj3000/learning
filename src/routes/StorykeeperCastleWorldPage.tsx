import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { IslandLayout } from '../features/island/IslandLayout';
import { StorykeeperCastleWorldView } from '../features/island-map/StorykeeperCastleWorldView';
import { getChildProfile } from '../features/child-profile/api';

type LoadState = 'loading' | 'ready' | 'not-found' | 'error';

/** Fallback used if the profile has no avatarKey, matching `avatarAppearance.ts`'s own fallback intent. */
const DEFAULT_AVATAR_KEY = 'FOX';

export function StorykeeperCastleWorldPage() {
  const { childId } = useParams<{ childId: string }>();
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [avatarKey, setAvatarKey] = useState(DEFAULT_AVATAR_KEY);

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
      <StorykeeperCastleWorldView childId={childId} avatarKey={avatarKey} />
    </IslandLayout>
  );
}
