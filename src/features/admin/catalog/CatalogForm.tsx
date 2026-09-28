import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { Card, CardContent } from '../ui/Card';
import { FieldHint, Input, Label, NativeSelect, Textarea } from '../ui/FormControls';
import {
  hasErrors,
  slugify,
  validateAdventureForm,
  validateCatalogForm,
  type AdventureFormValues,
  type FormErrors,
} from '../../catalog/validation';

export interface IslandOption {
  id: string;
  name: string;
}

interface CatalogFormProps {
  kind: 'island' | 'adventure';
  initialValues: AdventureFormValues;
  /** Set on an edit: the slug is shown but cannot change (section 7). */
  slugLocked: boolean;
  /** Slugs used by other records of the same kind. */
  takenSlugs: readonly string[];
  /** Adventure forms only: the islands it can belong to. */
  islands?: readonly IslandOption[];
  submitLabel: string;
  cancelTo: string;
  /** Resolves when saved; rejects with a message-bearing error to show. */
  onSubmit: (values: AdventureFormValues) => Promise<void>;
}

/**
 * The create/edit form shared by islands and adventures
 * (docs/ISLAND_ADVENTURE_MANAGEMENT.md sections 11 and 14). Validation is
 * `src/features/catalog/validation.ts`; the page decides what to save.
 * Thumbnails are not offered: the asset system has no image assets yet.
 */
export function CatalogForm({
  kind,
  initialValues,
  slugLocked,
  takenSlugs,
  islands = [],
  submitLabel,
  cancelTo,
  onSubmit,
}: CatalogFormProps) {
  const [values, setValues] = useState(initialValues);
  const [slugEdited, setSlugEdited] = useState(slugLocked || initialValues.slug !== '');
  const [errors, setErrors] = useState<FormErrors<AdventureFormValues>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const noun = kind === 'island' ? 'island' : 'adventure';

  function update<K extends keyof AdventureFormValues>(key: K, value: AdventureFormValues[K]) {
    setValues((current) => {
      const next = { ...current, [key]: value };
      // Suggest a slug from the name until the admin types one themselves.
      if (key === 'name' && !slugEdited) next.slug = slugify(String(value));
      return next;
    });
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const found =
      kind === 'adventure'
        ? validateAdventureForm(
            values,
            takenSlugs,
            islands.map((island) => island.id),
          )
        : validateCatalogForm(values, takenSlugs);
    setErrors(found);
    if (hasErrors(found)) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await onSubmit(values);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : `Could not save the ${noun}.`);
      setSubmitting(false);
    }
  }

  function fieldProps(key: keyof AdventureFormValues) {
    const id = `${noun}-${key}`;
    return {
      id,
      'aria-invalid': errors[key] ? true : undefined,
      'aria-describedby': errors[key] ? `${id}-error` : undefined,
    };
  }

  function fieldError(key: keyof AdventureFormValues) {
    return errors[key] ? (
      <p className="text-sm text-destructive" id={`${noun}-${key}-error`}>
        {errors[key]}
      </p>
    ) : null;
  }

  return (
    <Card>
      <CardContent>
        <form className="grid gap-5" noValidate onSubmit={(event) => void handleSubmit(event)}>
          {kind === 'adventure' ? (
            <div className="grid gap-2">
              <Label htmlFor="adventure-islandId">Island</Label>
              <NativeSelect
                {...fieldProps('islandId')}
                value={values.islandId}
                onChange={(event) => update('islandId', event.target.value)}
              >
                <option value="">Choose an island</option>
                {islands.map((island) => (
                  <option key={island.id} value={island.id}>
                    {island.name}
                  </option>
                ))}
              </NativeSelect>
              {fieldError('islandId')}
            </div>
          ) : null}

          <div className="grid gap-2">
            <Label htmlFor={`${noun}-name`}>{kind === 'island' ? 'Name' : 'Adventure name'}</Label>
            <Input
              {...fieldProps('name')}
              value={values.name}
              onChange={(event) => update('name', event.target.value)}
            />
            {fieldError('name')}
          </div>

          <div className="grid gap-2">
            <Label htmlFor={`${noun}-slug`}>Slug</Label>
            <Input
              {...fieldProps('slug')}
              value={values.slug}
              readOnly={slugLocked}
              onChange={(event) => {
                setSlugEdited(true);
                update('slug', event.target.value);
              }}
            />
            <FieldHint>
              {slugLocked
                ? 'The slug links this record to game content and cannot change.'
                : kind === 'adventure'
                  ? 'Must match the adventure template slug for the adventure to be playable.'
                  : 'Must match the island location slug for the island to link to game content.'}
            </FieldHint>
            {fieldError('slug')}
          </div>

          <div className="grid gap-2">
            <Label htmlFor={`${noun}-shortDescription`}>Short description</Label>
            <Input
              {...fieldProps('shortDescription')}
              value={values.shortDescription}
              onChange={(event) => update('shortDescription', event.target.value)}
            />
            {fieldError('shortDescription')}
          </div>

          <div className="grid gap-2">
            <Label htmlFor={`${noun}-description`}>Description</Label>
            <Textarea
              {...fieldProps('description')}
              rows={5}
              value={values.description}
              onChange={(event) => update('description', event.target.value)}
            />
            {fieldError('description')}
          </div>

          <div className="grid gap-2 sm:max-w-40">
            <Label htmlFor={`${noun}-sortOrder`}>Sort order</Label>
            <Input
              {...fieldProps('sortOrder')}
              inputMode="numeric"
              value={values.sortOrder}
              onChange={(event) => update('sortOrder', event.target.value)}
            />
            {fieldError('sortOrder')}
          </div>

          <Label htmlFor={`${noun}-active`}>
            <input
              id={`${noun}-active`}
              type="checkbox"
              checked={values.active}
              onChange={(event) => update('active', event.target.checked)}
            />
            Active (available to children)
          </Label>

          {submitError ? (
            <Alert variant="destructive" role="alert">
              {submitError}
            </Alert>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Saving...' : submitLabel}
            </Button>
            <Button variant="outline" asChild>
              <Link to={cancelTo}>Cancel</Link>
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
