import { DJANGO_ADMIN_URL } from '../api/djangoAdmin';
import { useDjangoAccount } from '../features/auth/DjangoAccountContext';

/**
 * The Django Admin URL when Django confirmed, at this sign-in, that the
 * account is staff (`DjangoAccountProvider`); otherwise null. Also null in a
 * build without `VITE_DJANGO_ADMIN_URL`.
 */
export function useDjangoAdminLink(adminUrl: string | null = DJANGO_ADMIN_URL): string | null {
  const { djangoAdmin } = useDjangoAccount();
  return djangoAdmin && adminUrl !== null ? adminUrl : null;
}
