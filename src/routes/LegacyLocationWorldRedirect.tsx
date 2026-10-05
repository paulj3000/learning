import { Navigate, useLocation, useParams } from 'react-router-dom';
import { locationWorldPath } from '../features/island-map/three/runtime/locationWorldPath';

/**
 * Keeps a pre-Phase-6 per-region 3D URL working once that region runs on
 * the generic route (engine Phase 6: "keep old routes as compatibility
 * redirects"). Replaces the history entry, so the back button does not
 * bounce the child between the two URLs, and keeps any query string.
 */
export function LegacyLocationWorldRedirect({ regionId }: { regionId: string }) {
  const { childId } = useParams<{ childId: string }>();
  const { search } = useLocation();
  if (!childId) return null;
  return <Navigate replace to={`${locationWorldPath(childId, regionId)}${search}`} />;
}
