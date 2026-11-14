import { readBackendSetting, resolveBackend } from './backend.ts';
import { djangoDevTarget, type DevProxyEnv } from './devProxy.ts';
import { readCognitoConfig, type CognitoEnv } from '../lib/cognito/config.ts';

/**
 * `vite dev` start-up diagnostics (P0): which backend the app uses, where `/api` goes and
 * whether Django answers there, and whether Cognito sign-in is configured. Development only:
 * the Vite config calls this from `configureServer`, which never runs for a build.
 *
 * Never prints a token, a password, a pool id or a client id. The Cognito line says only
 * whether it is configured, its region, and which file the setting came from.
 */

export interface DiagnosticsEnv extends DevProxyEnv, CognitoEnv {}

export type CognitoSource = 'react env' | 'root .env (COGNITO_*)' | null;

export interface DiagnosticsInput {
  env: DiagnosticsEnv;
  cognitoSource: CognitoSource;
  /** Result of GET <target>/api/v1/health/, or null when the proxy is off. */
  health: { ok: true } | { ok: false; reason: string } | null;
}

export function diagnosticsLines({ env, cognitoSource, health }: DiagnosticsInput): string[] {
  const lines: string[] = [];
  const backend = resolveBackend(env);
  const explicit = readBackendSetting(env) !== null;
  lines.push(
    `[lai] dev backend: ${backend ?? 'unknown'} (${explicit ? 'VITE_BACKEND' : 'default for vite dev'})`,
  );

  if (backend === 'django') {
    const target = djangoDevTarget(env);
    const from = (env.DJANGO_DEV_PROXY_TARGET ?? '').trim()
      ? 'DJANGO_DEV_PROXY_TARGET'
      : (env.DJANGO_DEV_PORT ?? '').trim()
        ? 'DJANGO_DEV_PORT'
        : 'default';
    lines.push(`[lai] dev API proxy: /api -> ${target} (${from})`);
    if (health?.ok) {
      lines.push('[lai] dev Django: reachable (GET /api/v1/health/ answered)');
    } else if (health) {
      const port = new URL(target).port;
      lines.push(
        `[lai] dev Django: NOT reachable at ${target} (${health.reason}). Start it with ` +
          `"make runserver DJANGO_DEV_PORT=${port}", or set DJANGO_DEV_PORT to the port it uses.`,
      );
    }
  } else {
    lines.push('[lai] dev API proxy: off (VITE_BACKEND is not "django"; the app needs the Django API)');
  }

  const cognito = readCognitoConfig(env);
  if (cognito) {
    lines.push(`[lai] dev Cognito: configured (region ${cognito.region}, from ${cognitoSource})`);
  } else {
    lines.push(
      '[lai] dev Cognito: NOT configured, so parent sign-in is off. Set VITE_COGNITO_USER_POOL_ID ' +
        'and VITE_COGNITO_CLIENT_ID in react/.env.local, or COGNITO_USER_POOL_ID and ' +
        'COGNITO_ALLOWED_CLIENT_IDS in the root .env.',
    );
  }
  return lines;
}

/**
 * The browser's Cognito settings for `vite dev`, falling back to the Django settings in the
 * repository-root `.env`, so one pool and client serve both sides. Production builds never
 * use this fallback: they name `VITE_COGNITO_*` explicitly (site-release).
 */
export function cognitoEnvFallback(
  reactEnv: CognitoEnv,
  rootEnv: { COGNITO_USER_POOL_ID?: string; COGNITO_ALLOWED_CLIENT_IDS?: string },
): { env: CognitoEnv; source: CognitoSource } {
  if (readCognitoConfig(reactEnv)) return { env: reactEnv, source: 'react env' };
  const derived: CognitoEnv = {
    VITE_COGNITO_USER_POOL_ID: rootEnv.COGNITO_USER_POOL_ID,
    // The first allowed client is the web app's (.env.sample).
    VITE_COGNITO_CLIENT_ID: (rootEnv.COGNITO_ALLOWED_CLIENT_IDS ?? '').split(',')[0]?.trim(),
  };
  if (readCognitoConfig(derived)) return { env: derived, source: 'root .env (COGNITO_*)' };
  return { env: reactEnv, source: null };
}

/** GET <target>/api/v1/health/ with a short bound. Never throws. */
export async function probeDjango(
  target: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 2_000,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const response = await fetchImpl(`${target}/api/v1/health/`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return response.ok ? { ok: true } : { ok: false, reason: `HTTP ${response.status}` };
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    return { ok: false, reason: name === 'TimeoutError' ? 'no answer in 2 s' : 'refused' };
  }
}
