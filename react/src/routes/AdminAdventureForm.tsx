import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../features/auth/AuthContext';
import {
  createAdventure,
  listAdventures,
  listIslands,
  updateAdventure,
  type Adventure,
  type Island,
} from '../features/admin/catalogApi';
import { CatalogForm } from '../features/admin/catalog/CatalogForm';
import {
  EMPTY_FORM_VALUES,
  formValuesFrom,
  nextSortOrder,
  toAdventureInput,
  type CatalogFlashState,
} from '../features/admin/catalog/formValues';
import { AdminPageHeader } from '../features/admin/AdminPageHeader';
import { Alert } from '../features/admin/ui/Alert';
import type { AdventureFormValues } from '../features/catalog/validation';

type LoadState = 'loading' | 'ready' | 'not-found' | 'error';

/**
 * `/admin/adventures/new`, `/admin/islands/:islandId/adventures/new` (the
 * island preselected) and `/admin/adventures/:adventureId/edit`
 * (docs/ISLAND_ADVENTURE_MANAGEMENT.md section 14).
 */
export function AdminAdventureForm() {
  const { adventureId, islandId: presetIslandId } = useParams<{
    adventureId: string;
    islandId: string;
  }>();
  const isEdit = adventureId !== undefined;
  const { userId } = useAuth();
  const navigate = useNavigate();
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [islands, setIslands] = useState<Island[]>([]);
  const [takenSlugs, setTakenSlugs] = useState<string[]>([]);
  const [adventure, setAdventure] = useState<Adventure | null>(null);
  const [initialValues, setInitialValues] = useState<AdventureFormValues>(EMPTY_FORM_VALUES);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [loadedIslands, adventures] = await Promise.all([listIslands(), listAdventures()]);
        if (cancelled) return;
        const current = isEdit ? adventures.find((entry) => entry.id === adventureId) : undefined;
        if (isEdit && !current) {
          setLoadState('not-found');
          return;
        }
        if (presetIslandId && !loadedIslands.some((island) => island.id === presetIslandId)) {
          setLoadState('not-found');
          return;
        }
        setIslands(loadedIslands);
        setAdventure(current ?? null);
        setTakenSlugs(
          adventures.filter((entry) => entry.id !== adventureId).map((entry) => entry.slug),
        );
        const siblings = adventures.filter((entry) => entry.islandId === presetIslandId);
        setInitialValues(
          current
            ? formValuesFrom(current)
            : {
                ...EMPTY_FORM_VALUES,
                islandId: presetIslandId ?? '',
                sortOrder: nextSortOrder(presetIslandId ? siblings : adventures),
              },
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
  }, [isEdit, adventureId, presetIslandId]);

  async function handleSubmit(values: AdventureFormValues) {
    if (!userId) throw new Error('Your session has ended. Sign in again.');
    const input = toAdventureInput(values);
    const saved = adventure
      ? await updateAdventure(adventure.id, input, userId)
      : await createAdventure(input, userId);
    const state: CatalogFlashState = {
      flash: adventure ? `Saved ${saved.name}.` : `Created ${saved.name}.`,
    };
    navigate(`/admin/adventures/${saved.id}`, { state });
  }

  const presetIsland = islands.find((island) => island.id === presetIslandId);
  const back = adventure
    ? { to: `/admin/adventures/${adventure.id}`, label: `Back to ${adventure.name}` }
    : presetIsland
      ? { to: `/admin/islands/${presetIsland.id}`, label: `Back to ${presetIsland.name}` }
      : { to: '/admin/adventures', label: 'Back to adventures' };

  return (
    <>
      <AdminPageHeader title={isEdit ? 'Edit adventure' : 'Create adventure'} back={back} />
      {loadState === 'loading' ? <p className="text-sm text-muted-foreground">Loading...</p> : null}
      {loadState === 'not-found' ? (
        <Alert variant="destructive" role="alert">
          {isEdit ? 'That adventure does not exist.' : 'That island does not exist.'}
        </Alert>
      ) : null}
      {loadState === 'error' ? (
        <Alert variant="destructive" role="alert">
          Something went wrong loading the catalog. Check your connection and try again.
        </Alert>
      ) : null}
      {loadState === 'ready' && islands.length === 0 ? (
        <Alert variant="warning">Create an island first; every adventure belongs to one.</Alert>
      ) : null}
      {loadState === 'ready' && islands.length > 0 ? (
        <CatalogForm
          kind="adventure"
          initialValues={initialValues}
          slugLocked={isEdit}
          takenSlugs={takenSlugs}
          islands={islands}
          submitLabel={isEdit ? 'Save adventure' : 'Create adventure'}
          cancelTo={back.to}
          onSubmit={handleSubmit}
        />
      ) : null}
    </>
  );
}
