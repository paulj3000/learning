/**
 * Movement and difficulty profiles per age band, inside the jumping standard's limits
 * (`docs/adventures/jumping-standard.md`, "Physics parameters").
 *
 * Difficulty lives in content, never in engine branches. A profile is the starting point for a
 * band; an adventure may override fields, and `resolveProfile` reports every override it had
 * to clamp or refuse as an issue (never silently), so a content author sees it.
 *
 * Age band values match `react/src/features/child-profile/constants.ts` and the Django
 * `AgeBand` values: SPROUT (3-4), PATHFINDER (5-6), EXPLORER (7-8).
 */

import type { ValidationIssue } from '../core/errors';
import { isRecord } from './validation';
import { JUMP_LIMITS as CONTROLLER_JUMP_LIMITS } from '../movement/jumpConfiguration';

export const AGE_BANDS = ['SPROUT', 'PATHFINDER', 'EXPLORER'] as const;
export type AgeBand = (typeof AGE_BANDS)[number];

export function isAgeBand(value: unknown): value is AgeBand {
  return typeof value === 'string' && (AGE_BANDS as readonly string[]).includes(value);
}

/** Inclusive limits from the jumping standard. */
type ControllerJumpLimitKey = keyof typeof CONTROLLER_JUMP_LIMITS;

/**
 * The jumping standard's limits as `[min, max]` ranges, derived from the shared controller's
 * `JUMP_LIMITS` (`movement/jumpConfiguration.ts`) so the SDK and the controller can never
 * disagree.
 */
export const JUMP_LIMIT_RANGES: {
  readonly [K in ControllerJumpLimitKey]: readonly [number, number];
} = Object.freeze(
  Object.fromEntries(
    (Object.keys(CONTROLLER_JUMP_LIMITS) as ControllerJumpLimitKey[]).map((key) => [
      key,
      Object.freeze([CONTROLLER_JUMP_LIMITS[key].min, CONTROLLER_JUMP_LIMITS[key].max] as const),
    ]),
  ) as { [K in ControllerJumpLimitKey]: readonly [number, number] },
);

/** Walk speed bounds (m/s). The standard sets none; these keep authored values sane. */
export const WALK_SPEED_LIMIT = [0.5, 6] as const;
/** Platform speed bounds (m/s) from the jumping standard: "speeds 0.2 to 4 m/s". */
export const PLATFORM_SPEED_LIMIT = [0.2, 4] as const;

export interface JumpProfile {
  enabled: boolean;
  jumpHeight: number;
  gravity: number;
  airControl: number;
  maxFallSpeed: number;
  coyoteTimeMs: number;
  jumpBufferMs: number;
  /** No double jump by default; Sprouts can never have it. */
  allowDoubleJump: boolean;
}

export interface MovementProfile {
  walkSpeed: number;
  /** Assisted steering: wider landing tolerance and gentler air drift (Sprouts default on). */
  guidedSteering: boolean;
  jump: JumpProfile;
}

export interface DifficultyProfile {
  /** Widest gap a required-or-optional jump may ask, in metres. */
  maxGapMeters: number;
  /** Tallest single step up, in metres. */
  maxPlatformHeightMeters: number;
  maxConsecutiveJumps: number;
  /** Fastest moving platform, m/s. 0 means no moving platforms for this band. */
  maxMovingPlatformSpeed: number;
  allowVanishingPlatforms: boolean;
  /** A checkpoint is required at least every this many jumps in a row. */
  checkpointEveryJumps: number;
  /** Jump routes may only ever be optional (Sprouts). */
  jumpRoutesOptionalOnly: boolean;
  /** Always false: no hazard on any route a child needs. Not overridable. */
  hazardsOnRequiredRoutes: false;
}

export interface ProfileOverrides {
  movement?: { walkSpeed?: number; guidedSteering?: boolean; jump?: Partial<JumpProfile> };
  difficulty?: Partial<Omit<DifficultyProfile, 'hazardsOnRequiredRoutes'>> & {
    hazardsOnRequiredRoutes?: boolean;
  };
}

/** A clamped or refused override: the author asked for `requested` and got `applied`. */
export interface ProfileIssue extends ValidationIssue {
  requested: unknown;
  applied: unknown;
}

export interface ResolvedProfile {
  band: AgeBand;
  movement: MovementProfile;
  difficulty: DifficultyProfile;
  /** Empty when every override was accepted as authored. */
  issues: ProfileIssue[];
}

