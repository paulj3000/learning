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

import { readAuthMode, type AuthMode } from './authMode';

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

/** This build's sign-in (ADR-038, authMode.ts). Throws at start-up when misconfigured. */
export const AUTH_MODE: AuthMode = readAuthMode(import.meta.env);
