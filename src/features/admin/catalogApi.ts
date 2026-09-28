import { client } from '../../lib/data-client';
import type { Schema } from '../../../amplify/data/resource';
import { ADVENTURE_TEMPLATES, getAdventureTemplate } from '../adventures/content';
import { ISLAND_LOCATIONS } from '../island/locations';
import { getAsset, listModelAssets } from '../assets/assetService';
import type { Asset, AssetCategory } from '../assets/types';
import { deleteBlockReason } from '../catalog/deleteGuard';
import { planCatalogImport } from '../catalog/importPlan';

/**
 * Data operations for the admin Islands & Adventures catalog
 * (docs/ISLAND_ADVENTURE_MANAGEMENT.md section 23, ADR-024). Pages call
 * these rather than the data client, so the rules below hold no matter
 * which page runs them.
 *
 * These checks are for giving an admin a clear message. The authorization
 * itself is the backend's: `Island`/`Adventure` writes are `Admins`-group
 * only and `Adventure` delete is `Superusers` only (amplify/data/resource.ts),
 * so calling the data client directly gets a non-admin nothing.
 */

export type Island = Schema['Island']['type'];
export type Adventure = Schema['Adventure']['type'];
export type AdventureModel = Schema['AdventureModel']['type'];

export type CatalogErrorCode =
  'NOT_FOUND' | 'DUPLICATE_SLUG' | 'ISLAND_NOT_FOUND' | 'DELETE_BLOCKED' | 'REQUEST_FAILED';

/** A failure with a message that is safe to show an admin as-is. */
export class CatalogError extends Error {
  readonly code: CatalogErrorCode;

  constructor(code: CatalogErrorCode, message: string) {
    super(message);
    this.name = 'CatalogError';
    this.code = code;
  }
}

export interface IslandInput {
  slug: string;
  name: string;
  shortDescription: string | null;
  description: string | null;
  active: boolean;
  sortOrder: number;
}

export interface AdventureInput extends IslandInput {
  islandId: string;
}

/** Fields an edit may change. The slug is fixed once created (section 7). */
export type IslandUpdate = Omit<IslandInput, 'slug'>;
export type AdventureUpdate = Omit<AdventureInput, 'slug'>;

function failed(action: string): CatalogError {
  return new CatalogError(
    'REQUEST_FAILED',
    `Could not ${action}. Check your connection and try again.`,
  );
}

export function bySortOrder<T extends { sortOrder: number; name: string }>(a: T, b: T): number {
  return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
}

// --- Islands ---

export async function listIslands(): Promise<Island[]> {
  const islands: Island[] = [];
  let nextToken: string | null | undefined;
  do {
    const { data, errors, nextToken: next } = await client.models.Island.list({ nextToken });
    if (errors?.length) throw failed('load the islands');
    islands.push(...data);
    nextToken = next;
  } while (nextToken);
  return islands.sort(bySortOrder);
}

export async function getIsland(id: string): Promise<Island | null> {
  const { data, errors } = await client.models.Island.get({ id });
  if (errors?.length) throw failed('load the island');
  return data ?? null;
}

async function islandSlugTaken(slug: string): Promise<boolean> {
  const { data, errors } = await client.models.Island.listIslandBySlug({ slug });
  if (errors?.length) throw failed('check the slug');
  return data.length > 0;
}

export async function createIsland(input: IslandInput, actorId: string): Promise<Island> {
  if (await islandSlugTaken(input.slug)) {
    throw new CatalogError('DUPLICATE_SLUG', `The slug "${input.slug}" is already in use.`);
  }
  const { data, errors } = await client.models.Island.create({
    ...input,
    createdBy: actorId,
    updatedBy: actorId,
  });
  if (!data || errors?.length) throw failed('create the island');
  return data;
}

export async function updateIsland(
  id: string,
  input: IslandUpdate,
  actorId: string,
): Promise<Island> {
  const { data, errors } = await client.models.Island.update({ id, ...input, updatedBy: actorId });
  if (!data || errors?.length) throw failed('save the island');
  return data;
}

/** Never touches the island's adventures: their own flags are kept (section 17). */
export async function setIslandActive(
  id: string,
  active: boolean,
  actorId: string,
): Promise<Island> {
  const { data, errors } = await client.models.Island.update({ id, active, updatedBy: actorId });
  if (!data || errors?.length)
    throw failed(active ? 'activate the island' : 'deactivate the island');
  return data;
}

