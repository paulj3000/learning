import type { ApiClient } from './client';

/**
 * The account menu's link to Django Admin (LAI-0404, ADR-034).
 *
 * - `VITE_DJANGO_ADMIN_URL` is the admin's absolute URL, for example
 *   `https://api.example.com/admin/`. Unset (the default) means no link, so
 *   every existing build is unchanged. A production build only accepts
 *   `https://`; `http://` is for `vite dev` only.
 * - Whether to show it comes from Django (`POST /api/v1/me/` returns
 *   `django_admin`), never from token claims read in the browser. Django
 *   Admin checks its own staff sign-in on every page regardless.
 */

export interface DjangoAdminEnv {
  VITE_DJANGO_ADMIN_URL?: string;
  DEV?: boolean;
}

export function readDjangoAdminUrl(env: DjangoAdminEnv): string | null {
  const raw = (env.VITE_DJANGO_ADMIN_URL ?? '').trim();
  if (raw === '') return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const allowed = url.protocol === 'https:' || (env.DEV === true && url.protocol === 'http:');
  if (!allowed || url.username || url.password || url.search || url.hash) return null;
  if (!url.pathname.endsWith('/')) return null;
  return url.href;
}

export const DJANGO_ADMIN_URL: string | null = readDjangoAdminUrl(import.meta.env);

export interface DjangoAccount {
  id: string;
  /** Active Django Admin staff, as Django reports it. */
  djangoAdmin: boolean;
}

/**
 * Creates the signed-in parent's Django account the first time, and returns
 * it every time (`POST /api/v1/me/` is idempotent; ADR-024 A2). Null on any
 * failure: the app keeps working, and the next sign-in tries again.
 */
export async function provisionDjangoAccount(
  client: ApiClient,
  signal?: AbortSignal,
): Promise<DjangoAccount | null> {
  try {
    const response = await client.request('POST', 'me/', { signal });
    const data = response.data;
    if (typeof data !== 'object' || data === null) return null;
    const body = data as Record<string, unknown>;
    if (typeof body.id !== 'string' || body.id === '') return null;
    return { id: body.id, djangoAdmin: body.django_admin === true };
  } catch {
    return null; // signed out, offline, unavailable, or aborted
  }
}
