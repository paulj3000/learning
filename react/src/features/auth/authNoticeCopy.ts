/** Copy and dev-hint switch for AuthStatusNotice.tsx (kept apart so that file exports only components). */

/** How long reading the Cognito session may take (it can refresh tokens over the network). */
export const AUTH_CHECK_TIMEOUT_MS = 15_000;

export const AUTH_UNCONFIGURED_COPY = {
  heading: 'Parent sign-in is not available right now',
  lead: 'Please try again a little later.',
} as const;

export const AUTH_UNAVAILABLE_COPY = {
  heading: 'We could not reach parent sign-in',
  lead: 'Check your internet connection, then try again.',
  retry: 'Try again',
} as const;

/** Developer-only guidance for an unconfigured local build. Never shown in production. */
export const AUTH_DEV_HINT =
  'Developer note: set VITE_COGNITO_USER_POOL_ID and VITE_COGNITO_CLIENT_ID in react/.env.local (see react/.env.example), then restart npm run dev.';

export function showDevHints(): boolean {
  return import.meta.env.DEV && import.meta.env.MODE !== 'test';
}