// --- Adventures ---

export async function listAdventures(): Promise<Adventure[]> {
  const adventures: Adventure[] = [];
  let nextToken: string | null | undefined;
  do {
    const { data, errors, nextToken: next } = await client.models.Adventure.list({ nextToken });
    if (errors?.length) throw failed('load the adventures');
    adventures.push(...data);
    nextToken = next;
  } while (nextToken);
  return adventures.sort(bySortOrder);
}

export async function listAdventuresByIsland(islandId: string): Promise<Adventure[]> {
  const adventures: Adventure[] = [];
  let nextToken: string | null | undefined;
  do {
    const {
      data,
      errors,
      nextToken: next,
    } = await client.models.Adventure.listAdventureByIslandId({ islandId }, { nextToken });
    if (errors?.length) throw failed('load the adventures');
    adventures.push(...data);
    nextToken = next;
  } while (nextToken);
  return adventures.sort(bySortOrder);
}

export async function getAdventure(id: string): Promise<Adventure | null> {
  const { data, errors } = await client.models.Adventure.get({ id });
  if (errors?.length) throw failed('load the adventure');
  return data ?? null;
}

async function adventureSlugTaken(slug: string): Promise<boolean> {
  const { data, errors } = await client.models.Adventure.listAdventureBySlug({ slug });
  if (errors?.length) throw failed('check the slug');
  return data.length > 0;
}

async function assertIslandExists(islandId: string): Promise<void> {
  if (!(await getIsland(islandId))) {
    throw new CatalogError('ISLAND_NOT_FOUND', 'That island no longer exists. Choose another.');
  }
}

export async function createAdventure(input: AdventureInput, actorId: string): Promise<Adventure> {
  await assertIslandExists(input.islandId);
  if (await adventureSlugTaken(input.slug)) {
    throw new CatalogError('DUPLICATE_SLUG', `The slug "${input.slug}" is already in use.`);
  }
  const { data, errors } = await client.models.Adventure.create({
    ...input,
    createdBy: actorId,
    updatedBy: actorId,
  });
  if (!data || errors?.length) throw failed('create the adventure');
  return data;
}

export async function updateAdventure(
  id: string,
  input: AdventureUpdate,
  actorId: string,
): Promise<Adventure> {
  await assertIslandExists(input.islandId);
  const { data, errors } = await client.models.Adventure.update({
    id,
    ...input,
    updatedBy: actorId,
  });
  if (!data || errors?.length) throw failed('save the adventure');
  return data;
}

export async function setAdventureActive(
  id: string,
  active: boolean,
  actorId: string,
): Promise<Adventure> {
  const { data, errors } = await client.models.Adventure.update({ id, active, updatedBy: actorId });
  if (!data || errors?.length)
    throw failed(active ? 'activate the adventure' : 'deactivate the adventure');
  return data;
}

/** Whether this catalog entry has authored, playable content behind it. */
export function hasGameContent(adventure: Pick<Adventure, 'slug'>): boolean {
  return getAdventureTemplate(adventure.slug) !== undefined;
}

/**
 * How many sessions, across every family, have played this adventure.
 * Readable because `AdventureSession` carries an `Admins` read rule.
 */
export async function countSessionsForAdventure(slug: string): Promise<number> {
  let count = 0;
  let nextToken: string | null | undefined;
  do {
    const {
      data,
      errors,
      nextToken: next,
    } = await client.models.AdventureSession.list({
      filter: { templateSlug: { eq: slug } },
      selectionSet: ['id'],
      nextToken,
    });
    if (errors?.length) throw failed('check who has played this adventure');
    count += data.length;
    nextToken = next;
  } while (nextToken);
  return count;
}

/** `null` if the adventure may be deleted, otherwise why not (`deleteBlockReason`). */
export async function getDeleteBlockReason(adventure: Adventure): Promise<string | null> {
  return deleteBlockReason({
    hasGameContent: hasGameContent(adventure),
    sessionCount: await countSessionsForAdventure(adventure.slug),
  });
}

/**
 * Superusers only; the backend refuses anyone else. Re-checks the guard
 * immediately before deleting, then removes the adventure's model
 * assignments (catalog data, not child history) and the record itself.
 */
