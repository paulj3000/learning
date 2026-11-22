/**
 * Content compatibility validator.
 *
 * Takes untrusted JSON (a Django-published Area scene, a TypeScript manifest export, or an
 * adventure definition) and a `CapabilityRegistry`, and returns typed issues. Pure and total:
 * it never throws, whatever it is given.
 *
 * What it reads (every field is optional; absent means "not declared"):
 * - `engineApi`: semver range checked against `ENGINE_API_VERSION`;
 * - `capabilities: [{ id, config? }]`: resolved with the registry, the same code path as
 *   `EngineRuntime.start`;
 * - `movement.jump`: numeric fields checked against the jumping standard's limits;
 * - `platforming.platforms[]` (`id`, `kind`, `motion`/`path`/`waypoints`), `platforming.checkpoints[]`
 *   (`id`, `platformId`): at most 64 platforms; a checkpoint may not stand on a moving platform;
 * - `jumpChallenges[]` (`id`, `jumpRouteId`, `accessibleRouteId`, `optional`): the accessible route is required unless the challenge is optional;
 * - `colliders[]` / `gates[]` with `jumpable: true` and `requirements` or `gate`: a gate is never jumpable;
 * - any key named like `timeLimit`, `countdown`, `deadline`, `timer` (ADR-053);
 * - `worldConsequenceId` (or `worldChange`): required for an adventure definition. An adventure
 *   is detected by a string `realmId`; pass `kind` to force. Area scenes do not need one.
 *
 * A Django scene may be wrapped as `{ scene: {...} }`; the wrapper is unwrapped.
 */

import type { CapabilityRegistry } from '../core/capabilities';
import { ENGINE_API_VERSION } from '../version';
import { JUMP_LIMIT_RANGES } from './profiles';
import { isValidRange, satisfiesRange } from './semver';
import { findTimerFields, isRecord, type UnknownRecord } from './validation';

export type CompatibilityIssueCode =
  | 'MALFORMED'
  | 'UNKNOWN_CAPABILITY'
  | 'INVALID_CAPABILITY_CONFIG'
  | 'ENGINE_API_MISMATCH'
  | 'JUMP_WITHOUT_ACCESSIBLE_ROUTE'
  | 'CHECKPOINT_ON_MOVING_PLATFORM'
  | 'JUMPABLE_GATE'
  | 'JUMP_LIMIT_EXCEEDED'
  | 'TIMER_PRESENT'
  | 'TOO_MANY_PLATFORMS'
  | 'MISSING_WORLD_CONSEQUENCE';

export interface CompatibilityIssue {
  code: CompatibilityIssueCode;
  /** Dotted path into the input. */
  path: string;
  message: string;
}

export interface CompatibilityReport {
  ok: boolean;
  issues: CompatibilityIssue[];
}

export interface CompatibilityOptions {
  /** `AUTO` (default) treats an object with a string `realmId` as an adventure. */
  kind?: 'AUTO' | 'AREA_SCENE' | 'ADVENTURE';
  engineApiVersion?: string;
  maxPlatforms?: number;
}

export const MAX_PLATFORMS_PER_AREA = 64;

const MOVING_KIND = /moving|elevator|turntable|conveyor|lift/i;

function hasMotion(platform: UnknownRecord): boolean {
  if (typeof platform.kind === 'string' && MOVING_KIND.test(platform.kind)) {
    return true;
  }
  if (typeof platform.type === 'string' && MOVING_KIND.test(platform.type)) {
    return true;
  }
  const motion = platform.motion;
  if (isRecord(motion)) {
    return typeof motion.kind !== 'string' || !/^(static|none)$/i.test(motion.kind);
  }
  return (
    (Array.isArray(platform.waypoints) && platform.waypoints.length > 1) ||
    (Array.isArray(platform.path) && platform.path.length > 1)
  );
}

/** Validates untrusted content against engine contracts. Pure; never throws. */
export function checkContentCompatibility(
  input: unknown,
  registry: CapabilityRegistry | null,
  options: CompatibilityOptions = {},
): CompatibilityReport {
  const issues: CompatibilityIssue[] = [];
  const add = (code: CompatibilityIssueCode, path: string, message: string): void => {
    issues.push({ code, path, message });
  };
  try {
    inspect(input, registry, options, add);
  } catch {
    // Total by contract: an inspection bug on hostile input is reported, never thrown.
    add('MALFORMED', '', 'content could not be inspected');
  }
  return { ok: issues.length === 0, issues };
}

