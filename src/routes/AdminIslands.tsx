import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../features/auth/AuthContext';
import {
  importGameContent,
  listAdventures,
  listIslands,
  setIslandActive,
  type Island,
} from '../features/admin/catalogApi';
import type { CatalogFlashState } from '../features/admin/catalog/formValues';
import { formatDate } from '../features/admin/catalog/formValues';
import { ActiveBadge } from '../features/admin/catalog/ActiveBadge';
import { AdminPageHeader } from '../features/admin/AdminPageHeader';
import { Alert } from '../features/admin/ui/Alert';
import { Button } from '../features/admin/ui/Button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../features/admin/ui/Table';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * `/admin/islands`: every island in the catalog, active or not
 * (docs/ISLAND_ADVENTURE_MANAGEMENT.md section 10). "Import game content"
 * adds a catalog row for each source-controlled island and adventure that
 * does not have one yet (ADR-024).
 */
export function AdminIslands() {
  const { userId } = useAuth();
  const location = useLocation();
  const flash = (location.state as CatalogFlashState | null)?.flash;
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [islands, setIslands] = useState<Island[]>([]);
  const [adventureCounts, setAdventureCounts] = useState<Map<string, number>>(new Map());
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const load = useCallback(async (isCancelled: () => boolean = () => false) => {
    setLoadState('loading');
    try {
      const [loadedIslands, adventures] = await Promise.all([listIslands(), listAdventures()]);
      if (isCancelled()) return;
      const counts = new Map<string, number>();
      for (const adventure of adventures) {
        counts.set(adventure.islandId, (counts.get(adventure.islandId) ?? 0) + 1);
      }
      setIslands(loadedIslands);
      setAdventureCounts(counts);
      setLoadState('ready');
    } catch {
      if (isCancelled()) return;
      setLoadState('error');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void load(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function toggleActive(island: Island) {
    if (!userId) return;
    setBusyId(island.id);
    setMessage(null);
    try {
      const updated = await setIslandActive(island.id, !island.active, userId);
      setIslands((current) => current.map((entry) => (entry.id === updated.id ? updated : entry)));
      setMessage({
        kind: 'success',
        text: `${updated.name} is now ${updated.active ? 'active' : 'inactive'}.`,
      });
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusyId(null);
    }
  }

  async function handleImport() {
    if (!userId) return;
    setImporting(true);
    setMessage(null);
    try {
      const result = await importGameContent(userId);
      const skipped = result.skipped.length
        ? ` Skipped with no island: ${result.skipped.join(', ')}.`
        : '';
      setMessage({
        kind: 'success',
        text: `Imported ${result.islandsCreated} islands and ${result.adventuresCreated} adventures.${skipped}`,
      });
      await load();
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
    } finally {
      setImporting(false);
    }
  }

  return (
    <>
      <AdminPageHeader
        title="Islands"
        description="Every island, including inactive ones. An inactive island is hidden from children and none of its adventures can be played."
        actions={
          <>
            <Button
              variant="outline"
              type="button"
              disabled={importing || loadState !== 'ready'}
              onClick={() => void handleImport()}
            >
              {importing ? 'Importing...' : 'Import game content'}
            </Button>
            <Button asChild>
              <Link to="/admin/islands/new">Create Island</Link>
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

        {loadState === 'loading' ? (
          <p className="text-sm text-muted-foreground">Loading islands...</p>
        ) : null}
        {loadState === 'error' ? (
          <div className="grid justify-items-start gap-3">
            <Alert variant="destructive" role="alert">
              The island list could not be loaded. Check your connection and try again.
            </Alert>
            <Button variant="outline" type="button" onClick={() => void load()}>
              Try again
            </Button>
          </div>
        ) : null}
        {loadState === 'ready' && islands.length === 0 ? (
          <div className="grid gap-1 text-sm text-muted-foreground">
            <p>No islands have been created yet.</p>
            <p>
              <Link className="font-medium text-primary hover:underline" to="/admin/islands/new">
                Create your first island.
              </Link>{' '}
              Or use Import game content to add the islands the game already has.
            </p>
          </div>
        ) : null}
        {loadState === 'ready' && islands.length > 0 ? (
          <div className="rounded-xl border bg-card shadow-sm">
            <Table aria-label="Islands">
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Island</TableHead>
                  <TableHead scope="col">Status</TableHead>
                  <TableHead scope="col" className="text-right">
                    Adventures
                  </TableHead>
                  <TableHead scope="col">Updated</TableHead>
                  <TableHead scope="col">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {islands.map((island) => (
                  <TableRow key={island.id}>
                    <TableHead scope="row">
                      <Link
                        className="font-medium text-primary hover:underline"
                        to={`/admin/islands/${island.id}`}
                      >
                        {island.name}
                      </Link>
                    </TableHead>
                    <TableCell>
                      <ActiveBadge active={island.active} />
                    </TableCell>
                    <TableCell className="text-right">
                      {adventureCounts.get(island.id) ?? 0}
                    </TableCell>
                    <TableCell>{formatDate(island.updatedAt)}</TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button variant="ghost" size="sm" asChild>
                          <Link
                            to={`/admin/islands/${island.id}`}
                            aria-label={`View ${island.name}`}
                          >
                            View
                          </Link>
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          type="button"
                          disabled={busyId === island.id}
                          aria-label={`${island.active ? 'Deactivate' : 'Activate'} ${island.name}`}
                          onClick={() => void toggleActive(island)}
                        >
                          {island.active ? 'Deactivate' : 'Activate'}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}
      </div>
    </>
  );
}
