/**
 * Realm contract (hierarchy: Realm > Adventure > Quest > Challenge; realm standard).
 *
 * A Realm definition is the engine-side description of an island: its places and 3D areas, the
 * age bands it serves, its milestones and the adventures that belong to it. It holds ids and
 * localisation keys only. Titles and descriptions are never literal child-facing copy
 * (CLAUDE.md section 13), and the content (Django, after import) stays authoritative for
 * everything the child sees and earns.
 */

import { EngineError, type ValidationIssue, type ValidationResult } from '../core/errors';
import { AGE_BANDS, isAgeBand, type AgeBand } from './profiles';
import {
  checkId,
  checkIdArray,
  checkLocalisationKey,
  checkSemver,
  checkStrictKeys,
  isRecord,
} from './validation';

export interface RealmPlace {
  id: string;
  titleKey: string;
  /** The 3D areas (Django `regions.WorldRegion` ids or manifest ids) inside this place. */
  areaIds: string[];
}

export interface RealmDefinition {
  id: string;
  version: string;
  titleKey: string;
  places: RealmPlace[];
  ageBands: AgeBand[];
  milestoneIds: string[];
  adventureIds: string[];
}

const REALM_KEYS = [
  'id',
  'version',
  'titleKey',
  'places',
  'ageBands',
  'milestoneIds',
  'adventureIds',
] as const;
const PLACE_KEYS = ['id', 'titleKey', 'areaIds'] as const;

export function validateRealm(input: unknown): ValidationResult<RealmDefinition> {
  const issues: ValidationIssue[] = [];
  if (!isRecord(input)) {
    return { ok: false, issues: [{ path: '', message: 'must be an object' }] };
  }
  checkStrictKeys(input, REALM_KEYS, '', issues);
  checkId(input.id, 'id', issues);
  checkSemver(input.version, 'version', issues);
  checkLocalisationKey(input.titleKey, 'titleKey', issues);

  const places: RealmPlace[] = [];
  if (!Array.isArray(input.places) || input.places.length === 0) {
    issues.push({ path: 'places', message: 'needs at least one place' });
  } else {
    const placeIds = new Set<string>();
    const areaOwner = new Map<string, string>();
    input.places.forEach((raw: unknown, index) => {
      const path = `places[${index}]`;
      if (!isRecord(raw)) {
        issues.push({ path, message: 'must be an object' });
        return;
      }
      checkStrictKeys(raw, PLACE_KEYS, path, issues);
      const idOk = checkId(raw.id, `${path}.id`, issues);
      if (idOk) {
        if (placeIds.has(raw.id as string)) {
          issues.push({ path: `${path}.id`, message: `duplicate place id "${raw.id as string}"` });
        }
        placeIds.add(raw.id as string);
      }
      checkLocalisationKey(raw.titleKey, `${path}.titleKey`, issues);
      const areaIds = checkIdArray(raw.areaIds, `${path}.areaIds`, issues, { min: 1 });
      for (const areaId of areaIds) {
        const owner = areaOwner.get(areaId);
        if (owner !== undefined && owner !== raw.id) {
          issues.push({
            path: `${path}.areaIds`,
            message: `area "${areaId}" already belongs to place "${owner}"`,
          });
        }
        areaOwner.set(areaId, String(raw.id));
      }
      places.push({ id: String(raw.id), titleKey: String(raw.titleKey), areaIds });
    });
  }

  const ageBands: AgeBand[] = [];
  if (!Array.isArray(input.ageBands) || input.ageBands.length === 0) {
    issues.push({ path: 'ageBands', message: `needs at least one of ${AGE_BANDS.join(', ')}` });
  } else {
    input.ageBands.forEach((band: unknown, index) => {
      if (!isAgeBand(band)) {
        issues.push({
          path: `ageBands[${index}]`,
          message: `must be one of ${AGE_BANDS.join(', ')}`,
        });
      } else if (ageBands.includes(band)) {
        issues.push({ path: `ageBands[${index}]`, message: `duplicate age band "${band}"` });
      } else {
        ageBands.push(band);
      }
    });
  }
  const milestoneIds = checkIdArray(input.milestoneIds, 'milestoneIds', issues);
  const adventureIds = checkIdArray(input.adventureIds, 'adventureIds', issues);

  if (issues.length > 0) {
    return { ok: false, issues };
  }
  return {
    ok: true,
    value: {
      id: input.id as string,
      version: input.version as string,
      titleKey: input.titleKey as string,
      places,
      ageBands,
      milestoneIds,
      adventureIds,
    },
    issues: [],
  };
}

/** Validates and returns a frozen realm definition, or throws `VALIDATION_FAILED` listing issues. */
export function defineRealm(definition: RealmDefinition): Readonly<RealmDefinition> {
  const result = validateRealm(definition);
  if (!result.ok) {
    throw new EngineError(
      'VALIDATION_FAILED',
      `Invalid realm definition "${String((definition as { id?: unknown }).id)}"`,
      {
        issues: result.issues,
      },
    );
  }
  return deepFreeze(result.value);
}

export function deepFreeze<T>(value: T): Readonly<T> {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
}
