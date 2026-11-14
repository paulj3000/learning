import { getAccessToken } from './auth';
import { createApiClient, type ApiClient } from './client';
import { DJANGO_API_CONFIG, type DjangoApiConfig } from './config';

/**
 * The one Django client for per-child state that used to live in Amplify Data (AMP-03): world
 * changes, sessions, stories, quests, NPCs, the backpack, mastery reads, saved stories, the
 * companion choice, availability and account deletion.
 *
 * These modules have no Amplify branch any more, so Django is their only backend. A build with
 * `VITE_BACKEND=django` uses its configured origin; any other build calls the same origin
 * (`/api/v1/`), which is the deployed shape (CloudFront routes `/api/` to Django). Created on
 * first use, and it provisions a first-time parent's Django account itself.
 */
export function djangoBaseUrl(config: DjangoApiConfig = DJANGO_API_CONFIG): string {
  return config.baseUrl;
}

let client: ApiClient | null = null;

export function djangoClient(): ApiClient {
  client ??= createApiClient({
    baseUrl: djangoBaseUrl(),
    getAccessToken,
    provisionAccount: true,
  });
  return client;
}

/** `children/<id>/<rest>`, with the child id encoded. */
export function childPath(childProfileId: string, rest: string): string {
  return `children/${encodeURIComponent(childProfileId)}/${rest}`;
}
