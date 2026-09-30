import { getSceneAssets } from '../../island-map/three/assets/sceneAssets';
import type { AssetKind } from '../../island-map/three/assets/manifest';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/Card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/Table';

const KIND_LABELS: Record<AssetKind, string> = {
  'kit-piece': 'Kit piece',
  character: 'Character',
  prop: 'Prop',
  collectible: 'Collectible',
};

/**
 * The Scene models section of an island's admin page: the models its 3D
 * scene loads, read from `SCENE_ASSET_IDS` and the asset manifest. Read-only
 * on purpose. These files ship with the app in `public/models/`, not in the
 * S3-backed asset manager, so there is nothing here an admin can change.
 */
export function SceneModelList({
  islandSlug,
  islandName,
}: {
  islandSlug: string;
  islandName: string;
}) {
  const entries = getSceneAssets(islandSlug);

  return (
    <Card>
      <CardHeader>
        <CardTitle asChild>
          <h2>Scene models</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        {entries === undefined ? (
          <p className="text-sm text-muted-foreground">
            The models for this island&apos;s scene have not been catalogued yet.
          </p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              These models ship with the app in public/models. They are not managed by the model
              asset manager.
            </p>
            <Table aria-label={`Scene models on ${islandName}`}>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Model</TableHead>
                  <TableHead scope="col">Kind</TableHead>
                  <TableHead scope="col">File</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableHead scope="row" className="font-medium">
                      {entry.id}
                    </TableHead>
                    <TableCell>{KIND_LABELS[entry.kind]}</TableCell>
                    <TableCell className="font-mono text-xs">{entry.url}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        )}
      </CardContent>
    </Card>
  );
}
