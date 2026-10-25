/**
 * The `vite dev` proxy to a local Django (TR-7, decision TR-D14). Django has
 * no CORS on purpose (same-origin in every deployed environment), so in
 * development the browser calls `/api/...` on the Vite origin and Vite
 * forwards it. Dev server only: production builds and `vite preview` are
 * unaffected, and nothing here reaches the client bundle.
 *
 * - On only when `VITE_BACKEND=django`, so a build that has not opted in
 *   behaves exactly as before.
 * - `DJANGO_DEV_PROXY_TARGET` (default `http://127.0.0.1:8000`, Django's
 *   `runserver`). Deliberately not `VITE_`-prefixed: it is server config,
 *   not something the app should see. Only a loopback `http(s)` origin is
 *   accepted, so a typo can never send a parent's token elsewhere.
 */

export const DEFAULT_DJANGO_DEV_TARGET = 'http://127.0.0.1:8000';
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

export interface DevProxyEnv {
  VITE_BACKEND?: string;
  DJANGO_DEV_PROXY_TARGET?: string;
}

export type DevProxyConfig = Record<string, { target: string; changeOrigin: boolean }>;

export function djangoDevProxy(env: DevProxyEnv): DevProxyConfig | undefined {
  if (env.VITE_BACKEND !== 'django') return undefined;
  const raw = (env.DJANGO_DEV_PROXY_TARGET ?? '').trim() || DEFAULT_DJANGO_DEV_TARGET;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`DJANGO_DEV_PROXY_TARGET is not a URL: ${raw}`);
  }
  if (!['http:', 'https:'].includes(url.protocol) || !LOOPBACK.has(url.hostname)) {
    throw new Error('DJANGO_DEV_PROXY_TARGET must be a loopback http(s) origin');
  }
  return { '/api': { target: url.origin, changeOrigin: false } };
}
