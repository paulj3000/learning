import type { ApiClient } from './client';

/**
 * The account menu's link to Django Admin (LAI-0404, ADR-034).
 *
 * - `VITE_DJANGO_ADMIN_URL` is the admin's absolute URL, for example
 *   `https://api.example.com/admin/`. Unset (the default) means no link, so
 *   every existing build is unchanged. A production build only accepts
 *   `https://`; `http://` is for `vite dev` only.
 * - Whether to show it comes from Django (`GET /api/v1/me/` returns
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

/** True only when Django says this signed-in account is active Django Admin staff. */
export async function fetchDjangoAdminAccess(
  client: ApiClient,
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    const response = await client.request('GET', 'me/', { signal });
    const data: unknown = response.data;
    return (
      typeof data === 'object' &&
      data !== null &&
      (data as Record<string, unknown>).django_admin === true
    );
  } catch {
    return false; // signed out, not provisioned, offline, or aborted: no link
  }
}
