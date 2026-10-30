import { ApiError, kindForStatus, type ValidationDetail } from './errors';

/**
 * A minimal JSON client for the Django API (TR-6). It knows the transport
 * and the error envelope, nothing about gameplay.
 *
 * - Every request carries `Authorization: Bearer <access token>`, asked for
 *   fresh each time (`getAccessToken`). No token at all is `unauthenticated`
 *   without a network call.
 * - A 401 is retried exactly once with a forced token refresh, so an access
 *   token that expired a moment ago does not look like a signed-out parent.
 *   A second 401 is `unauthenticated`: the parent must sign in again.
 * - A 503 is `unavailable` and never treated as signed out (ADR-024).
 * - With `provisionAccount`, a `403 account_not_provisioned` (a valid
 *   Cognito sign-in whose parent account Django has not set up yet) is
 *   answered by the explicit onboarding call, `POST me/` (ADR-024: the
 *   account is created only by that endpoint, never by authentication), and
 *   the request is retried once. Concurrent requests share one setup call.
 *   If setup fails the error is `forbidden` / `account_setup_failed`, never
 *   `unauthenticated`: the parent is signed in, so "sign in again" would be
 *   wrong.
 * - Every failure is an `ApiError`; nothing else is thrown.
 */

export type HttpMethod = 'GET' | 'POST';

export interface ApiClientOptions {
  baseUrl: string;
  getAccessToken: (options?: { forceRefresh?: boolean }) => Promise<string | null>;
  fetch?: typeof fetch;
  /** Set up the Django parent account on first use (`POST me/`); see above. */
  provisionAccount?: boolean;
}

export interface RequestOptions {
  body?: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface ApiClient {
  request(method: HttpMethod, path: string, options?: RequestOptions): Promise<ApiResponse>;
}

export interface ApiResponse {
  status: number;
  data: unknown;
}

export const API_PREFIX = '/api/v1/';
export const ACCOUNT_PATH = 'me/';
export const ACCOUNT_NOT_PROVISIONED = 'account_not_provisioned';
export const ACCOUNT_SETUP_FAILED = 'account_setup_failed';

export function createApiClient(options: ApiClientOptions): ApiClient {
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);

  async function send(
    method: HttpMethod,
    path: string,
    request: RequestOptions,
    forceRefresh: boolean,
  ): Promise<Response> {
    let token: string | null;
    try {
      token = await options.getAccessToken({ forceRefresh });
    } catch {
      throw new ApiError('unauthenticated', { code: 'token_unavailable' });
    }
    if (!token) throw new ApiError('unauthenticated', { code: 'not_signed_in' });

    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    };
    const init: RequestInit = { method, headers, signal: request.signal };
    if (method === 'POST') {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(request.body ?? {});
    }
    try {
      return await doFetch(`${options.baseUrl}${API_PREFIX}${path}`, init);
    } catch (error) {
      if (
        request.signal?.aborted ||
        (error instanceof DOMException && error.name === 'AbortError')
      ) {
        throw new ApiError('aborted');
      }
      throw new ApiError('network');
    }
  }

  async function attempt(
    method: HttpMethod,
    path: string,
    request: RequestOptions,
  ): Promise<ApiResponse> {
    let response = await send(method, path, request, false);
    if (response.status === 401) response = await send(method, path, request, true);
    const data = await readJson(response, request.signal);
    if (response.ok) return { status: response.status, data };
    throw errorFromEnvelope(response.status, data);
  }

  let provisioning: Promise<void> | null = null;
  function provision(): Promise<void> {
    provisioning ??= attempt('POST', ACCOUNT_PATH, {})
      .then(() => undefined)
      .catch((error: unknown) => {
        if (
          error instanceof ApiError &&
          (error.kind === 'unauthenticated' || error.kind === 'network')
        )
          throw error;
        throw new ApiError('forbidden', { status: 403, code: ACCOUNT_SETUP_FAILED });
      })
      .finally(() => {
        provisioning = null;
      });
    return provisioning;
  }

  return {
    async request(method, path, request = {}) {
      try {
        return await attempt(method, path, request);
      } catch (error) {
        const notProvisioned =
          error instanceof ApiError &&
          error.status === 403 &&
          error.code === ACCOUNT_NOT_PROVISIONED;
        if (!notProvisioned || !options.provisionAccount || path === ACCOUNT_PATH) throw error;
      }
      await provision();
      return attempt(method, path, request);
    },
  };
}

async function readJson(response: Response, signal?: AbortSignal): Promise<unknown> {
  if (response.status === 204) return null;
  try {
    return await response.json();
  } catch {
    if (signal?.aborted) throw new ApiError('aborted');
    if (!response.ok) return null; // e.g. an HTML 502 from a proxy: the status says enough
    throw new ApiError('invalid_response', { status: response.status, code: 'not_json' });
  }
}

/** Reads `{"error": {"code", "message", "details"}, "request_id"}` defensively. */
export function errorFromEnvelope(status: number, data: unknown): ApiError {
  const body = isRecord(data) ? data : {};
  const error = isRecord(body.error) ? body.error : {};
  const code = typeof error.code === 'string' ? error.code : undefined;
  const requestId = typeof body.request_id === 'string' ? body.request_id : null;
  return new ApiError(kindForStatus(status), {
    status,
    code,
    requestId,
    details: readDetails(error.details),
  });
}

function readDetails(value: unknown): Record<string, readonly ValidationDetail[]> {
  if (!isRecord(value)) return {};
  const details: Record<string, ValidationDetail[]> = {};
  for (const [field, entries] of Object.entries(value)) {
    if (!Array.isArray(entries)) continue;
    details[field] = entries.filter(isRecord).map((entry) => ({
      message: typeof entry.message === 'string' ? entry.message : '',
      code: typeof entry.code === 'string' ? entry.code : 'invalid',
    }));
  }
  return details;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
