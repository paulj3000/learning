import type { AdventureFormValues } from '../../catalog/validation';
import { parseSortOrder } from '../../catalog/validation';
import type { Adventure, AdventureInput, Island, IslandInput } from '../catalogApi';

/** Set by a create/edit page when it navigates away after saving; shown once by the next page. */
export interface CatalogFlashState {
  flash?: string;
}

function optional(text: string): string | null {
  const trimmed = text.trim();
  return trimmed === '' ? null : trimmed;
}

/** Form values to a save payload. Call only after the form validated. */
export function toIslandInput(values: AdventureFormValues): IslandInput {
  return {
    slug: values.slug.trim(),
    name: values.name.trim(),
    shortDescription: optional(values.shortDescription),
    description: optional(values.description),
    active: values.active,
    sortOrder: parseSortOrder(values.sortOrder) ?? 0,
  };
}

export function toAdventureInput(values: AdventureFormValues): AdventureInput {
  return { ...toIslandInput(values), islandId: values.islandId };
}

export function formValuesFrom(record: Island | Adventure): AdventureFormValues {
  return {
    islandId: 'islandId' in record ? record.islandId : '',
    name: record.name,
    slug: record.slug,
    shortDescription: record.shortDescription ?? '',
    description: record.description ?? '',
    active: record.active,
    sortOrder: String(record.sortOrder),
  };
}

/** The next sort order after the ones in use, in steps of 10. */
export function nextSortOrder(records: readonly { sortOrder: number }[]): string {
  return String(records.reduce((max, record) => Math.max(max, record.sortOrder), 0) + 10);
}

export const EMPTY_FORM_VALUES: AdventureFormValues = {
  islandId: '',
  name: '',
  slug: '',
  shortDescription: '',
  description: '',
  active: true,
  sortOrder: '10',
};

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString();
}
