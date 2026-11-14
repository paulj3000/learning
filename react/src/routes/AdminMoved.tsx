import { DJANGO_ADMIN_URL } from '../api/djangoAdmin';
import { AdminPageHeader } from '../features/admin/AdminPageHeader';

/**
 * Every `/admin/*` address (AMP-03). The React admin pages read Amplify Data across families
 * and edited the Amplify catalog; both are retired. Families, child progress, islands, places,
 * adventures and assets are administered in Django Admin (ADR-034, ADR-043), which checks its
 * own staff sign-in on every page. This page only points there.
 */
export function AdminMoved({ adminUrl = DJANGO_ADMIN_URL }: { adminUrl?: string | null }) {
  return (
    <section className="grid gap-4">
      <AdminPageHeader
        title="Administration has moved"
        description="Families, progress, islands, places and adventures are managed in the administration site."
      />
      {adminUrl ? (
        <p>
          <a className="font-medium text-primary hover:underline" href={adminUrl}>
            Open the administration site
          </a>
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          Ask the team for the administration site address.
        </p>
      )}
    </section>
  );
}
