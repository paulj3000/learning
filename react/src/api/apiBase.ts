/**
 * Pure parsing of `VITE_DJANGO_API_BASE` (see config.ts). No `import.meta`, so the Vite config
 * can use it too.
 */

export interface DjangoApiEnv {
  VITE_DJANGO_API_BASE?: string;
  DEV?: boolean;
}

/** The origin, or null when the value is not an acceptable API origin. */
export function parseApiBase(env: DjangoApiEnv): string | null {
  const base = (env.VITE_DJANGO_API_BASE ?? '').trim();
  if (base === '') return '';
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return null;
  }
  const allowed = url.protocol === 'https:' || (env.DEV === true && url.protocol === 'http:');
  if (!allowed || url.pathname !== '/' || url.search || url.hash) return null;
  return url.origin;
}

/** Throws with a message naming the variable; used by the Vite config before it starts. */
export function assertValidApiBase(env: DjangoApiEnv): void {
  if (parseApiBase(env) === null) {
    throw new Error(
      'VITE_DJANGO_API_BASE must be empty (same-origin) or an https:// origin with no path ' +
        `(http:// in vite dev only); got "${env.VITE_DJANGO_API_BASE}"`,
    );
  }
}
