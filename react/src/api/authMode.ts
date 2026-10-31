/**
 * Which sign-in the app uses (LAI-AUTH-DUAL, ADR-038). It must match the
 * Django API's `AUTH_PROVIDER`.
 *
 * - `cognito` (the default, and the only mode a production build accepts):
 *   Amplify Auth signs the parent in and every Django request carries the
 *   Cognito access token as a bearer token.
 * - `django` (`VITE_AUTH_PROVIDER=django`, `vite dev` only): the parent signs
 *   in with a local Django username and password, and requests carry the
 *   Django session cookie plus the CSRF token. No AWS is needed. It also
 *   needs `VITE_BACKEND=django`, since everything goes through the Vite proxy
 *   to the local Django.
 *
 * A wrong value is an error, not a silent fallback: `readAuthMode` throws, and
 * vite.config.ts calls it so a production build with `django` fails to build.
 * Pure on purpose (vite.config.ts imports it); the build's value is
 * `AUTH_MODE` in config.ts.
 */

export type AuthMode = 'cognito' | 'django';

export interface AuthModeEnv {
  VITE_AUTH_PROVIDER?: string;
  VITE_BACKEND?: string;
  DEV?: boolean;
}

export function readAuthMode(env: AuthModeEnv): AuthMode {
  const raw = (env.VITE_AUTH_PROVIDER ?? '').trim().toLowerCase();
  if (raw === '' || raw === 'cognito') return 'cognito';
  if (raw !== 'django') {
    throw new Error('VITE_AUTH_PROVIDER must be cognito or django.');
  }
  if (env.DEV !== true) {
    throw new Error('VITE_AUTH_PROVIDER=django is for local development (vite dev) only.');
  }
  if (env.VITE_BACKEND !== 'django') {
    throw new Error('VITE_AUTH_PROVIDER=django needs VITE_BACKEND=django.');
  }
  return 'django';
}
