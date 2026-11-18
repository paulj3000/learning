import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { IslandLayout } from '../features/island/IslandLayout';
import { getChildProfile } from '../features/child-profile/api';
import type { ChildProfile } from '../features/child-profile/api';
import { CASTLE_WRITING_ROOM_REGION_ID } from '../features/discovery/checkpoints';
import { locationWorldPath } from '../features/island-map/three/runtime/locationWorldPath';
import { WritingRoomActivity } from '../features/writing-room/WritingRoomActivity';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * The Writing Room's write-your-story page (SC-final-B). Reached from the open book in the 3D
 * room and from the location card; both land here, and the child's own band decides the activity.
 * It needs no unlock (the room is open to every child) and is never required.
 */
export function WritingRoomWritePage() {
  const { childId } = useParams<{ childId: string }>();
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [childProfile, setChildProfile] = useState<ChildProfile | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!childId) return;
      try {
        const profile = await getChildProfile(childId);
        if (cancelled) return;
        setChildProfile(profile);
        setLoadState(profile ? 'ready' : 'error');
      } catch {
        if (!cancelled) setLoadState('error');
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [childId]);

  if (!childId) return null;
  const roomHref = locationWorldPath(childId, CASTLE_WRITING_ROOM_REGION_ID);

  return (
    <IslandLayout childId={childId}>
      {loadState === 'loading' ? <p>Opening the empty book...</p> : null}
      {loadState === 'error' || (loadState === 'ready' && !childProfile) ? (
        <>
          <p role="alert">Something went wrong opening the book. Please try again.</p>
          <Link to={`/island/${childId}`}>Back to the map</Link>
        </>
      ) : null}
      {loadState === 'ready' && childProfile ? (
        <WritingRoomActivity
          childId={childId}
          ageBand={childProfile.ageBand}
          roomHref={roomHref}
          logHref={`/island/${childId}/log`}
        />
      ) : null}
    </IslandLayout>
  );
}