export async function deleteAdventure(adventure: Adventure): Promise<void> {
  const reason = await getDeleteBlockReason(adventure);
  if (reason) throw new CatalogError('DELETE_BLOCKED', reason);
  for (const assignment of await listAdventureModelRows(adventure.id)) {
    const { errors } = await client.models.AdventureModel.delete({ id: assignment.id });
    if (errors?.length) throw failed('remove the adventure’s models');
  }
  const { errors } = await client.models.Adventure.delete({ id: adventure.id });
  if (errors?.length) throw failed('delete the adventure');
}

// --- Adventure models ---

async function listAdventureModelRows(adventureId: string): Promise<AdventureModel[]> {
  const rows: AdventureModel[] = [];
  let nextToken: string | null | undefined;
  do {
    const {
      data,
      errors,
      nextToken: next,
    } = await client.models.AdventureModel.list({
      filter: { adventureId: { eq: adventureId } },
      nextToken,
    });
    if (errors?.length) throw failed('load the adventure’s models');
    rows.push(...data);
    nextToken = next;
  } while (nextToken);
  return rows.sort((a, b) => a.sortOrder - b.sortOrder);
}

export interface AdventureModelEntry {
  assignment: AdventureModel;
  /** `null` when the asset record was removed after being assigned. */
  asset: Asset | null;
}

/** The existing S3-backed `Asset` records this adventure uses (section 16). */
export async function listModelsByAdventure(adventureId: string): Promise<AdventureModelEntry[]> {
  const rows = await listAdventureModelRows(adventureId);
  return Promise.all(
    rows.map(async (assignment) => ({ assignment, asset: await getAsset(assignment.assetId) })),
  );
}

/** Model assets that can be assigned: every uploaded model, by name. */
export async function listAssignableModels(): Promise<Asset[]> {
  return (await listModelAssets()).sort((a, b) => a.name.localeCompare(b.name));
}

export async function assignModel(
  adventureId: string,
  assetId: string,
  role: AssetCategory | null,
  sortOrder: number,
): Promise<AdventureModel> {
  const { data, errors } = await client.models.AdventureModel.create({
    adventureId,
    assetId,
    role,
    sortOrder,
  });
  if (!data || errors?.length) throw failed('add the model');
  return data;
}

export async function unassignModel(assignmentId: string): Promise<void> {
  const { errors } = await client.models.AdventureModel.delete({ id: assignmentId });
  if (errors?.length) throw failed('remove the model');
}

/** How many models each adventure uses, for the list pages' Models column. */
export async function countModelsByAdventure(): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  let nextToken: string | null | undefined;
  do {
    const {
      data,
      errors,
      nextToken: next,
    } = await client.models.AdventureModel.list({ selectionSet: ['adventureId'], nextToken });
    if (errors?.length) throw failed('count the adventures’ models');
    for (const row of data) counts.set(row.adventureId, (counts.get(row.adventureId) ?? 0) + 1);
    nextToken = next;
  } while (nextToken);
  return counts;
}

// --- Import from game content ---

export interface CatalogImportResult {
  islandsCreated: number;
  adventuresCreated: number;
  skipped: string[];
}

/**
 * Creates a catalog row for every source-controlled island and adventure
 * that does not have one yet, all active (they are live today). Existing
 * rows are never changed, so re-running it is safe.
 */
export async function importGameContent(actorId: string): Promise<CatalogImportResult> {
  const [islands, adventures] = await Promise.all([listIslands(), listAdventures()]);
  const plan = planCatalogImport(
    {
      islandSlugs: islands.map((island) => island.slug),
      adventureSlugs: adventures.map((adventure) => adventure.slug),
    },
    ISLAND_LOCATIONS,
    ADVENTURE_TEMPLATES,
  );

  const islandIdBySlug = new Map(islands.map((island) => [island.slug, island.id]));
  for (const planned of plan.islands) {
    const created = await createIsland({ ...planned, active: true }, actorId);
    islandIdBySlug.set(created.slug, created.id);
  }

  const skipped = [...plan.skipped];
  let adventuresCreated = 0;
  for (const planned of plan.adventures) {
    const islandId = islandIdBySlug.get(planned.islandSlug);
    if (!islandId) {
      skipped.push(planned.slug);
      continue;
    }
    const { data, errors } = await client.models.Adventure.create({
      islandId,
      slug: planned.slug,
      name: planned.name,
      active: true,
      sortOrder: planned.sortOrder,
      createdBy: actorId,
      updatedBy: actorId,
    });
    if (!data || errors?.length) throw failed('import the adventures');
    adventuresCreated += 1;
  }

  return { islandsCreated: plan.islands.length, adventuresCreated, skipped };
}
