/**
 * Movement capability definitions (GE-020). Jumping is a standard capability any adventure may
 * enable, not a platformer mode (jumping standard). Physics constants (substep, step height,
 * body height, recovery depth) are controller constants and are not adventure-overridable.
 *
 * `validate` never throws: unknown keys and bad values come back as issues, nothing is
 * silently clamped. `install` stays minimal: the validated config is recorded on the runtime
 * (`runtime.capabilityConfig(id)`); `movementSystem.ts` reads it to decide which environment
 * features the player controller may use.
 */

import {
  validationFailed,
  validationOk,
  type ValidationIssue,
  type ValidationResult,
} from '../core/errors';
import type { CapabilityDefinition, CapabilityRegistry } from '../core/capabilities';
import {
  DEFAULT_JUMP_CONFIGURATION,
  resolveJumpConfiguration,
  validateMovementSpec,
  type JumpConfiguration,
} from './jumpConfiguration';
import {
  DEFAULT_LOCOMOTION,
  resolveLocomotion,
  validateLocomotion,
  type LocomotionConfiguration,
} from './locomotionConfiguration';
import { MAX_EXTERNAL_FORCE, MIN_SURFACE_FRICTION } from './firstPersonController';

export const MOVEMENT_LOCOMOTION = 'movement.locomotion';
export const MOVEMENT_JUMP = 'movement.jump';
export const MOVEMENT_SURFACES = 'movement.surfaces';
export const MOVEMENT_EXTERNAL_FORCES = 'movement.externalForces';
export const MOVEMENT_SWIMMING = 'movement.swimming';
export const MOVEMENT_CLIMBING = 'movement.climbing';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Runs a check that builds issues, then wraps them as a validation result. */
function finish<T>(issues: ValidationIssue[], value: () => T): ValidationResult<T> {
  return issues.length > 0 ? validationFailed(issues) : validationOk(value());
}

/** Rejects unknown keys and non-objects; returns the record or issues. */
function recordOf(
  input: unknown,
  allowed: readonly string[],
  issues: ValidationIssue[],
): Record<string, unknown> {
  if (input === undefined) {
    return {};
  }
  if (!isRecord(input)) {
    issues.push({ path: '', message: 'must be an object' });
    return {};
  }
  for (const key of Object.keys(input)) {
    if (!allowed.includes(key)) {
      issues.push({ path: key, message: 'is not a setting of this capability' });
    }
  }
  return input;
}

function numberIn(
  record: Record<string, unknown>,
  key: string,
  min: number,
  max: number,
  fallback: number,
  issues: ValidationIssue[],
): number {
  const value = record[key];
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    issues.push({ path: key, message: `must be a number between ${min} and ${max}` });
    return fallback;
  }
  return value;
}

/** Re-roots issues reported by the existing validators under `prefix` into capability-relative paths. */
function relative(
  prefix: string,
  issues: readonly { path: string; message: string }[],
): ValidationIssue[] {
  return issues.map((issue) => ({
    path:
      issue.path === prefix
        ? ''
        : issue.path.startsWith(`${prefix}.`)
          ? issue.path.slice(prefix.length + 1)
          : issue.path,
    message: issue.message,
  }));
}

// --- locomotion ---------------------------------------------------------------------------

export const locomotionCapability: CapabilityDefinition<LocomotionConfiguration> = {
  id: MOVEMENT_LOCOMOTION,
  version: '1.0.0',
  description: 'Walk, run and sprint speeds and acceleration (LocomotionConfiguration).',
  defaults: { ...DEFAULT_LOCOMOTION },
  validate(input) {
    const issues = relative('locomotion', validateLocomotion(input ?? undefined, 'locomotion'));
    return finish(issues, () =>
      resolveLocomotion(isRecord(input) ? (input as Partial<LocomotionConfiguration>) : undefined),
    );
  },
};

// --- jump ---------------------------------------------------------------------------------

export const jumpCapability: CapabilityDefinition<JumpConfiguration> = {
  id: MOVEMENT_JUMP,
  version: '1.0.0',
  description:
    'Jumping within the jumping standard limits. `enabled: false` is valid; no double jump unless allowed.',
  requires: [MOVEMENT_LOCOMOTION],
  defaults: { ...DEFAULT_JUMP_CONFIGURATION },
  validate(input) {
    const issues = relative('movement.jump', validateMovementSpec({ jump: input ?? undefined }));
    return finish(issues, () =>
      resolveJumpConfiguration(isRecord(input) ? (input as Partial<JumpConfiguration>) : undefined),
    );
  },
};

// --- surfaces -----------------------------------------------------------------------------

export interface SurfaceProfileConfig {
  id: string;
  friction: number;
  speedMultiplier: number;
  footstepCue?: string;
}

export interface SurfacesConfig {
  /** Authored surface profiles, looked up by `ColliderSpec.surfaceId`. */
  profiles: SurfaceProfileConfig[];
  /** Steepest walkable ground, rise over run. Null: unlimited (today's behaviour). */
  maxWalkableSlope: number | null;
}