function inspect(
  input: unknown,
  registry: CapabilityRegistry | null,
  options: CompatibilityOptions,
  add: (code: CompatibilityIssueCode, path: string, message: string) => void,
): void {
  if (!isRecord(input)) {
    add('MALFORMED', '', 'content must be a JSON object');
    return;
  }
  const root: UnknownRecord = isRecord(input.scene) ? { ...input, ...input.scene } : input;

  // Engine API range.
  if (root.engineApi !== undefined) {
    const version = options.engineApiVersion ?? ENGINE_API_VERSION;
    if (!isValidRange(root.engineApi)) {
      add('ENGINE_API_MISMATCH', 'engineApi', 'must be a semver range like "^0.1.0"');
    } else if (!satisfiesRange(version, root.engineApi)) {
      add(
        'ENGINE_API_MISMATCH',
        'engineApi',
        `range "${root.engineApi}" does not include engine API ${version}`,
      );
    }
  }

  // Capabilities, through the registry's own resolution.
  if (root.capabilities !== undefined) {
    if (!Array.isArray(root.capabilities)) {
      add('MALFORMED', 'capabilities', 'must be an array of { id, config? }');
    } else {
      const requests: { id: string; config?: unknown }[] = [];
      root.capabilities.forEach((raw: unknown, index) => {
        if (!isRecord(raw) || typeof raw.id !== 'string' || raw.id === '') {
          add('MALFORMED', `capabilities[${index}]`, 'must be an object with a capability id');
          return;
        }
        requests.push(
          raw.config === undefined ? { id: raw.id } : { id: raw.id, config: raw.config },
        );
      });
      if (registry) {
        for (const issue of registry.resolve(requests).issues) {
          const unknown = /unknown capability/i.test(issue.message);
          add(
            unknown ? 'UNKNOWN_CAPABILITY' : 'INVALID_CAPABILITY_CONFIG',
            issue.path,
            issue.message,
          );
        }
      }
    }
  }

  // Jump physics against the jumping standard.
  const movement = root.movement;
  if (isRecord(movement) && isRecord(movement.jump)) {
    for (const [key, [low, high]] of Object.entries(JUMP_LIMIT_RANGES)) {
      const value = movement.jump[key];
      if (
        value !== undefined &&
        (typeof value !== 'number' || !Number.isFinite(value) || value < low || value > high)
      ) {
        add(
          'JUMP_LIMIT_EXCEEDED',
          `movement.jump.${key}`,
          `must be a number from ${low} to ${high}`,
        );
      }
    }
    if (
      movement.jump.allowDoubleJump !== undefined &&
      typeof movement.jump.allowDoubleJump !== 'boolean'
    ) {
      add('JUMP_LIMIT_EXCEEDED', 'movement.jump.allowDoubleJump', 'must be true or false');
    }
  }

  // Platforms and checkpoints.
  const platforming = root.platforming;
  const maxPlatforms = options.maxPlatforms ?? MAX_PLATFORMS_PER_AREA;
  if (platforming !== undefined) {
    if (!isRecord(platforming)) {
      add('MALFORMED', 'platforming', 'must be an object');
    } else {
      const platforms = Array.isArray(platforming.platforms) ? platforming.platforms : [];
      if (platforming.platforms !== undefined && !Array.isArray(platforming.platforms)) {
        add('MALFORMED', 'platforming.platforms', 'must be an array');
      }
      if (platforms.length > maxPlatforms) {
        add(
          'TOO_MANY_PLATFORMS',
          'platforming.platforms',
          `${platforms.length} platforms; at most ${maxPlatforms} per area`,
        );
      }
      const moving = new Set<string>();
      for (const platform of platforms) {
        if (isRecord(platform) && typeof platform.id === 'string' && hasMotion(platform)) {
          moving.add(platform.id);
        }
      }
      const checkpoints = Array.isArray(platforming.checkpoints) ? platforming.checkpoints : [];
      checkpoints.forEach((checkpoint: unknown, index) => {
        if (
          isRecord(checkpoint) &&
          typeof checkpoint.platformId === 'string' &&
          moving.has(checkpoint.platformId)
        ) {
          add(
            'CHECKPOINT_ON_MOVING_PLATFORM',
            `platforming.checkpoints[${index}]`,
            `checkpoint stands on moving platform "${checkpoint.platformId}"`,
          );
        }
      });
    }
  }

  // Jump challenges: an accessible route is required.
  if (root.jumpChallenges !== undefined) {
    if (!Array.isArray(root.jumpChallenges)) {
      add('MALFORMED', 'jumpChallenges', 'must be an array');
    } else {
      root.jumpChallenges.forEach((challenge: unknown, index) => {
        const path = `jumpChallenges[${index}]`;
        if (!isRecord(challenge)) {
          add('MALFORMED', path, 'must be an object');
          return;
        }
        const accessible = challenge.accessibleRouteId;
        if (typeof accessible !== 'string' || accessible === '') {
          if (challenge.optional !== true) {
            add(
              'JUMP_WITHOUT_ACCESSIBLE_ROUTE',
              `${path}.accessibleRouteId`,
              'a jump challenge on required progress needs a route that needs no jumping (mark it optional only if nothing required depends on it)',
            );
          }
        } else if (accessible === challenge.jumpRouteId) {
          add(
            'JUMP_WITHOUT_ACCESSIBLE_ROUTE',
            `${path}.accessibleRouteId`,
            'the accessible route must differ from the jump route',
          );
        }
      });
    }
  }

  // Gates are never jumpable: a collider with requirements (or marked as a gate).
  for (const listName of ['colliders', 'gates'] as const) {
    const list = root[listName];
    if (!Array.isArray(list)) {
      continue;
    }
    list.forEach((item: unknown, index) => {
      if (!isRecord(item) || item.jumpable !== true) {
        return;
      }
      const requirements = item.requirements;
      const isGate =
        listName === 'gates' ||
        item.gate === true ||
        (Array.isArray(requirements)
          ? requirements.length > 0
          : requirements !== undefined && requirements !== null);
      if (isGate) {
        add('JUMPABLE_GATE', `${listName}[${index}]`, 'a progression gate may never be jumpable');
      }
    });
  }

  // ADR-053: no timers.
  for (const path of findTimerFields(root)) {
    add('TIMER_PRESENT', path, 'timers are not allowed: children are never counted down (ADR-053)');
  }

  // A visible world consequence (pillar 2) for adventures.
  const kind = options.kind ?? 'AUTO';
  const isAdventure = kind === 'ADVENTURE' || (kind === 'AUTO' && typeof root.realmId === 'string');
  if (isAdventure) {
    const consequence = root.worldConsequenceId ?? root.worldChange;
    const present =
      typeof consequence === 'string'
        ? consequence !== ''
        : isRecord(consequence) && Object.keys(consequence).length > 0;
    if (!present) {
      add(
        'MISSING_WORLD_CONSEQUENCE',
        'worldConsequenceId',
        'an adventure must leave a visible world consequence (learning makes the island grow)',
      );
    }
  }
}
