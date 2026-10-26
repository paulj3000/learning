import { vi } from 'vitest';
import { withProvisioning } from '../api/backend';
import { createApiClient, type ApiClient } from '../api/client';

/**
 * A real Django `ApiClient` (bearer token, one 401 refresh, provisioning
 * retry) over a mocked `fetch` that answers `responses` in order.
 */
export function djangoTestClient(...responses: Array<Response | Error>) {
  const fetch = vi.fn<typeof globalThis.fetch>();
  for (const response of responses) {
    if (response instanceof Response) fetch.mockResolvedValueOnce(response);
    else fetch.mockRejectedValueOnce(response);
  }
  const client: ApiClient = withProvisioning(
    createApiClient({ baseUrl: 'https://lai.example', getAccessToken: async () => 'token', fetch }),
  );
  function call(index = 0) {
    const [url, init] = fetch.mock.calls[index];
    return {
      url: String(url),
      method: init?.method,
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
      authorization: (init?.headers as Record<string, string> | undefined)?.Authorization,
    };
  }
  return { client, fetch, call };
}
