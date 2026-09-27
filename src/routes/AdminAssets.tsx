import { Link } from 'react-router-dom';
import { AdminPageHeader } from '../features/admin/AdminPageHeader';
import { Badge } from '../features/admin/ui/Badge';
import { Card, CardDescription, CardHeader, CardTitle } from '../features/admin/ui/Card';

interface AssetTypeEntry {
  title: string;
  description: string;
  /** Present only for asset types the manager can handle today. */
  to?: string;
}

/**
 * The asset types docs/android/ASSET_MANAGEMENT.md section 2 plans for.
 * Only models are built; the rest are listed so the admin can see where
 * they will live, not linked to empty pages.
 */
const ASSET_TYPES: AssetTypeEntry[] = [
  {
    title: 'Models',
    description: 'GLB models for characters, props, buildings, and environments.',
    to: '/admin/assets/models',
  },
  { title: 'Textures', description: 'Shared PNG, JPG, WEBP, and KTX2 textures. Not built yet.' },
  { title: 'Animations', description: 'Reusable animation clips. Not built yet.' },
  { title: 'Audio', description: 'Voices, music, and sound effects. Not built yet.' },
  { title: 'Images', description: 'Illustrations and interface art. Not built yet.' },
  { title: 'Environments', description: 'Skyboxes and lighting setups. Not built yet.' },
];

/** `/admin/assets`: the Model Asset Manager's entry point. Reachable only through `RequireAdmin`. */
export function AdminAssets() {
  return (
    <>
      <AdminPageHeader
        title="Game assets"
        description="Assets are stored in S3 and referenced by id. Uploading an asset never makes it visible to children; an administrator has to publish it first."
      />
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {ASSET_TYPES.map((type) => (
          <li key={type.title}>
            <Card className="h-full">
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle asChild>
                    <h2 className="text-base">
                      {type.to ? (
                        <Link className="text-primary hover:underline" to={type.to}>
                          {type.title}
                        </Link>
                      ) : (
                        type.title
                      )}
                    </h2>
                  </CardTitle>
                  {type.to ? null : <Badge variant="outline">Planned</Badge>}
                </div>
                <CardDescription>{type.description}</CardDescription>
              </CardHeader>
            </Card>
          </li>
        ))}
      </ul>
    </>
  );
}
