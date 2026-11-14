import { resolveBackend } from './backend';

/**
 * Where the Django API is, and whether this build uses it at all (TR-6,
 * docs/PLAY_API.md). Django is the only application backend (AMP-03, AMP-07); `vite dev` uses
 * it by default and a build opts in (`resolveBackend`, react/src/api/backend.ts).
 *
 * - `VITE_BACKEND=django` turns the Django API on; any other value turns it off.
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
  MODE?: string;
}

const DISABLED: DjangoApiConfig = { enabled: false };

export function readDjangoApiConfig(env: DjangoApiEnv): DjangoApiConfig {
  if (resolveBackend(env) !== 'django') return DISABLED;
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