const DEFAULT_MOVEMENT: Record<AgeBand, MovementProfile> = {
  SPROUT: {
    walkSpeed: 2.2,
    guidedSteering: true,
    jump: {
      enabled: true,
      jumpHeight: 0.6,
      gravity: 20,
      airControl: 0.9,
      maxFallSpeed: 12,
      coyoteTimeMs: 250,
      jumpBufferMs: 250,
      allowDoubleJump: false,
    },
  },
  PATHFINDER: {
    walkSpeed: 2.8,
    guidedSteering: false,
    jump: {
      enabled: true,
      jumpHeight: 1.0,
      gravity: 22,
      airControl: 0.75,
      maxFallSpeed: 16,
      coyoteTimeMs: 180,
      jumpBufferMs: 200,
      allowDoubleJump: false,
    },
  },
  EXPLORER: {
    walkSpeed: 3.2,
    guidedSteering: false,
    jump: {
      enabled: true,
      jumpHeight: 1.2,
      gravity: 22,
      airControl: 0.65,
      maxFallSpeed: 18,
      coyoteTimeMs: 120,
      jumpBufferMs: 150,
      allowDoubleJump: false,
    },
  },
};

const DEFAULT_DIFFICULTY: Record<AgeBand, DifficultyProfile> = {
  SPROUT: {
    maxGapMeters: 0.6,
    maxPlatformHeightMeters: 0.5,
    maxConsecutiveJumps: 1,
    maxMovingPlatformSpeed: 0,
    allowVanishingPlatforms: false,
    checkpointEveryJumps: 1,
    jumpRoutesOptionalOnly: true,
    hazardsOnRequiredRoutes: false,
  },
  PATHFINDER: {
    maxGapMeters: 1.0,
    maxPlatformHeightMeters: 1.0,
    maxConsecutiveJumps: 3,
    maxMovingPlatformSpeed: 1.0,
    allowVanishingPlatforms: false,
    checkpointEveryJumps: 3,
    jumpRoutesOptionalOnly: false,
    hazardsOnRequiredRoutes: false,
  },
  EXPLORER: {
    maxGapMeters: 1.6,
    maxPlatformHeightMeters: 1.6,
    maxConsecutiveJumps: 6,
    maxMovingPlatformSpeed: 2.5,
    allowVanishingPlatforms: true,
    checkpointEveryJumps: 5,
    jumpRoutesOptionalOnly: false,
    hazardsOnRequiredRoutes: false,
  },
};

/** Ceilings an override may not exceed for a band (the jumping standard's band expectations). */
const DIFFICULTY_CEILINGS: Record<
  AgeBand,
  { gap: number; height: number; consecutive: number; speed: number }
> = {
  SPROUT: { gap: 0.8, height: 0.6, consecutive: 1, speed: 0 },
  PATHFINDER: { gap: 1.2, height: 1.2, consecutive: 4, speed: 1.5 },
  EXPLORER: { gap: 2.5, height: 2.5, consecutive: 8, speed: 4 },
};

export function defaultMovementProfile(band: AgeBand): MovementProfile {
  const base = DEFAULT_MOVEMENT[band];
  return { ...base, jump: { ...base.jump } };
}

export function defaultDifficultyProfile(band: AgeBand): DifficultyProfile {
  return { ...DEFAULT_DIFFICULTY[band] };
}

type Bounds = readonly [number, number];

function applyNumber<T extends object>(
  target: T,
  key: keyof T & string,
  raw: unknown,
  bounds: Bounds,
  path: string,
  issues: ProfileIssue[],
  options: { integer?: boolean } = {},
): void {
  if (raw === undefined) {
    return;
  }
  const current = target[key];
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    issues.push({
      path,
      message: 'must be a finite number; the band default was kept',
      requested: raw,
      applied: current,
    });
    return;
  }
  let value = Math.min(bounds[1], Math.max(bounds[0], raw));
  if (options.integer) {
    value = Math.round(value);
  }
  if (value !== raw) {
    issues.push({
      path,
      message: `was clamped to the allowed range ${bounds[0]} to ${bounds[1]}`,
      requested: raw,
      applied: value,
    });
  }
  (target as Record<string, unknown>)[key] = value;
}

function applyBoolean<T extends object>(
  target: T,
  key: keyof T & string,
  raw: unknown,
  path: string,
  issues: ProfileIssue[],
  forced?: boolean,
): void {
  if (raw === undefined) {
    return;
  }
  if (typeof raw !== 'boolean') {
    issues.push({
      path,
      message: 'must be true or false; the band default was kept',
      requested: raw,
      applied: target[key],
    });
    return;
  }
  if (forced !== undefined && raw !== forced) {
    issues.push({
      path,
      message: `must be ${forced} for this band or field; the override was refused`,
      requested: raw,
      applied: forced,
    });
    (target as Record<string, unknown>)[key] = forced;
    return;
  }
  (target as Record<string, unknown>)[key] = raw;
}

