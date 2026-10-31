import { useCallback, useMemo, useState } from 'react';
import { isApiError, type ApiError } from '../../api/errors';
import { playApiFor, type PlayApi } from '../../api/play/playApi';
import type { LaunchStart } from '../../api/play/types';

/**
 * Starts the Adventure an object in a 3D Area offers (ADR-041 decision C).
 *
 * The client only names the launch point. The server decides whether this child may start its
 * Adventure (published, same Place, active, age band) and starts or resumes the session through
 * the existing session service. On success the caller navigates to the Adventure with a way
 * back to this 3D Area (`adventureReturnPath`).
 */
export interface AdventureLaunchControls {
  /** The launch id being started, or null. One at a time, so a double tap sends one request. */
  starting: string | null;
  error: ApiError | null;
  start: (launchId: string) => Promise<LaunchStart | null>;
}

export interface UseAdventureLaunchOptions {
  /** For tests; defaults to the configured Django API. */
  createApi?: (childId: string) => PlayApi;
}

export function useAdventureLaunch(
  childId: string,
  regionId: string,
  options: UseAdventureLaunchOptions = {},
): AdventureLaunchControls {
  const { createApi = playApiFor } = options;
  const api = useMemo(() => createApi(childId), [createApi, childId]);
  const [starting, setStarting] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const start = useCallback(
    async (launchId: string) => {
      if (starting) return null;
      setStarting(launchId);
      setError(null);
      try {
        const result = await api.startLaunchPoint(regionId, launchId);
        return result.value;
      } catch (caught) {
        if (isApiError(caught)) setError(caught);
        else throw caught;
        return null;
      } finally {
        setStarting(null);
      }
    },
    [api, regionId, starting],
  );

  return { starting, error, start };
}

/**
 * Where the Adventure page sends the child back to: this 3D Area. Only an in-app path for this
 * child's own 3D Area is ever produced, and `safeReturnPath` accepts nothing else.
 */
export function adventurePath(childId: string, launch: LaunchStart): string {
  const back = `/island/${encodeURIComponent(childId)}/explore/${encodeURIComponent(
    launch.returnTo.regionId,
  )}`;
  return (
    `/island/${encodeURIComponent(childId)}/locations/${encodeURIComponent(launch.placeSlug)}` +
    `/adventures/${encodeURIComponent(launch.adventureId)}?returnTo=${encodeURIComponent(back)}`
  );
}

const RETURN_PATH = /^\/island\/([^/?#]+)\/explore\/([a-z0-9][a-z0-9-]*)$/;

/**
 * The `returnTo` of an Adventure page, if it is this child's own 3D Area path; otherwise null.
 * Never an external URL, another child, or anything with a query or fragment.
 */
export function safeReturnPath(childId: string, value: string | null): string | null {
  if (!value) return null;
  const match = RETURN_PATH.exec(value);
  if (!match || decodeURIComponent(match[1]) !== childId) return null;
  return value;
}
