/**
 * Location definitions (GE-075).
 *
 * A **location** is a free-roaming 3D place that is not itself an adventure: Welcome Harbor,
 * Pirate Builder Bay, Clockwork Harbor, Dragon's Sanctuary, Explorer Cove, the sandbox. Today
 * each runs on the island-map `createLocationEngine` from a TypeScript manifest (CLAUDE.md
 * section 20: shipped layouts stay in manifests until LAI-0805). Migrating one to the engine
 * means declaring, as engine data, the capabilities it already plays with, validated by the same
 * registry the runtime uses, so the runtime swap (GE-076) changes nothing a child can feel.
 *
 * `capabilityRequestsFromManifest` derives those requests from a manifest's `movement` and
 * `player` blocks. It never guesses: a manifest field the engine cannot express is returned as
 * an issue, so a location's parity test fails loudly instead of losing a setting.
 */

import type { CapabilityRegistry } from '../core/capabilities';
import { EngineError, type ValidationIssue, type ValidationResult } from '../core/errors';
import type { PlayerPresentationSpec } from '../camera/playerPresentation';
import type { MovementSpec } from '../movement/jumpConfiguration';
import { ENGINE_API_VERSION } from '../version';
import type { AdventureCapabilityRequest, ContentSource } from './adventure';
import { deepFreeze } from './realm';
import { isValidRange, satisfiesRange } from './semver';
import {
  checkId,
  checkIdArray,
  checkSemver,
  checkStrictKeys,
  findTimerFields,
  isRecord,
} from './validation';

export interface LocationDefinition {
  /** The location's region id, as in its manifest (`regionId`). */
  id: string;
  version: string;
  /** Semver range of `ENGINE_API_VERSION` this location works with. */
  engineApi: string;
  contentSource: ContentSource;
  capabilities: AdventureCapabilityRequest[];
  /** Service port ids the location needs from the host (`services/`). */
  requiredServices: string[];
}

const LOCATION_KEYS = [
  'id',
  'version',
  'engineApi',
  'contentSource',
  'capabilities',
  'requiredServices',
] as const;

export interface ValidateLocationOptions {
  engineApiVersion?: string;
}

/** Validates untrusted input with the runtime's own capability resolution. Never throws. */
export function validateLocation(
  input: unknown,
  registry: CapabilityRegistry<never> | CapabilityRegistry<unknown>,
  options: ValidateLocationOptions = {},
): ValidationResult<LocationDefinition> {
  const issues: ValidationIssue[] = [];
  if (!isRecord(input)) {
    return { ok: false, issues: [{ path: '', message: 'must be an object' }] };
  }
  checkStrictKeys(input, LOCATION_KEYS, '', issues);
  checkId(input.id, 'id', issues);
  checkSemver(input.version, 'version', issues);
  const engineVersion = options.engineApiVersion ?? ENGINE_API_VERSION;
  if (!isValidRange(input.engineApi)) {
    issues.push({ path: 'engineApi', message: 'must be a semver range like "^0.1.0"' });
  } else if (!satisfiesRange(engineVersion, input.engineApi)) {
    issues.push({
      path: 'engineApi',
      message: `range "${input.engineApi}" does not include engine API ${engineVersion}`,
    });
  }
  if (input.contentSource !== 'MANIFEST' && input.contentSource !== 'DJANGO_PUBLISHED') {
    issues.push({ path: 'contentSource', message: 'must be MANIFEST or DJANGO_PUBLISHED' });
  }
  checkIdArray(input.requiredServices, 'requiredServices', issues);
  if (!Array.isArray(input.capabilities)) {
    issues.push({ path: 'capabilities', message: 'must be a list of { id, config }' });
  } else {
    const requests = input.capabilities.filter(
      (entry): entry is AdventureCapabilityRequest =>
        isRecord(entry) && typeof entry.id === 'string',
    );
    if (requests.length !== input.capabilities.length) {
      issues.push({ path: 'capabilities', message: 'every entry must be { id, config? }' });
    }
    issues.push(...(registry as CapabilityRegistry<unknown>).resolve(requests).issues);
  }
  for (const path of findTimerFields(input)) {
    issues.push({ path, message: 'timers are not allowed (ADR-053)' });
  }
  return issues.length === 0
    ? { ok: true, value: input as unknown as LocationDefinition, issues: [] }
    : { ok: false, issues };
}

