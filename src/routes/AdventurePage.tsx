import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { IslandLayout } from '../features/island/IslandLayout';
import { AdventureRunner } from '../features/adventures/AdventureRunner';
import { getAdventureTemplate } from '../features/adventures/content';
import { getChildProfile } from '../features/child-profile/api';
import type { ChildProfile } from '../features/child-profile/api';

type LoadState = 'loading' | 'ready' | 'error';

export function AdventurePage() {
  const { childId, locationSlug, templateSlug } = useParams<{
    childId: string;
    locationSlug: string;
    templateSlug: string;
  }>();
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [childProfile, setChildProfile] = useState<ChildProfile | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!childId) return;
      try {
        const child = await getChildProfile(childId);
        if (cancelled) return;
        setChildProfile(child);
        setLoadState(child ? 'ready' : 'error');
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

  if (!childId || !locationSlug) {
    return null;
  }

  const definition = templateSlug ? getAdventureTemplate(templateSlug) : undefined;

  if (!definition || definition.locationSlug !== locationSlug) {
    return (
      <IslandLayout childId={childId}>
        <p role="alert">We could not find that adventure.</p>
        <Link to={`/island/${childId}/locations/${locationSlug}`}>Back to the location</Link>
      </IslandLayout>
    );
  }

  if (loadState === 'loading') {
    return (
      <IslandLayout childId={childId}>
        <p>Loading your adventure...</p>
      </IslandLayout>
    );
  }

  if (loadState === 'error' || !childProfile) {
    return (
      <IslandLayout childId={childId}>
        <p role="alert">Something went wrong loading this adventure.</p>
        <Link to={`/island/${childId}/locations/${locationSlug}`}>Back to the location</Link>
      </IslandLayout>
    );
  }

  return (
    <IslandLayout childId={childId}>
      <AdventureRunner
        childProfileId={childId}
        definition={definition}
        ageBand={childProfile.ageBand}
        aiEnabled={childProfile.aiEnabled ?? true}
        backToMapHref={`/island/${childId}/locations/${locationSlug}`}
      />
    </IslandLayout>
  );
}
