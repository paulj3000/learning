/**
 * Where the Django API is (TR-6, docs/PLAY_API.md). Django is the only application backend
 * (AMP-03, Amplify retired): every build calls it.
 *
 * - `VITE_DJANGO_API_BASE` is the origin to call. Empty (the default) means same-origin, which
 *   is the deployed shape (CloudFront routes `/api/` to Django; Django has no CORS on purpose)
 *   and the local one (the `vite dev` proxy). A production build only accepts an `https://`
 *   origin; `http://` is for `vite dev` only. Anything else falls back to same-origin; the Vite
 *   config refuses such a value before a build or dev server starts (`assertValidApiBase`).
 */

import { parseApiBase, type DjangoApiEnv } from './apiBase';

export { assertValidApiBase, parseApiBase, type DjangoApiEnv } from './apiBase';

export interface DjangoApiConfig {
  /** '' for same-origin, else an `https://` (or, in dev, `http://`) origin with no path. */
  baseUrl: string;
}

export function readDjangoApiConfig(env: DjangoApiEnv): DjangoApiConfig {
  return { baseUrl: parseApiBase(env) ?? '' };
}

export const DJANGO_API_CONFIG: DjangoApiConfig = readDjangoApiConfig(import.meta.env);
