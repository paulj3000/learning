import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  listAllChildProfiles,
  listAllParentProfiles,
  groupChildrenByParent,
} from '../features/admin/api';
import type { ParentWithChildren } from '../features/admin/api';
import { AGE_BAND_LABELS } from '../features/child-profile/constants';
import { AdminPageHeader } from '../features/admin/AdminPageHeader';
import { Alert } from '../features/admin/ui/Alert';
import { Badge } from '../features/admin/ui/Badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../features/admin/ui/Card';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * Read-only admin directory (CLAUDE.md section 2/10,
 * docs/AUTHORIZATION_REVIEW.md section 4.3): every parent account and their
 * child profiles, grouped by parent. Reachable only through
 * `RequireAdmin`/the Cognito `Admins` group. Each child links to
 * `AdminChildProgress` for that child's learning progress; nothing here is
 * editable — parents remain the only ones who can change a child's own
 * settings or delete their data.
 */
export function AdminDashboard() {
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [groups, setGroups] = useState<ParentWithChildren[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [parents, children] = await Promise.all([
          listAllParentProfiles(),
          listAllChildProfiles(),
        ]);
        if (cancelled) return;
        setGroups(groupChildrenByParent(parents, children));
        setLoadState('ready');
      } catch {
        if (cancelled) return;
        setLoadState('error');
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <AdminPageHeader
        title="Families"
        description="Every parent account and their child profiles. Read only."
      />
      {loadState === 'loading' ? (
        <p className="text-sm text-muted-foreground">Loading families...</p>
      ) : null}
      {loadState === 'error' ? (
        <Alert variant="destructive" role="alert">
          Something went wrong loading the admin directory.
        </Alert>
      ) : null}
      {loadState === 'ready' && groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">No parent accounts yet.</p>
      ) : null}
      {loadState === 'ready' && groups.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {groups.map(({ parent, children }) => (
            <Card key={parent.id}>
              <CardHeader>
                <CardTitle asChild>
                  <h2>{parent.displayName}</h2>
                </CardTitle>
                <CardDescription>
                  {parent.timezone ?? 'No timezone on file'} &middot; {children.length}{' '}
                  {children.length === 1 ? 'child' : 'children'}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {children.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No child profiles yet.</p>
                ) : (
                  <ul className="divide-y rounded-lg border">
                    {children.map((child) => (
                      <li
                        className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
                        key={child.id}
                      >
                        <div className="grid gap-0.5">
                          <Link
                            className="font-medium text-primary hover:underline"
                            to={`/admin/children/${child.id}`}
                          >
                            {child.nickname}
                          </Link>
                          <span className="text-sm text-muted-foreground">
                            {AGE_BAND_LABELS[child.ageBand]}
                          </span>
                        </div>
                        <Badge variant={child.active ? 'secondary' : 'outline'}>
                          {child.active ? 'Active' : 'Deactivated'}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}
    </>
  );
}
