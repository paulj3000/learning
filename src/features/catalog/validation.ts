/**
 * Form rules for the admin Island and Adventure editors
 * (docs/ISLAND_ADVENTURE_MANAGEMENT.md sections 11, 14 and 24). Pure, so the
 * same rules are testable without rendering a form.
 */

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const NAME_MAX = 80;
const SHORT_DESCRIPTION_MAX = 160;
const DESCRIPTION_MAX = 2000;

export interface CatalogFormValues {
  name: string;
  slug: string;
  shortDescription: string;
  description: string;
  active: boolean;
  /** Kept as the raw text of the input so an empty or partial entry can be reported. */
  sortOrder: string;
}

export interface AdventureFormValues extends CatalogFormValues {
  islandId: string;
}

export type FormErrors<T> = Partial<Record<keyof T, string>>;

/** A slug suggestion from a display name: "Dragon's Sanctuary" -> "dragons-sanctuary". */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function parseSortOrder(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!/^-?\d+$/.test(trimmed)) return undefined;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) ? value : undefined;
}

/**
 * `takenSlugs` holds every slug already used by another record of the same
 * kind. On an edit the slug is locked, so the record's own slug is never in
 * it and never reported as a duplicate.
 */
export function validateCatalogForm(
  values: CatalogFormValues,
  takenSlugs: readonly string[],
): FormErrors<CatalogFormValues> {
  const errors: FormErrors<CatalogFormValues> = {};
  const name = values.name.trim();
  const slug = values.slug.trim();

  if (!name) errors.name = 'Enter a name.';
  else if (name.length > NAME_MAX) errors.name = `Keep the name under ${NAME_MAX} characters.`;

  if (!slug) errors.slug = 'Enter a slug.';
  else if (!SLUG_PATTERN.test(slug))
    errors.slug = 'Use lowercase letters, numbers, and single hyphens, like "pirate-bay".';
  else if (takenSlugs.includes(slug)) errors.slug = `The slug "${slug}" is already in use.`;

  if (values.shortDescription.trim().length > SHORT_DESCRIPTION_MAX)
    errors.shortDescription = `Keep the short description under ${SHORT_DESCRIPTION_MAX} characters.`;
  if (values.description.trim().length > DESCRIPTION_MAX)
    errors.description = `Keep the description under ${DESCRIPTION_MAX} characters.`;

  if (parseSortOrder(values.sortOrder) === undefined)
    errors.sortOrder = 'Enter a whole number, like 10.';

  return errors;
}

export function validateAdventureForm(
  values: AdventureFormValues,
  takenSlugs: readonly string[],
  islandIds: readonly string[],
): FormErrors<AdventureFormValues> {
  const errors: FormErrors<AdventureFormValues> = validateCatalogForm(values, takenSlugs);
  if (!values.islandId) errors.islandId = 'Choose an island.';
  else if (!islandIds.includes(values.islandId)) errors.islandId = 'That island no longer exists.';
  return errors;
}

export function hasErrors(errors: Record<string, string | undefined>): boolean {
  return Object.values(errors).some(Boolean);
}
