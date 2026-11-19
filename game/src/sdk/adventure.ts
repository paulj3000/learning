/**
 * Adventure contract (Realm > Adventure > Quest > Challenge).
 *
 * An `AdventureDefinition` is data: which capabilities it turns on (jumping is just one, never
 * a separate category), which components it places by semantic id, which quests and
 * challenges it refers to by id (Django owns their content, grading and rewards), where its
 * checkpoints are, and the single visible world consequence that pillar 2 requires.
 *
 * `validateAdventure` resolves capabilities through the same `resolveCapabilities` the
 * runtime uses (`registry.resolve`), so validation and runtime behaviour agree by
 * construction.
 */

import type { CapabilityRegistry } from '../core/capabilities';
import { EngineError, type ValidationIssue, type ValidationResult } from '../core/errors';
import { ENGINE_API_VERSION } from '../version';
import {
  AGE_BANDS,
  isAgeBand,
  resolveProfile,
  type AgeBand,
  type ProfileOverrides,
} from './profiles';
import { deepFreeze } from './realm';
import { isValidRange, satisfiesRange } from './semver';
import { checkId, checkIdArray, checkSemver, checkStrictKeys, findTimerFields, isRecord } from './validation';

export type ContentSource = 'MANIFEST' | 'DJANGO_PUBLISHED';

export interface AdventureCapabilityRequest {
  id: string;
  /** Partial config override; omitted means the capability's defaults. */
  config?: unknown;
}

/** A component the adventure places, by component type and an authored semantic id. */
export interface ComponentPlacement {
  /** Authored semantic id of the placed thing (durable state keys on this, ADR-008). */
  id: string;
  /** Component type id registered in the `ComponentRegistry` (e.g. `gameplay.collectible`). */
  type: string;
  /** The area (see `AdventureDefinition.areas`) that holds it. */
  areaId: string;
  /** The capability that provides it, when it needs one to be on. */
  capability?: string;
  config?: unknown;
}

/** A jump challenge always carries an accessible route that needs no jumping (required). */
export interface JumpChallengeDefinition {
  id: string;
  areaId: string;
  jumpRouteId: string;
  /**
   * The route that needs no jumping. Required unless `optional` is true: an optional jump-only
   * challenge (lava stones to a bonus shard, trampoline hops) leads only to optional rewards,
   * shortcuts or secrets, as the jumping standard allows.
   */
  accessibleRouteId: string | null;
  /**
   * Nothing required depends on this challenge (decision E16; the same meaning as the
   * gameplay.jumpChallenges component's `optional`). When false, it sits on required progress and
   * must have an accessible route, so jumping is never needed, for any age band.
   */
  optional: boolean;
}

export interface CheckpointDefinition {
  id: string;
  areaId: string;
  courseId?: string;
}

export interface AdventureDefinition {
  id: string;
  realmId: string;
  version: string;
  /** Semver range of `ENGINE_API_VERSION` this adventure works with, e.g. `^0.1.0`. */
  engineApi: string;
  ageBands: AgeBand[];
  learningObjectiveIds: string[];
  areas: string[];
  capabilities: AdventureCapabilityRequest[];
  movementProfiles: Partial<Record<AgeBand, ProfileOverrides['movement']>>;
  difficultyProfiles: Partial<Record<AgeBand, ProfileOverrides['difficulty']>>;
  components: ComponentPlacement[];
  questIds: string[];
  challengeIds: string[];
  jumpChallenges: JumpChallengeDefinition[];
  checkpoints: CheckpointDefinition[];
  /** The visible island change this adventure leaves behind (`WorldChange` key). Required. */
  worldConsequenceId: string;
  contentSource: ContentSource;
  /** Service port ids the adventure needs the host to provide (see `services/`). */
  requiredServices: string[];
}

export interface ValidateAdventureOptions {
  /** When given, every placement's `type` must be registered. */
  componentTypes?: { has(typeId: string): boolean };
  /** Realm to check `realmId` against, when known. */
  realmId?: string;
  /** Engine API version to check the range against. Default `ENGINE_API_VERSION`. */
  engineApiVersion?: string;
}

const ADVENTURE_KEYS = [
  'id',
  'realmId',
  'version',
  'engineApi',
  'ageBands',
  'learningObjectiveIds',
  'areas',
  'capabilities',
  'movementProfiles',
  'difficultyProfiles',
  'components',
  'questIds',
  'challengeIds',
  'jumpChallenges',
  'checkpoints',
  'worldConsequenceId',
  'contentSource',
  'requiredServices',
] as const;

const JUMP_CAPABILITY = 'movement.jump';

