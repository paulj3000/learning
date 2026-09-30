import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useAuth } from '../features/auth/AuthContext';
import {
  countModelsByAdventure,
  getIsland,
  listAdventuresByIsland,
  setIslandActive,
  type Adventure,
  type Island,
} from '../features/admin/catalogApi';
import type { CatalogFlashState } from '../features/admin/catalog/formValues';
import { formatDate } from '../features/admin/catalog/formValues';
import { ActiveBadge } from '../features/admin/catalog/ActiveBadge';
import { SceneModelList } from '../features/admin/catalog/SceneModelList';
import { getIslandLocation } from '../features/island/locations';
import { AdminPageHeader } from '../features/admin/AdminPageHeader';
import { Alert } from '../features/admin/ui/Alert';
import { Button } from '../features/admin/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '../features/admin/ui/Card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../features/admin/ui/Table';

type LoadState = 'loading' | 'ready' | 'not-found' | 'error';

/**
 * `/admin/islands/:islandId`: one island and every adventure filed under it,
 * active or not (docs/ISLAND_ADVENTURE_MANAGEMENT.md section 12), and the
 * models its 3D scene loads.
 */
export function AdminIslandDetail() {
  const { islandId = '' } = useParams<{ islandId: string }>();
  const { userId } = useAuth();
  const location = useLocation();
  const flash = (location.state as CatalogFlashState | null)?.flash;
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [island, setIsland] = useState<Island | null>(null);
  const [adventures, setAdventures] = useState<Adventure[]>([]);
  const [modelCounts, setModelCounts] = useState<Map<string, number>>(new Map());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const load = useCallback(
    async (isCancelled: () => boolean = () => false) => {
      setLoadState('loading');
      try {
        const loaded = await getIsland(islandId);
        if (isCancelled()) return;
        if (!loaded) {
          setLoadState('not-found');
          return;
        }
        const [loadedAdventures, counts] = await Promise.all([
          listAdventuresByIsland(islandId),
          countModelsByAdventure(),
        ]);
        if (isCancelled()) return;
        setIsland(loaded);
        setAdventures(loadedAdventures);
        setModelCounts(counts);
        setLoadState('ready');
      } catch {
        if (!isCancelled()) setLoadState('error');
      }
    },
    [islandId],
  );

  useEffect(() => {
    let cancelled = false;
    void load(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function toggleActive() {
    if (!island || !userId) return;
    setBusy(true);
    setMessage(null);
    try {
      const updated = await setIslandActive(island.id, !island.active, userId);
      setIsland(updated);
      setMessage({
        kind: 'success',
        text: updated.active
          ? `${updated.name} is active. Its active adventures can be played again.`
          : `${updated.name} is inactive. Children cannot see it or play its adventures.`,
      });
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }

  const back = { to: '/admin/islands', label: 'Back to islands' };

  if (loadState !== 'ready' || !island) {
    return (
      <>
        <AdminPageHeader title="Island" back={back} />
        {loadState === 'loading' ? (
          <p className="text-sm text-muted-foreground">Loading the island...</p>
        ) : null}
        {loadState === 'not-found' ? (
          <Alert variant="destructive" role="alert">
            That island does not exist.
          </Alert>
        ) : null}
        {loadState === 'error' ? (
          <div className="grid justify-items-start gap-3">
            <Alert variant="destructive" role="alert">
              The island could not be loaded. Check your connection and try again.
            </Alert>
            <Button variant="outline" type="button" onClick={() => void load()}>
              Try again
            </Button>
          </div>
        ) : null}
      </>
    );
  }

  const linkedLocation = getIslandLocation(island.slug);

  return (
    <>
      <AdminPageHeader
        title={island.name}
        description={island.shortDescription ?? undefined}
        back={back}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to={`/admin/islands/${island.id}/edit`}>Edit Island</Link>
            </Button>
            <Button
              variant="outline"
              type="button"
              disabled={busy}
              onClick={() => void toggleActive()}
            >
              {island.active ? 'Deactivate Island' : 'Activate Island'}
            </Button>
            <Button asChild>
              <Link to={`/admin/islands/${island.id}/adventures/new`}>Create Adventure</Link>
            </Button>
          </>
        }
      />
      <div className="grid grid-cols-1 gap-4">
        {flash ? (
          <Alert variant="success" role="status">
            {flash}
          </Alert>
        ) : null}
        {message ? (
          <Alert
            variant={message.kind === 'success' ? 'success' : 'destructive'}
            role={message.kind === 'success' ? 'status' : 'alert'}
          >
            {message.text}
          </Alert>
        ) : null}

        <Card>
          <CardContent className="grid gap-4">
            <div className="flex items-center gap-2 text-sm">
              <span className="font-medium">Status:</span>
              <ActiveBadge active={island.active} />
            </div>
            <div className="grid gap-1">
              <h2 className="text-sm font-medium">Description</h2>
              <p className="text-sm whitespace-pre-line text-muted-foreground">
                {island.description ?? 'No description yet.'}
              </p>
            </div>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="font-medium">Slug</dt>
                <dd className="text-muted-foreground">{island.slug}</dd>
              </div>
              <div>
                <dt className="font-medium">Game content</dt>
                <dd className="text-muted-foreground">
                  {linkedLocation
                    ? `Linked to ${linkedLocation.title}`
                    : 'No island location with this slug yet'}
                </dd>
              </div>
              <div>
                <dt className="font-medium">Sort order</dt>
                <dd className="text-muted-foreground">{island.sortOrder}</dd>
              </div>
              <div>
                <dt className="font-medium">Created</dt>
                <dd className="text-muted-foreground">{formatDate(island.createdAt)}</dd>
              </div>
              <div>
                <dt className="font-medium">Last updated</dt>
                <dd className="text-muted-foreground">{formatDate(island.updatedAt)}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle asChild>
              <h2>Adventures</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {adventures.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No adventures have been created for this island yet.
              </p>
            ) : (
              <Table aria-label={`Adventures on ${island.name}`}>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">Adventure</TableHead>
                    <TableHead scope="col">Status</TableHead>
                    <TableHead scope="col" className="text-right">
                      Models
                    </TableHead>
                    <TableHead scope="col">Updated</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {adventures.map((adventure) => (
                    <TableRow key={adventure.id}>
                      <TableHead scope="row">
                        <Link
                          className="font-medium text-primary hover:underline"
                          to={`/admin/adventures/${adventure.id}`}
                        >
                          {adventure.name}
                        </Link>
                      </TableHead>
                      <TableCell>
                        <ActiveBadge active={adventure.active} />
                      </TableCell>
                      <TableCell className="text-right">
                        {modelCounts.get(adventure.id) ?? 0}
                      </TableCell>
                      <TableCell>{formatDate(adventure.updatedAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <SceneModelList islandSlug={island.slug} islandName={island.name} />
      </div>
    </>
  );
}