/**
 * Resolves the profile for a band: band defaults, then the adventure's overrides. Every clamp,
 * refusal and malformed value is returned in `issues`. Never throws.
 */
export function resolveProfile(band: AgeBand, overrides: ProfileOverrides = {}): ResolvedProfile {
  const issues: ProfileIssue[] = [];
  const movement = defaultMovementProfile(band);
  const difficulty = defaultDifficultyProfile(band);
  const ceilings = DIFFICULTY_CEILINGS[band];

  const movementOverride: unknown = overrides.movement;
  if (movementOverride !== undefined) {
    if (!isRecord(movementOverride)) {
      issues.push({
        path: 'movement',
        message: 'must be an object',
        requested: movementOverride,
        applied: null,
      });
    } else {
      applyNumber(
        movement,
        'walkSpeed',
        movementOverride.walkSpeed,
        WALK_SPEED_LIMIT,
        'movement.walkSpeed',
        issues,
      );
      applyBoolean(
        movement,
        'guidedSteering',
        movementOverride.guidedSteering,
        'movement.guidedSteering',
        issues,
      );
      const jumpOverride = movementOverride.jump;
      if (jumpOverride !== undefined) {
        if (!isRecord(jumpOverride)) {
          issues.push({
            path: 'movement.jump',
            message: 'must be an object',
            requested: jumpOverride,
            applied: null,
          });
        } else {
          const jump = movement.jump;
          applyBoolean(jump, 'enabled', jumpOverride.enabled, 'movement.jump.enabled', issues);
          for (const key of [
            'jumpHeight',
            'gravity',
            'airControl',
            'maxFallSpeed',
            'coyoteTimeMs',
            'jumpBufferMs',
          ] as const) {
            applyNumber(
              jump,
              key,
              jumpOverride[key],
              JUMP_LIMIT_RANGES[key as ControllerJumpLimitKey],
              `movement.jump.${key}`,
              issues,
            );
          }
          applyBoolean(
            jump,
            'allowDoubleJump',
            jumpOverride.allowDoubleJump,
            'movement.jump.allowDoubleJump',
            issues,
            band === 'SPROUT' ? false : undefined,
          );
        }
      }
    }
  }

  const difficultyOverride: unknown = overrides.difficulty;
  if (difficultyOverride !== undefined) {
    if (!isRecord(difficultyOverride)) {
      issues.push({
        path: 'difficulty',
        message: 'must be an object',
        requested: difficultyOverride,
        applied: null,
      });
    } else {
      applyNumber(
        difficulty,
        'maxGapMeters',
        difficultyOverride.maxGapMeters,
        [0, ceilings.gap],
        'difficulty.maxGapMeters',
        issues,
      );
      applyNumber(
        difficulty,
        'maxPlatformHeightMeters',
        difficultyOverride.maxPlatformHeightMeters,
        [0, ceilings.height],
        'difficulty.maxPlatformHeightMeters',
        issues,
      );
      applyNumber(
        difficulty,
        'maxConsecutiveJumps',
        difficultyOverride.maxConsecutiveJumps,
        [1, ceilings.consecutive],
        'difficulty.maxConsecutiveJumps',
        issues,
        { integer: true },
      );
      applyNumber(
        difficulty,
        'maxMovingPlatformSpeed',
        difficultyOverride.maxMovingPlatformSpeed,
        [0, ceilings.speed],
        'difficulty.maxMovingPlatformSpeed',
        issues,
      );
      applyNumber(
        difficulty,
        'checkpointEveryJumps',
        difficultyOverride.checkpointEveryJumps,
        [1, 12],
        'difficulty.checkpointEveryJumps',
        issues,
        { integer: true },
      );
      applyBoolean(
        difficulty,
        'allowVanishingPlatforms',
        difficultyOverride.allowVanishingPlatforms,
        'difficulty.allowVanishingPlatforms',
        issues,
        band === 'SPROUT' ? false : undefined,
      );
      applyBoolean(
        difficulty,
        'jumpRoutesOptionalOnly',
        difficultyOverride.jumpRoutesOptionalOnly,
        'difficulty.jumpRoutesOptionalOnly',
        issues,
        band === 'SPROUT' ? true : undefined,
      );
      if (
        difficultyOverride.hazardsOnRequiredRoutes !== undefined &&
        difficultyOverride.hazardsOnRequiredRoutes !== false
      ) {
        issues.push({
          path: 'difficulty.hazardsOnRequiredRoutes',
          message:
            'must be false: no hazard may sit on a route a child needs; the override was refused',
          requested: difficultyOverride.hazardsOnRequiredRoutes,
          applied: false,
        });
      }
    }
  }
  return { band, movement, difficulty, issues };
}