function collectBandOverrides(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): Partial<Record<AgeBand, Record<string, unknown>>> {
  const out: Partial<Record<AgeBand, Record<string, unknown>>> = {};
  if (value === undefined) {
    return out;
  }
  if (!isRecord(value)) {
    issues.push({ path, message: 'must be an object keyed by age band' });
    return out;
  }
  for (const [band, overrides] of Object.entries(value)) {
    if (!isAgeBand(band)) {
      issues.push({ path: `${path}.${band}`, message: `must be one of ${AGE_BANDS.join(', ')}` });
    } else if (!isRecord(overrides)) {
      issues.push({ path: `${path}.${band}`, message: 'must be an object' });
    } else {
      out[band] = overrides;
    }
  }
  return out;
}

/** Validates untrusted data as an `AdventureDefinition`. Never throws. */
export function validateAdventure(
  input: unknown,
  registry: CapabilityRegistry,
  options: ValidateAdventureOptions = {},
): ValidationResult<AdventureDefinition> {
  const issues: ValidationIssue[] = [];
  if (!isRecord(input)) {
    return { ok: false, issues: [{ path: '', message: 'must be an object' }] };
  }
  checkStrictKeys(input, ADVENTURE_KEYS, '', issues);
  checkId(input.id, 'id', issues);
  if (checkId(input.realmId, 'realmId', issues) && options.realmId !== undefined && input.realmId !== options.realmId) {
    issues.push({ path: 'realmId', message: `must be "${options.realmId}"` });
  }
  checkSemver(input.version, 'version', issues);

  // Engine API range, checked against the engine's own version.
  const engineVersion = options.engineApiVersion ?? ENGINE_API_VERSION;
  if (!isValidRange(input.engineApi)) {
    issues.push({ path: 'engineApi', message: 'must be a semver range like "^0.1.0"' });
  } else if (!satisfiesRange(engineVersion, input.engineApi)) {
    issues.push({ path: 'engineApi', message: `range "${input.engineApi}" does not include engine API ${engineVersion}` });
  }

  const ageBands: AgeBand[] = [];
  if (!Array.isArray(input.ageBands) || input.ageBands.length === 0) {
    issues.push({ path: 'ageBands', message: `needs at least one of ${AGE_BANDS.join(', ')}` });
  } else {
    input.ageBands.forEach((band: unknown, index) => {
      if (!isAgeBand(band)) {
        issues.push({ path: `ageBands[${index}]`, message: `must be one of ${AGE_BANDS.join(', ')}` });
      } else if (ageBands.includes(band)) {
        issues.push({ path: `ageBands[${index}]`, message: `duplicate age band "${band}"` });
      } else {
        ageBands.push(band);
      }
    });
  }

  const learningObjectiveIds = checkIdArray(input.learningObjectiveIds, 'learningObjectiveIds', issues, { min: 1 });
  const areas = checkIdArray(input.areas, 'areas', issues, { min: 1 });
  const areaSet = new Set(areas);
  const questIds = checkIdArray(input.questIds, 'questIds', issues);
  const challengeIds = checkIdArray(input.challengeIds, 'challengeIds', issues);
  const requiredServices = checkIdArray(input.requiredServices, 'requiredServices', issues);
  checkId(input.worldConsequenceId, 'worldConsequenceId', issues);
  if (input.contentSource !== 'MANIFEST' && input.contentSource !== 'DJANGO_PUBLISHED') {
    issues.push({ path: 'contentSource', message: 'must be "MANIFEST" or "DJANGO_PUBLISHED"' });
  }

  // Capabilities: same resolution the runtime performs at start().
  const capabilities: AdventureCapabilityRequest[] = [];
  if (!Array.isArray(input.capabilities)) {
    issues.push({ path: 'capabilities', message: 'must be an array of { id, config? }' });
  } else {
    input.capabilities.forEach((raw: unknown, index) => {
      const path = `capabilities[${index}]`;
      if (!isRecord(raw)) {
        issues.push({ path, message: 'must be an object with an id' });
        return;
      }
      checkStrictKeys(raw, ['id', 'config'], path, issues);
      if (typeof raw.id !== 'string' || raw.id === '') {
        issues.push({ path: `${path}.id`, message: 'must be a capability id' });
        return;
      }
      capabilities.push(raw.config === undefined ? { id: raw.id } : { id: raw.id, config: raw.config });
    });
  }
  const resolution = registry.resolve(capabilities);
  for (const issue of resolution.issues) {
    issues.push(issue);
  }
  const resolvedIds = new Set(resolution.order.map((entry) => entry.definition.id));
  for (const request of capabilities) {
    resolvedIds.add(request.id);
  }

  // Per-band profile overrides: clamping is an authoring error, not silent.
  const movementOverrides = collectBandOverrides(input.movementProfiles, 'movementProfiles', issues);
  const difficultyOverrides = collectBandOverrides(input.difficultyProfiles, 'difficultyProfiles', issues);
  for (const band of ageBands) {
    const resolved = resolveProfile(band, {
      movement: movementOverrides[band] as ProfileOverrides['movement'],
      difficulty: difficultyOverrides[band] as ProfileOverrides['difficulty'],
    });
    for (const issue of resolved.issues) {
      const group = issue.path.startsWith('movement') ? 'movementProfiles' : 'difficultyProfiles';
      const rest = issue.path.replace(/^(movement|difficulty)\.?/, '');
      issues.push({ path: `${group}.${band}${rest ? `.${rest}` : ''}`, message: issue.message });
    }
  }
  for (const band of [...Object.keys(movementOverrides), ...Object.keys(difficultyOverrides)]) {
    if (!ageBands.includes(band as AgeBand)) {
      issues.push({ path: `profiles.${band}`, message: 'overrides a band the adventure does not list in ageBands' });
    }
  }

  // Components.
  const components: ComponentPlacement[] = [];
  const usedIds = new Set<string>();
  const claimId = (id: string, path: string): void => {
    if (usedIds.has(id)) {
      issues.push({ path, message: `duplicate semantic id "${id}"` });
    }
    usedIds.add(id);
  };
  if (!Array.isArray(input.components)) {
    issues.push({ path: 'components', message: 'must be an array' });
  } else {
    input.components.forEach((raw: unknown, index) => {
      const path = `components[${index}]`;
      if (!isRecord(raw)) {
        issues.push({ path, message: 'must be an object' });
        return;
      }
      checkStrictKeys(raw, ['id', 'type', 'areaId', 'capability', 'config'], path, issues);
      if (checkId(raw.id, `${path}.id`, issues)) {
        claimId(raw.id, `${path}.id`);
      }
      if (typeof raw.type !== 'string' || raw.type === '') {
        issues.push({ path: `${path}.type`, message: 'must be a component type id' });
      } else if (options.componentTypes && !options.componentTypes.has(raw.type)) {
        issues.push({ path: `${path}.type`, message: `component type "${raw.type}" is not registered` });
      }
      if (checkId(raw.areaId, `${path}.areaId`, issues) && !areaSet.has(raw.areaId)) {
        issues.push({ path: `${path}.areaId`, message: `area "${raw.areaId}" is not in areas` });
      }
      if (raw.capability !== undefined && (typeof raw.capability !== 'string' || !resolvedIds.has(raw.capability))) {
        issues.push({ path: `${path}.capability`, message: 'must be a capability this adventure turns on' });
      }
      components.push(raw as unknown as ComponentPlacement);
    });
  }

  // Jump challenges: every one needs a distinct accessible route; Sprouts get optional-only.
  const jumpChallenges: JumpChallengeDefinition[] = [];
  if (!Array.isArray(input.jumpChallenges)) {
    issues.push({ path: 'jumpChallenges', message: 'must be an array' });
  } else {
    input.jumpChallenges.forEach((raw: unknown, index) => {
      const path = `jumpChallenges[${index}]`;
      if (!isRecord(raw)) {
        issues.push({ path, message: 'must be an object' });
        return;
      }
      checkStrictKeys(raw, ['id', 'areaId', 'jumpRouteId', 'accessibleRouteId', 'optional'], path, issues);
      if (checkId(raw.id, `${path}.id`, issues)) {
        claimId(raw.id, `${path}.id`);
      }
      if (checkId(raw.areaId, `${path}.areaId`, issues) && !areaSet.has(raw.areaId)) {
        issues.push({ path: `${path}.areaId`, message: `area "${raw.areaId}" is not in areas` });
      }
      checkId(raw.jumpRouteId, `${path}.jumpRouteId`, issues);
      if (raw.accessibleRouteId === undefined || raw.accessibleRouteId === null || raw.accessibleRouteId === '') {
        if (raw.optional !== true) {
          issues.push({
            path: `${path}.accessibleRouteId`,
            message: 'is required unless the challenge is optional: required progress needs a route that needs no jumping',
          });
        }
      } else if (checkId(raw.accessibleRouteId, `${path}.accessibleRouteId`, issues) && raw.accessibleRouteId === raw.jumpRouteId) {
        issues.push({ path: `${path}.accessibleRouteId`, message: 'must differ from jumpRouteId' });
      }
      // `optional` has ONE meaning in every layer (decision E16): nothing required depends on the
      // challenge. Required progress (optional: false) always has an accessible route (checked
      // above), so the jump route is already optional for a Sprouts child; no band-specific rule.
      if (typeof raw.optional !== 'boolean') {
        issues.push({ path: `${path}.optional`, message: 'must be true or false' });
      }
      jumpChallenges.push(raw as unknown as JumpChallengeDefinition);
    });
    if (jumpChallenges.length > 0 && !resolvedIds.has(JUMP_CAPABILITY)) {
      issues.push({ path: 'capabilities', message: `jump challenges need the "${JUMP_CAPABILITY}" capability` });
    }
  }

  // Checkpoints.
  const checkpoints: CheckpointDefinition[] = [];
  if (!Array.isArray(input.checkpoints)) {
    issues.push({ path: 'checkpoints', message: 'must be an array' });
  } else {
    input.checkpoints.forEach((raw: unknown, index) => {
      const path = `checkpoints[${index}]`;
      if (!isRecord(raw)) {
        issues.push({ path, message: 'must be an object' });
        return;
      }
      checkStrictKeys(raw, ['id', 'areaId', 'courseId'], path, issues);
      if (checkId(raw.id, `${path}.id`, issues)) {
        claimId(raw.id, `${path}.id`);
      }
      if (checkId(raw.areaId, `${path}.areaId`, issues) && !areaSet.has(raw.areaId)) {
        issues.push({ path: `${path}.areaId`, message: `area "${raw.areaId}" is not in areas` });
      }
      if (raw.courseId !== undefined) {
        checkId(raw.courseId, `${path}.courseId`, issues);
      }
      checkpoints.push(raw as unknown as CheckpointDefinition);
    });
    // A required jump sequence needs checkpoints; the profile says how often.
    if (jumpChallenges.length > 0 && checkpoints.length === 0) {
      issues.push({ path: 'checkpoints', message: 'an adventure with jump challenges needs at least one checkpoint' });
    }
  }

  // ADR-053: no timers anywhere in the definition.
  for (const path of findTimerFields(input)) {
    issues.push({ path, message: 'timers are not allowed: children are never counted down (ADR-053)' });
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }
  return {
    ok: true,
    value: {
      id: input.id as string,
      realmId: input.realmId as string,
      version: input.version as string,
      engineApi: input.engineApi as string,
      ageBands,
      learningObjectiveIds,
      areas,
      capabilities,
      movementProfiles: movementOverrides as AdventureDefinition['movementProfiles'],
      difficultyProfiles: difficultyOverrides as AdventureDefinition['difficultyProfiles'],
      components,
      questIds,
      challengeIds,
      jumpChallenges,
      checkpoints,
      worldConsequenceId: input.worldConsequenceId as string,
      contentSource: input.contentSource as ContentSource,
      requiredServices,
    },
    issues: [],
  };
}

