/**
 * Which application backend a build talks to (ADR-019, P0 local-dev fix).
 *
 * - `VITE_BACKEND=django`: Django REST and PostgreSQL. Every deployed CloudFront build and,
 *   by default, every local `vite dev` server.
 * - `VITE_BACKEND=amplify`: the legacy Amplify Data path, kept only until the AMP cutover
 *   (PR #15) so a hosted Amplify build keeps working unchanged.
 * - Unset: `django` in `vite dev` (`MODE === 'development'`), otherwise `amplify`. A production
 *   build never changes backend silently; it must opt in, as `site-release` does. Unit tests
 *   run in `MODE === 'test'`, so they keep the explicit behaviour each test sets up.
 *
 * Pure: no React, no `import.meta`, so the Vite config can use it too.
 */

export type Backend = 'django' | 'amplify';

export interface BackendEnv {
  VITE_BACKEND?: string;
  MODE?: string;
}

export const BACKENDS: readonly Backend[] = ['django', 'amplify'];

/** The raw setting, normalised; `null` when unset and `undefined` when not a known backend. */
export function readBackendSetting(env: BackendEnv): Backend | null | undefined {
  const raw = (env.VITE_BACKEND ?? '').trim().toLowerCase();
  if (raw === '') return null;
  return (BACKENDS as readonly string[]).includes(raw) ? (raw as Backend) : undefined;
}

/** The backend this build uses. An unknown value is treated as `amplify` (Django off). */
export function resolveBackend(env: BackendEnv): Backend {
  const setting = readBackendSetting(env);
  if (setting === null) return env.MODE === 'development' ? 'django' : 'amplify';
  return setting ?? 'amplify';
}
