import { apiCredentials } from '../../api/apiAuth';
import type { AuthMode } from '../../api/authMode';
import { createApiClient, type ApiClient } from '../../api/client';
import { AUTH_MODE, DJANGO_API_CONFIG } from '../../api/config';
import { isApiError } from '../../api/errors';
import { getChildProfile } from './api';
import { AGE_BAND_LABELS, type AgeBandValue } from './constants';

/**
 * The few child settings a play screen needs (LAI-AUTH-DUAL, ADR-038): the
 * age band, the parent's AI switch and the session limit. Null when the child
 * does not exist or is not this parent's.
 *
 * Cognito builds read them from Amplify Data, as before. A Django sign-in
 * build has no Amplify session, so it reads `GET /api/v1/children/<id>/`,
 * which Django scopes to the signed-in parent. This is the only child read
 * that moves for local sign-in; the parent dashboard's child management
 * stays on Amplify until LAI-0502 / LAI-0602.
 */
export interface ChildPlaySettings {
  ageBand: AgeBandValue;
  aiEnabled: boolean;
  sessionMinutes: number | null;
}

export async function getChildPlaySettings(
  childId: string,
  options: { mode?: AuthMode; client?: ApiClient } = {},
): Promise<ChildPlaySettings | null> {
  const mode = options.mode ?? AUTH_MODE;
  if (mode === 'django') {
    return readFromDjango(childId, options.client ?? djangoClient());
  }
  const child = await getChildProfile(childId);
  if (!child) return null;
  return {
    ageBand: child.ageBand as AgeBandValue,
    aiEnabled: child.aiEnabled ?? true,
    sessionMinutes: child.sessionMinutes ?? null,
  };
}

function djangoClient(): ApiClient {
  const baseUrl = DJANGO_API_CONFIG.enabled ? DJANGO_API_CONFIG.baseUrl : '';
  return createApiClient({ baseUrl, ...apiCredentials('django') });
}

async function readFromDjango(
  childId: string,
  client: ApiClient,
): Promise<ChildPlaySettings | null> {
  if (!childId) return null;
  try {
    const { data } = await client.request('GET', `children/${encodeURIComponent(childId)}/`);
    return parsePlaySettings(data);
  } catch (error) {
    if (isApiError(error) && error.kind === 'not_found') return null;
    throw error;
  }
}

export function parsePlaySettings(data: unknown): ChildPlaySettings | null {
  if (typeof data !== 'object' || data === null) return null;
  const body = data as Record<string, unknown>;
  const ageBand = body.ageBand;
  if (typeof ageBand !== 'string' || !(ageBand in AGE_BAND_LABELS)) return null;
  return {
    ageBand: ageBand as AgeBandValue,
    aiEnabled: body.aiEnabled !== false,
    sessionMinutes: typeof body.sessionMinutes === 'number' ? body.sessionMinutes : null,
  };
}