/** Freezes a location definition; throws `VALIDATION_FAILED` when it is invalid. */
export function defineLocation(
  definition: LocationDefinition,
  registry: CapabilityRegistry<never> | CapabilityRegistry<unknown>,
): Readonly<LocationDefinition> {
  const result = validateLocation(definition, registry);
  if (!result.ok) {
    throw new EngineError('VALIDATION_FAILED', `Location "${definition.id}" is invalid`, {
      issues: result.issues,
    });
  }
  return deepFreeze(structuredClone(definition));
}

// --- manifest adapter --------------------------------------------------------------------

/** The manifest blocks the engine can express (a subset of `ThreeLocationManifest`). */
export interface ManifestPlayBlocks {
  movement?: MovementSpec;
  player?: PlayerPresentationSpec;
}

/** Camera fields that belong to `camera.thirdPerson` (the rest map elsewhere or are issues). */
const THIRD_PERSON_FIELDS = [
  'defaultMode',
  'allowModeSwitch',
  'distance',
  'minDistance',
  'maxDistance',
  'heightOffset',
  'followDamping',
  'rotationSensitivity',
  'sprintFovBoost',
  'maxHeight',
] as const;
const AVATAR_FIELDS = ['enabled', 'assetKey', 'scale', 'rotationOffset'] as const;

function pick(source: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    if (source[field] !== undefined) {
      out[field] = source[field];
    }
  }
  return out;
}

function unknownFields(
  source: Record<string, unknown>,
  known: readonly string[],
  path: string,
  issues: ValidationIssue[],
): void {
  for (const key of Object.keys(source)) {
    if (!known.includes(key)) {
      issues.push({
        path: `${path}.${key}`,
        message: 'has no engine capability equivalent; it would be lost in migration',
      });
    }
  }
}

/**
 * The capability requests a manifest's `movement` and `player` blocks amount to. Every location
 * walks (`movement.locomotion`), jumps with the defaults unless the manifest tunes or disables
 * jumping (`movement.jump`), has the third-person camera with collision avoidance, and draws the
 * child's avatar with animation. `movement.collision` (the footprint) is a controller default
 * (ADR-060) that no capability overrides, so a manifest that sets it is reported.
 */
export function capabilityRequestsFromManifest(blocks: ManifestPlayBlocks): {
  requests: AdventureCapabilityRequest[];
  issues: ValidationIssue[];
} {
  const issues: ValidationIssue[] = [];
  const movement = (blocks.movement ?? {}) as Record<string, unknown>;
  const player = (blocks.player ?? {}) as Record<string, unknown>;
  unknownFields(movement, ['jump', 'locomotion', 'collision'], 'movement', issues);
  unknownFields(player, ['camera', 'avatar'], 'player', issues);
  if (movement.collision !== undefined) {
    issues.push({
      path: 'movement.collision',
      message: 'footprint overrides are a controller default (ADR-060); no capability carries them',
    });
  }
  const camera = isRecord(player.camera) ? player.camera : {};
  unknownFields(camera, [...THIRD_PERSON_FIELDS, 'collisionEnabled'], 'player.camera', issues);
  const avatar = isRecord(player.avatar) ? player.avatar : {};
  unknownFields(avatar, AVATAR_FIELDS, 'player.avatar', issues);

  const requests: AdventureCapabilityRequest[] = [
    {
      id: 'movement.locomotion',
      config: isRecord(movement.locomotion) ? { ...movement.locomotion } : {},
    },
    { id: 'movement.jump', config: isRecord(movement.jump) ? { ...movement.jump } : {} },
    { id: 'camera.thirdPerson', config: pick(camera, THIRD_PERSON_FIELDS) },
    { id: 'camera.firstPerson', config: {} },
    {
      id: 'camera.collision',
      config: camera.collisionEnabled === undefined ? {} : { enabled: camera.collisionEnabled },
    },
    { id: 'character.avatar', config: pick(avatar, AVATAR_FIELDS) },
    { id: 'character.animation', config: {} },
  ];
  return { requests, issues };
}
