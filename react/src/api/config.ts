/**
 * Where the Django API is, and whether this build uses it at all (TR-6,
 * docs/PLAY_API.md). Off unless explicitly configured, so every existing
 * build keeps running on Amplify alone.
 *
 * - `VITE_BACKEND=django` turns the Django API on.
 * - `VITE_DJANGO_API_BASE` is the origin to call. Empty (the default) means
 *   same-origin, which is the deployed shape: CloudFront routes `/api/` to
 *   Django and Django has no CORS on purpose. A production build only
 *   accepts an `https://` origin; `http://` is for `vite dev` only.
 */

export type DjangoApiConfig = { enabled: false } | { enabled: true; baseUrl: string };

export interface DjangoApiEnv {
  VITE_BACKEND?: string;
  VITE_DJANGO_API_BASE?: string;
  DEV?: boolean;
}

const DISABLED: DjangoApiConfig = { enabled: false };

export function readDjangoApiConfig(env: DjangoApiEnv): DjangoApiConfig {
  if (env.VITE_BACKEND !== 'django') return DISABLED;
  const base = (env.VITE_DJANGO_API_BASE ?? '').trim();
  if (base === '') return { enabled: true, baseUrl: '' };

  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return DISABLED;
  }
  const allowed = url.protocol === 'https:' || (env.DEV === true && url.protocol === 'http:');
  if (!allowed || url.pathname !== '/' || url.search || url.hash) return DISABLED;
  return { enabled: true, baseUrl: url.origin };
}

export const DJANGO_API_CONFIG: DjangoApiConfig = readDjangoApiConfig(import.meta.env);

/**
 * Which backend owns the modules that have moved behind `react/src/api/`
 * (LAI-0501): parent accounts and child profiles so far.
 *
 * - `VITE_BACKEND` unset, empty or `amplify`: Amplify, as every build before.
 * - `VITE_BACKEND=django` with a valid API base: Django.
 * - Anything else (`django` with an unusable `VITE_DJANGO_API_BASE`, or a
 *   misspelt value): `misconfigured`. Calls then fail with
 *   `ApiError('disabled')`. A build that asked for Django must never quietly
 *   read and write Amplify's children instead.
 */
export type BackendSelection =
  | { backend: 'amplify' }
  | { backend: 'django'; baseUrl: string }
  | { backend: 'misconfigured'; reason: 'invalid_api_base' | 'unknown_backend' };

export function readBackendSelection(env: DjangoApiEnv): BackendSelection {
  const requested = (env.VITE_BACKEND ?? '').trim();
  if (requested === '' || requested === 'amplify') return { backend: 'amplify' };
  if (requested !== 'django') return { backend: 'misconfigured', reason: 'unknown_backend' };
  const config = readDjangoApiConfig(env);
  return config.enabled
    ? { backend: 'django', baseUrl: config.baseUrl }
    : { backend: 'misconfigured', reason: 'invalid_api_base' };
}

export const BACKEND_SELECTION: BackendSelection = readBackendSelection(import.meta.env);