export const surfacesCapability: CapabilityDefinition<SurfacesConfig> = {
  id: MOVEMENT_SURFACES,
  version: '1.0.0',
  description:
    'Surface friction (ice), surface speed and a walkable slope limit. Friction changes acceleration only, never top speed.',
  requires: [MOVEMENT_LOCOMOTION],
  defaults: { profiles: [], maxWalkableSlope: null },
  validate(input) {
    const issues: ValidationIssue[] = [];
    const record = recordOf(input, ['profiles', 'maxWalkableSlope'], issues);
    const profiles: SurfaceProfileConfig[] = [];
    const rawProfiles = record.profiles;
    if (rawProfiles !== undefined) {
      if (!Array.isArray(rawProfiles)) {
        issues.push({ path: 'profiles', message: 'must be a list' });
      } else {
        const seen = new Set<string>();
        rawProfiles.forEach((raw, index) => {
          const at = `profiles[${index}]`;
          const profileIssues: ValidationIssue[] = [];
          const p = recordOf(
            raw,
            ['id', 'friction', 'speedMultiplier', 'footstepCue'],
            profileIssues,
          );
          for (const issue of profileIssues) {
            issues.push({ path: issue.path ? `${at}.${issue.path}` : at, message: issue.message });
          }
          const id = p.id;
          if (typeof id !== 'string' || id.trim() === '') {
            issues.push({ path: `${at}.id`, message: 'needs a non-empty id' });
          } else if (seen.has(id)) {
            issues.push({ path: `${at}.id`, message: `duplicate surface id "${id}"` });
          } else {
            seen.add(id);
          }
          const sub: ValidationIssue[] = [];
          const friction = numberIn(p, 'friction', MIN_SURFACE_FRICTION, 1, 1, sub);
          const speedMultiplier = numberIn(p, 'speedMultiplier', 0.5, 1.5, 1, sub);
          for (const issue of sub) {
            issues.push({ path: `${at}.${issue.path}`, message: issue.message });
          }
          if (p.footstepCue !== undefined && typeof p.footstepCue !== 'string') {
            issues.push({ path: `${at}.footstepCue`, message: 'must be text' });
          }
          profiles.push({
            id: typeof id === 'string' ? id : '',
            friction,
            speedMultiplier,
            ...(typeof p.footstepCue === 'string' ? { footstepCue: p.footstepCue } : {}),
          });
        });
      }
    }
    let maxWalkableSlope: number | null = null;
    if (record.maxWalkableSlope !== undefined && record.maxWalkableSlope !== null) {
      const sub: ValidationIssue[] = [];
      maxWalkableSlope = numberIn(record, 'maxWalkableSlope', 0.05, 5, 5, sub);
      issues.push(...sub);
    }
    return finish(issues, () => ({ profiles, maxWalkableSlope }));
  },
};

// --- external forces ----------------------------------------------------------------------

export interface ExternalForcesConfig {
  /** Scale on every force under reduced motion (0 to 1). Default 0.5, as the realm doc asks. */
  reducedMotionScale: number;
}

export const externalForcesCapability: CapabilityDefinition<ExternalForcesConfig> = {
  id: MOVEMENT_EXTERNAL_FORCES,
  version: '1.0.0',
  description: `Wind, currents, conveyors and updrafts. Horizontal force is capped at ${MAX_EXTERNAL_FORCE} m/s2 and so walking against it always wins.`,
  requires: [MOVEMENT_LOCOMOTION],
  defaults: { reducedMotionScale: 0.5 },
  validate(input) {
    const issues: ValidationIssue[] = [];
    const record = recordOf(input, ['reducedMotionScale'], issues);
    const reducedMotionScale = numberIn(record, 'reducedMotionScale', 0, 1, 0.5, issues);
    return finish(issues, () => ({ reducedMotionScale }));
  },
};

// --- swimming and climbing ----------------------------------------------------------------

export interface EnabledConfig {
  enabled: boolean;
}

function enabledCapability(id: string, description: string): CapabilityDefinition<EnabledConfig> {
  return {
    id,
    version: '1.0.0',
    description,
    requires: [MOVEMENT_LOCOMOTION],
    defaults: { enabled: true },
    validate(input) {
      const issues: ValidationIssue[] = [];
      const record = recordOf(input, ['enabled'], issues);
      if (record.enabled !== undefined && typeof record.enabled !== 'boolean') {
        issues.push({ path: 'enabled', message: 'must be true or false' });
      }
      return finish(issues, () => ({ enabled: record.enabled !== false }));
    },
  };
}

export const swimmingCapability = enabledCapability(
  MOVEMENT_SWIMMING,
  'Swimming in water: reduced gravity, buoyancy and jump as a swim stroke. No drowning, no timers.',
);

export const climbingCapability = enabledCapability(
  MOVEMENT_CLIMBING,
  'Ladders and climbable surfaces: forward and back move along them, no gravity, jump lets go.',
);

export const movementCapabilities = [
  locomotionCapability,
  jumpCapability,
  surfacesCapability,
  externalForcesCapability,
  swimmingCapability,
  climbingCapability,
] as const;

/** Registers every movement capability on a registry (the SDK and runtime share one). */
export function registerMovementCapabilities<Context>(registry: CapabilityRegistry<Context>): void {
  for (const definition of movementCapabilities) {
    registry.register(definition as unknown as CapabilityDefinition<unknown, Context>);
  }
}
