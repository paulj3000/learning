/**
 * The `vite dev` proxy to a local Django (TR-7, decision TR-D14). Django has
 * no CORS on purpose (same-origin in every deployed environment), so in
 * development the browser calls `/api/...` on the Vite origin and Vite
 * forwards it. Dev server only: production builds and `vite preview` are
 * unaffected, and nothing here reaches the client bundle.
 *
 * - Always on: Django is the only application backend (AMP-03).
 * - The target, in order: `DJANGO_DEV_PROXY_TARGET` (a full origin), else
 *   `http://127.0.0.1:$DJANGO_DEV_PORT`, else `http://127.0.0.1:8010`
 *   (`make runserver`'s default). `DJANGO_DEV_PORT` is the same variable the
 *   Makefile binds `runserver` to, so one setting keeps both sides in step.
 *   Neither is `VITE_`-prefixed: it is server config, not something the app
 *   should see.
 * - Only a loopback `http(s)` origin is accepted, so a typo can never send a
 *   parent's token elsewhere. Every invalid value stops the dev server with a
 *   message naming the variable, rather than proxying somewhere unexpected.
 */

export const DEFAULT_DJANGO_DEV_PORT = 8010;
export const DEFAULT_DJANGO_DEV_TARGET = `http://127.0.0.1:${DEFAULT_DJANGO_DEV_PORT}`;
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

export interface DevProxyEnv {
  DJANGO_DEV_PROXY_TARGET?: string;
  DJANGO_DEV_PORT?: string;
}

export type DevProxyConfig = Record<
  string,
  { target: string; changeOrigin: boolean; timeout: number; proxyTimeout: number }
>;

/** How long the proxy waits for Django before answering 504, so no request hangs forever. */
export const DEV_PROXY_TIMEOUT_MS = 30_000;

/** The proxy's Django origin, validated. Throws with a message naming the bad variable. */
export function djangoDevTarget(env: DevProxyEnv): string {
  const explicit = (env.DJANGO_DEV_PROXY_TARGET ?? '').trim();
  const portSetting = (env.DJANGO_DEV_PORT ?? '').trim();
  let raw = DEFAULT_DJANGO_DEV_TARGET;
  if (explicit !== '') {
    raw = explicit;
  } else if (portSetting !== '') {
    const port = Number(portSetting);
    if (!/^\d+$/.test(portSetting) || port < 1 || port > 65_535) {
      throw new Error(`DJANGO_DEV_PORT must be a port number (1 to 65535); got "${portSetting}"`);
    }
    raw = `http://127.0.0.1:${port}`;
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`DJANGO_DEV_PROXY_TARGET is not a URL: ${raw}`);
  }
  if (!['http:', 'https:'].includes(url.protocol) || !LOOPBACK.has(url.hostname)) {
    throw new Error('DJANGO_DEV_PROXY_TARGET must be a loopback http(s) origin');
  }
  return url.origin;
}

export function djangoDevProxy(env: DevProxyEnv): DevProxyConfig {
  return {
    '/api': {
      target: djangoDevTarget(env),
      changeOrigin: false,
      timeout: DEV_PROXY_TIMEOUT_MS,
      proxyTimeout: DEV_PROXY_TIMEOUT_MS,
    },
  };
}
