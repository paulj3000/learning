import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, isApiError } from '../../api/errors';
import { playApiFor, type PlayApi } from '../../api/play/playApi';
import type { PlayerProgress } from '../../api/play/types';

/**
 * A child's progress from `GET progress/` (TR-6): sessions, world changes,
 * opened chests, inventory, quests, and practice counts. Re-reads when the
 * child changes, aborting the old request; a reply for the previous child
 * is dropped, so it can never be shown for the new one.
 */

export interface PlayerProgressState {
  status: 'loading' | 'ready' | 'error';
  progress: PlayerProgress | null;
  error: ApiError | null;
}

export interface UsePlayerProgressOptions {
  createApi?: (childId: string) => PlayApi;
  onUnauthenticated?: () => void;
}

export function usePlayerProgress(childId: string, options: UsePlayerProgressOptions = {}) {
  const { createApi = playApiFor, onUnauthenticated } = options;
  const api = useMemo(() => createApi(childId), [createApi, childId]);
  const [state, setState] = useState<PlayerProgressState & { childId: string }>({
    childId,
    status: 'loading',
    progress: null,
    error: null,
  });
  const childRef = useRef(childId);
  const controllerRef = useRef<AbortController | null>(null);
  const onUnauthenticatedRef = useRef(onUnauthenticated);
  useEffect(() => {
    onUnauthenticatedRef.current = onUnauthenticated;
  });

  const load = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const forChild = childRef.current;
    setState((current) => ({
      ...current,
      status: current.progress ? current.status : 'loading',
      error: null,
    }));
    try {
      const progress = await api.getProgress(controller.signal);
      if (forChild !== childRef.current) return;
      setState({ childId: forChild, status: 'ready', progress, error: null });
    } catch (caught) {
      const error = isApiError(caught) ? caught : new ApiError('invalid_response');
      if (error.kind === 'aborted' || forChild !== childRef.current) return;
      setState((current) => ({ ...current, status: 'error', error }));
      if (error.kind === 'unauthenticated') onUnauthenticatedRef.current?.();
    }
  }, [api]);

  useEffect(() => {
    childRef.current = childId;
    setState({ childId, status: 'loading', progress: null, error: null });
    void load();
    return () => controllerRef.current?.abort();
  }, [childId, load]);

  // Never hand back another child's progress, even for the render before the effect runs.
  const visible: PlayerProgressState =
    state.childId === childId
      ? { status: state.status, progress: state.progress, error: state.error }
      : { status: 'loading', progress: null, error: null };
  return { ...visible, refresh: load };
}
