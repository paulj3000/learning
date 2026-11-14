/**
 * Which application backend a build talks to (ADR-019, P0 local-dev fix, AMP-03/AMP-07).
 *
 * Django REST and PostgreSQL is the only application backend: AMP-03 moved every Amplify Data
 * read and write to Django and AMP-07 removed `aws-amplify` from the app, so there is no
 * Amplify Data build to select any more.
 *
 * - `VITE_BACKEND=django`: Django, in every mode. Every deployed build sets it (site-release).
 * - Unset: Django in `vite dev` (`MODE === 'development'`). A production build or a unit test
 *   (`MODE === 'test'`) must opt in, so tests keep the explicit behaviour each one sets up.
 * - Any other value, including the retired `amplify`, is unknown: the dev server refuses it
 *   (`assertValidBackendSetting`) and a build treats the Django API as off.
 *
 * Pure: no React, no `import.meta`, so the Vite config can use it too.
 */

export type Backend = 'django';

export interface BackendEnv {
  VITE_BACKEND?: string;
  MODE?: string;
}

export const BACKENDS: readonly Backend[] = ['django'];

/** The raw setting, normalised; `null` when unset and `undefined` when not a known backend. */
export function readBackendSetting(env: BackendEnv): Backend | null | undefined {
  const raw = (env.VITE_BACKEND ?? '').trim().toLowerCase();
  if (raw === '') return null;
  return (BACKENDS as readonly string[]).includes(raw) ? (raw as Backend) : undefined;
}

/** The backend this build uses, or null when the Django API is off (not opted in, or unknown). */
export function resolveBackend(env: BackendEnv): Backend | null {
  const setting = readBackendSetting(env);
  if (setting === null) return env.MODE === 'development' ? 'django' : null;
  return setting ?? null;
}
