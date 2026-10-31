import { getAccessToken } from './auth';
import type { AuthMode } from './authMode';
import type { ApiCredentials } from './client';
import { AUTH_MODE, DJANGO_API_CONFIG } from './config';
import { createSessionAuth, type SessionAuth } from './session';

/**
 * The credential every Django API client in this build uses (ADR-038): the
 * Cognito access token, or the local Django session. One shared session
 * object, so the CSRF token is fetched once and reset in one place.
 */
export const SESSION_AUTH: SessionAuth = createSessionAuth({
  baseUrl: DJANGO_API_CONFIG.enabled ? DJANGO_API_CONFIG.baseUrl : '',
});

export function apiCredentials(mode: AuthMode = AUTH_MODE): ApiCredentials {
  return mode === 'django' ? { session: SESSION_AUTH } : { getAccessToken };
}
