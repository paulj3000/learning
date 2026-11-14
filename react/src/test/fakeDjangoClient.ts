import { vi } from 'vitest';
import type { ApiClient, ApiResponse, HttpMethod, RequestOptions } from '../api/client';
import { ApiError } from '../api/errors';

/**
 * A scripted stand-in for the Django API client (AMP-03 tests). Each route is
 * `"<METHOD> <path>"`, answered by a handler that receives the request body and returns the
 * response data, or throws an `ApiError`. An unscripted route is a 404, like the real API.
 * `calls` records every request, so a test can assert exactly what was sent.
 */
export type FakeHandler = (body: Record<string, unknown> | undefined) => unknown;

export interface FakeDjangoClient extends ApiClient {
  calls: { method: HttpMethod; path: string; body?: Record<string, unknown> }[];
  on(method: HttpMethod, path: string, handler: FakeHandler | unknown): FakeDjangoClient;
}

export function fakeDjangoClient(): FakeDjangoClient {
  const routes = new Map<string, FakeHandler>();
  const calls: FakeDjangoClient['calls'] = [];
  const client: FakeDjangoClient = {
    calls,
    on(method, path, handler) {
      routes.set(
        `${method} ${path}`,
        typeof handler === 'function' ? (handler as FakeHandler) : () => handler,
      );
      return client;
    },
    request: vi.fn(async (method: HttpMethod, path: string, options: RequestOptions = {}) => {
      calls.push({ method, path, ...(options.body ? { body: options.body } : {}) });
      const handler = routes.get(`${method} ${path}`);
      if (!handler) throw new ApiError('not_found', { status: 404, code: 'not_found' });
      const data = handler(options.body);
      return { status: 200, data } satisfies ApiResponse;
    }),
  };
  return client;
}