/** What an author writes: optional lists default to empty. */
export type AdventureDefinitionInput = Omit<
  AdventureDefinition,
  'movementProfiles' | 'difficultyProfiles' | 'components' | 'questIds' | 'challengeIds' | 'jumpChallenges' | 'checkpoints' | 'requiredServices' | 'capabilities'
> &
  Partial<
    Pick<
      AdventureDefinition,
      'movementProfiles' | 'difficultyProfiles' | 'components' | 'questIds' | 'challengeIds' | 'jumpChallenges' | 'checkpoints' | 'requiredServices' | 'capabilities'
    >
  >;

/** Applies defaults for omitted lists and freezes the result. Does not validate (needs a registry). */
export function defineAdventure(input: AdventureDefinitionInput): Readonly<AdventureDefinition> {
  return deepFreeze({
    movementProfiles: {},
    difficultyProfiles: {},
    components: [],
    questIds: [],
    challengeIds: [],
    jumpChallenges: [],
    checkpoints: [],
    requiredServices: [],
    capabilities: [],
    ...input,
  });
}

/** Validates, or throws `VALIDATION_FAILED` with the issues. Returns the typed, frozen definition. */
export function assertValidAdventure(
  input: unknown,
  registry: CapabilityRegistry,
  options?: ValidateAdventureOptions,
): Readonly<AdventureDefinition> {
  const result = validateAdventure(input, registry, options);
  if (!result.ok) {
    throw new EngineError('VALIDATION_FAILED', `Invalid adventure definition "${isRecord(input) ? String(input.id) : ''}"`, {
      issues: result.issues,
    });
  }
  return deepFreeze(result.value);
}

/** The resolved profile for one band of a validated adventure. */
export function profileFor(definition: AdventureDefinition, band: AgeBand) {
  return resolveProfile(band, {
    movement: definition.movementProfiles[band],
    difficulty: definition.difficultyProfiles[band],
  });
}
