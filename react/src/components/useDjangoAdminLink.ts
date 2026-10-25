import { useEffect, useState } from 'react';
import { getAccessToken } from '../api/auth';
import { createApiClient } from '../api/client';
import { DJANGO_API_CONFIG, type DjangoApiConfig } from '../api/config';
import { DJANGO_ADMIN_URL, fetchDjangoAdminAccess } from '../api/djangoAdmin';
import { useAuth } from '../features/auth/AuthContext';

/**
 * The Django Admin URL when Django confirms the signed-in account is staff,
 * otherwise null. Asks once per sign-in, and only in a build that has both
 * the Django API and `VITE_DJANGO_ADMIN_URL` configured.
 */
export function useDjangoAdminLink(
  config: DjangoApiConfig = DJANGO_API_CONFIG,
  adminUrl: string | null = DJANGO_ADMIN_URL,
): string | null {
  const { status, userId } = useAuth();
  const [verifiedFor, setVerifiedFor] = useState<string | null>(null);
  const ready = config.enabled && adminUrl !== null && status === 'authenticated' && !!userId;
  const baseUrl = config.enabled ? config.baseUrl : '';

  useEffect(() => {
    if (!ready || !userId) return;
    const controller = new AbortController();
    const client = createApiClient({ baseUrl, getAccessToken });
    void fetchDjangoAdminAccess(client, controller.signal).then((isStaff) => {
      if (!controller.signal.aborted) setVerifiedFor(isStaff ? userId : null);
    });
    return () => controller.abort();
  }, [ready, baseUrl, userId]);

  return ready && verifiedFor === userId ? adminUrl : null;
}
