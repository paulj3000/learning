import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../features/auth/AuthContext';
import { createIsland, listIslands, updateIsland, type Island } from '../features/admin/catalogApi';
import { CatalogForm } from '../features/admin/catalog/CatalogForm';
import {
  EMPTY_FORM_VALUES,
  formValuesFrom,
  nextSortOrder,
  toIslandInput,
  type CatalogFlashState,
} from '../features/admin/catalog/formValues';
import { AdminPageHeader } from '../features/admin/AdminPageHeader';
import { Alert } from '../features/admin/ui/Alert';
import type { AdventureFormValues } from '../features/catalog/validation';

type LoadState = 'loading' | 'ready' | 'not-found' | 'error';

/**
 * `/admin/islands/new` and `/admin/islands/:islandId/edit`
 * (docs/ISLAND_ADVENTURE_MANAGEMENT.md section 11). After a save it opens
 * the island's detail page with a confirmation.
 */
export function AdminIslandForm() {
  const { islandId } = useParams<{ islandId: string }>();
  const isEdit = islandId !== undefined;
  const { userId } = useAuth();
  const navigate = useNavigate();
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [initialValues, setInitialValues] = useState<AdventureFormValues>(EMPTY_FORM_VALUES);
  const [takenSlugs, setTakenSlugs] = useState<string[]>([]);
  const [island, setIsland] = useState<Island | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const islands = await listIslands();
        if (cancelled) return;
        const current = isEdit ? islands.find((entry) => entry.id === islandId) : undefined;
        if (isEdit && !current) {
          setLoadState('not-found');
          return;
        }
        setIsland(current ?? null);
        setTakenSlugs(islands.filter((entry) => entry.id !== islandId).map((entry) => entry.slug));
        setInitialValues(
          current
            ? formValuesFrom(current)
            : { ...EMPTY_FORM_VALUES, sortOrder: nextSortOrder(islands) },
        );
        setLoadState('ready');
      } catch {
        if (!cancelled) setLoadState('error');
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [isEdit, islandId]);

  async function handleSubmit(values: AdventureFormValues) {
    if (!userId) throw new Error('Your session has ended. Sign in again.');
    const input = toIslandInput(values);
    const saved = island
      ? await updateIsland(island.id, input, userId)
      : await createIsland(input, userId);
    const state: CatalogFlashState = {
      flash: island ? `Saved ${saved.name}.` : `Created ${saved.name}.`,
    };
    navigate(`/admin/islands/${saved.id}`, { state });
  }

  const back = island
    ? { to: `/admin/islands/${island.id}`, label: `Back to ${island.name}` }
    : { to: '/admin/islands', label: 'Back to islands' };

  return (
    <>
      <AdminPageHeader title={isEdit ? 'Edit island' : 'Create island'} back={back} />
      {loadState === 'loading' ? <p className="text-sm text-muted-foreground">Loading...</p> : null}
      {loadState === 'not-found' ? (
        <Alert variant="destructive" role="alert">
          That island does not exist.
        </Alert>
      ) : null}
      {loadState === 'error' ? (
        <Alert variant="destructive" role="alert">
          Something went wrong loading the islands. Check your connection and try again.
        </Alert>
      ) : null}
      {loadState === 'ready' ? (
        <CatalogForm
          kind="island"
          initialValues={initialValues}
          slugLocked={isEdit}
          takenSlugs={takenSlugs}
          submitLabel={isEdit ? 'Save island' : 'Create island'}
          cancelTo={back.to}
          onSubmit={handleSubmit}
        />
      ) : null}
    </>
  );
}
