import {
  parsePlayerAvatar,
  type PlayerAvatarAnswer,
} from '../../features/island-map/three/playerAvatarCatalog';
import { getAccessToken } from '../auth';
import { createApiClient, type ApiClient } from '../client';
import { DJANGO_API_CONFIG, type DjangoApiConfig } from '../config';

/**
 * The child's 3D avatar (LAI-JMP-01c): `GET children/<child>/avatar/`. Child-scoped on the
 * server, so only the parent of that child can read it, and it answers for the child's own
 * `avatarKey` only.
 *
 * Never throws: a failed request, a malformed answer, or a build without the Django API all
 * mean `null`, which the game draws as the placeholder. A child is never kept from playing by
 * their avatar.
 */
export function childAvatarPath(childId: string): string {
  return `children/${encodeURIComponent(childId)}/avatar/`;
}

export async function fetchChildAvatar(
  client: ApiClient,
  childId: string,
  signal?: AbortSignal,
): Promise<PlayerAvatarAnswer | null> {
  try {
    const response = await client.request(
      'GET',
      childAvatarPath(childId),
      signal ? { signal } : {},
    );
    return parsePlayerAvatar(response.data);
  } catch {
    return null;
  }
}

/** The child's avatar answer, or `null` when this build has no Django API. */
export function childAvatarFor(
  childId: string,
  config: DjangoApiConfig = DJANGO_API_CONFIG,
): Promise<PlayerAvatarAnswer | null> {
  if (!config.enabled || !childId) return Promise.resolve(null);
  return fetchChildAvatar(createApiClient({ baseUrl: config.baseUrl, getAccessToken }), childId);
}
