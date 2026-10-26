import { djangoClient } from './backend';
import type { ApiClient } from './client';
import { BACKEND_SELECTION, type BackendSelection } from './config';
import { ApiError, isApiError } from './errors';

/**
 * Picks one implementation of an API area per build (LAI-0501B), the same
 * rule `children.ts` and `parents.ts` follow (LAI-0501A):
 *
 * - Amplify build: the Amplify adapter (`react/src/api/amplify/`).
 * - Django build: the operations Django really has a route for, and an
 *   explicit `ApiError('unsupported')` for every other operation. There is
 *   no fallback to Amplify and no simulated success.
 * - Misconfigured build: every operation fails with `ApiError('disabled')`.
 *
 * Each area records which operations its Django side supports, so a screen
 * can tell "this backend cannot do that yet" (`supports`, `isUnsupported`)
 * from a real empty result.
 */

/** The API areas behind `react/src/api/`. Codes in errors are `<area>_unavailable`. */
export type ApiArea =
  | 'adventures'
  | 'ai'
  | 'catalog'
  | 'childPhotos'
  | 'coop'
  | 'director'
  | 'companionProfile'
  | 'discovery'
  | 'mastery'
  | 'npc'
  | 'quests'
  | 'rewards'
  | 'safety'
  | 'story';

type AsyncFunction = (...args: never[]) => Promise<unknown>;
type AsyncApi<T> = { [K in keyof T]: T[K] extends AsyncFunction ? T[K] : never };

export interface ApiImplementations<T extends AsyncApi<T>> {
  amplify: T;
  /** The operations Django has a real route for. Leave out every other one. */
  django?: (client: ApiClient) => Partial<T>;
}

const DJANGO_OPERATIONS = new Map<ApiArea, ReadonlySet<string>>();
let ACTIVE_BACKEND: BackendSelection['backend'] = BACKEND_SELECTION.backend;

export function selectApi<T extends AsyncApi<T>>(
  area: ApiArea,
  implementations: ApiImplementations<T>,
  selection: BackendSelection = BACKEND_SELECTION,
): T {
  if (selection.backend === 'amplify') return implementations.amplify;

  const operations = Object.keys(implementations.amplify) as Array<keyof T & string>;
  if (selection.backend === 'misconfigured') {
    const error = new ApiError('disabled', { code: selection.reason });
    return fromEntries(operations, () => () => Promise.reject(error));
  }

  const supported: Partial<T> = implementations.django?.(djangoClient(selection)) ?? {};
  DJANGO_OPERATIONS.set(area, new Set(Object.keys(supported)));
  return fromEntries(operations, (name) => {
    const implementation = supported[name];
    if (implementation) return implementation as T[typeof name];
    return (() => Promise.reject(unsupported(area, name))) as unknown as T[typeof name];
  });
}

function fromEntries<T>(keys: Array<keyof T & string>, value: (key: keyof T & string) => unknown): T {
  return Object.fromEntries(keys.map((key) => [key, value(key)])) as T;
}

export function unsupported(area: ApiArea, operation?: string): ApiError {
  return new ApiError('unsupported', {
    code: `${area}_unavailable`,
    ...(operation ? { details: { operation: [{ message: operation, code: 'unsupported' }] } } : {}),
  });
}

/** True for the typed "this backend has no route for this yet" error. */
export function isUnsupported(error: unknown): boolean {
  return isApiError(error) && error.kind === 'unsupported';
}

/**
 * True when the failure is the backend itself (no route on Django, or a
 * misconfigured build), not a transient or data error. Code that degrades
 * gracefully on a network blip must not degrade on this: it is not a blip.
 */
export function isBackendGap(error: unknown): boolean {
  return isApiError(error) && (error.kind === 'unsupported' || error.kind === 'disabled');
}

/**
 * Whether this build's backend can run `operation` in `area`. Always true on
 * Amplify; false on a misconfigured build; on Django, true only for the
 * operations its implementation provides.
 */
export function supports(area: ApiArea, operation: string): boolean {
  if (ACTIVE_BACKEND === 'amplify') return true;
  if (ACTIVE_BACKEND === 'misconfigured') return false;
  return DJANGO_OPERATIONS.get(area)?.has(operation) ?? false;
}

/** Test seam: which backend `supports` answers for. */
export function setActiveBackendForTests(backend: BackendSelection['backend']): void {
  ACTIVE_BACKEND = backend;
}
