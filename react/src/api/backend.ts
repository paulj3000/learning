import { getAccessToken } from './auth';
import { createApiClient, type ApiClient } from './client';
import { BACKEND_SELECTION, type BackendSelection } from './config';
import { ApiError, isApiError } from './errors';

/**
 * The Django client the profile modules share (LAI-0501A), plus the rule for
 * a parent whose Django account does not exist yet.
 *
 * `DjangoAccountProvider` provisions the account (`POST /api/v1/me/`) once
 * per sign-in, but a screen can ask for children before that call returns.
 * Django answers that with `403 account_not_provisioned`, and the documented
 * remedy is to provision and retry (docs/android/ANDROID_API_CONTRACT.md,
 * "Errors"). This does exactly that, once per request. `POST me/` is
 * idempotent and takes the identity from the verified token only, so the
 * retry can neither create a second account nor pick an owner.
 */
export function withProvisioning(client: ApiClient): ApiClient {
  return {
    async request(method, path, options) {
      try {
        return await client.request(method, path, options);
      } catch (error) {
        if (!isNotProvisioned(error) || path === 'me/') throw error;
        await client.request('POST', 'me/', { signal: options?.signal });
        return client.request(method, path, options);
      }
    },
  };
}

function isNotProvisioned(error: unknown): boolean {
  return isApiError(error) && error.kind === 'forbidden' && error.code === 'account_not_provisioned';
}

let shared: { baseUrl: string; client: ApiClient } | null = null;

/**
 * The Django client for this build's backend selection. Throws
 * `ApiError('disabled')` for an Amplify or misconfigured build, so a module
 * that reaches here by mistake fails instead of calling the wrong backend.
 */
export function djangoClient(selection: BackendSelection = BACKEND_SELECTION): ApiClient {
  if (selection.backend !== 'django') {
    throw new ApiError('disabled', {
      code: selection.backend === 'misconfigured' ? selection.reason : 'amplify_backend',
    });
  }
  if (shared?.baseUrl !== selection.baseUrl) {
    shared = {
      baseUrl: selection.baseUrl,
      client: withProvisioning(createApiClient({ baseUrl: selection.baseUrl, getAccessToken })),
    };
  }
  return shared.client;
}
