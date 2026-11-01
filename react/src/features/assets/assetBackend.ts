import { getAccessToken } from '../../api/auth';
import {
  createAssetAdminApi,
  uploadAssetVersion,
  type AssetAdminApi,
  type UploadProgress,
  type VersionUploadHandle,
} from '../../api/assets/djangoAssetAdmin';
import { createApiClient } from '../../api/client';
import { DJANGO_API_CONFIG, type DjangoApiConfig } from '../../api/config';

/**
 * Which asset manager this build's admin pages use (AM-15, ADR-042).
 *
 * - `django` (a build with `VITE_BACKEND=django`): the Django asset manager.
 *   Files go to Django, which checks and stores them; the browser needs no
 *   Amplify Storage and no bucket access.
 * - `amplify` (today's production build): the Amplify `Asset` records and
 *   Amplify Storage, unchanged until cutover. LAI-1301 removes that branch.
 */
export type AssetManagerBackend = 'django' | 'amplify';

export function assetManagerBackend(
  config: DjangoApiConfig = DJANGO_API_CONFIG,
): AssetManagerBackend {
  return config.enabled ? 'django' : 'amplify';
}

export interface DjangoAssetManager {
  api: AssetAdminApi;
  upload: (
    assetId: string,
    file: File,
    onProgress?: (progress: UploadProgress) => void,
  ) => VersionUploadHandle;
}

let manager: DjangoAssetManager | null = null;

/** The Django asset manager for this build, or null when the build has no Django API. */
export function djangoAssetManager(
  config: DjangoApiConfig = DJANGO_API_CONFIG,
): DjangoAssetManager | null {
  if (!config.enabled) return null;
  if (config === DJANGO_API_CONFIG && manager) return manager;
  const client = createApiClient({
    baseUrl: config.baseUrl,
    getAccessToken,
    provisionAccount: true,
  });
  const created: DjangoAssetManager = {
    api: createAssetAdminApi(client),
    upload: (assetId, file, onProgress) =>
      uploadAssetVersion(assetId, file, { baseUrl: config.baseUrl, getAccessToken, onProgress }),
  };
  if (config === DJANGO_API_CONFIG) manager = created;
  return created;
}
