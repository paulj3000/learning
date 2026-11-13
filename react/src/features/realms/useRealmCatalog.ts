import { useCallback, useEffect, useState } from 'react';
import { getIslandsFor, type IslandsView } from '../../api/play/islandsApi';
import { getChildProfile, type ChildProfile } from '../child-profile/api';
import { realmLoadFailure, type RealmLoadFailure } from './realmLoadFailure';

/**
 * The child and their published Realm catalog for the Realm Explorer pages (AP-03).
 *
 * One catalog read serves the Explorer and every Realm preview: a read younger than
 * `FRESH_MS` is reused, so moving between them costs no extra call. Coming back after playing
 * (longer than that) reads again, so progress and "Continue" are current. Only this child's
 * own answer is ever cached, keyed by child id; the server scopes it (404 for another family).
 */
export const FRESH_MS = 30_000;

const catalogCache = new Map<string, { at: number; view: IslandsView }>();

/** Tests and sign-out: forget every cached catalog. */
export function clearRealmCatalogCache(): void {
  catalogCache.clear();
}

export type RealmCatalogState =
  | { status: 'loading' }
  | { status: 'not-found' }
  | { status: 'error'; failure: RealmLoadFailure }
  | { status: 'ready'; child: ChildProfile; view: IslandsView };

async function loadCatalog(childId: string, force: boolean): Promise<IslandsView> {
  const cached = catalogCache.get(childId);
  if (!force && cached && Date.now() - cached.at < FRESH_MS) return cached.view;
  const view = await getIslandsFor(childId);
  catalogCache.set(childId, { at: Date.now(), view });
  return view;
}

export function useRealmCatalog(childId: string | undefined): {
  state: RealmCatalogState;
  retry: () => void;
} {
  const [state, setState] = useState<RealmCatalogState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    if (!childId) {
      setState({ status: 'not-found' });
      return undefined;
    }
    setState({ status: 'loading' });
    Promise.all([getChildProfile(childId), loadCatalog(childId, attempt > 0)]).then(
      ([child, view]) => {
        if (!live) return;
        setState(child ? { status: 'ready', child, view } : { status: 'not-found' });
      },
      (error: unknown) => {
        // Every read is bounded (react/src/api/client.ts), so this always arrives.
        if (live) setState({ status: 'error', failure: realmLoadFailure(error) });
      },
    );
    return () => {
      live = false;
    };
  }, [childId, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { state, retry };
}
