import { describe, expect, it } from 'vitest';
import {
  AGE_BANDS,
  JUMP_LIMIT_RANGES,
  defaultMovementProfile,
  isAgeBand,
  movementSpecForProfile,
  resolveProfile,
} from './profiles';
import { validateMovementSpec } from '../movement/jumpConfiguration';

describe('band profiles', () => {
  it.each(AGE_BANDS)('%s defaults sit inside the jumping standard limits', (band) => {
    const { jump } = defaultMovementProfile(band);
    for (const key of Object.keys(JUMP_LIMIT_RANGES) as (keyof typeof JUMP_LIMIT_RANGES)[]) {
      const [low, high] = JUMP_LIMIT_RANGES[key];
      expect(jump[key]).toBeGreaterThanOrEqual(low);
      expect(jump[key]).toBeLessThanOrEqual(high);
    }
    expect(jump.allowDoubleJump).toBe(false);
  });

  it('resolving with no overrides reports no issues', () => {
    for (const band of AGE_BANDS) {
      expect(resolveProfile(band).issues).toEqual([]);
    }
  });

  it('gives Sprouts guided, low, optional-only jumping', () => {
    const sprout = resolveProfile('SPROUT');
    const explorer = resolveProfile('EXPLORER');
    expect(sprout.movement.guidedSteering).toBe(true);
    expect(sprout.movement.jump.jumpHeight).toBeLessThan(explorer.movement.jump.jumpHeight);
    expect(sprout.movement.jump.coyoteTimeMs).toBeGreaterThan(explorer.movement.jump.coyoteTimeMs);
    expect(sprout.difficulty.jumpRoutesOptionalOnly).toBe(true);
    expect(sprout.difficulty.maxMovingPlatformSpeed).toBe(0);
    expect(sprout.difficulty.allowVanishingPlatforms).toBe(false);
    expect(sprout.difficulty.maxConsecutiveJumps).toBe(1);
  });

  it('accepts in-range overrides without issues', () => {
    const resolved = resolveProfile('PATHFINDER', {
      movement: { jump: { jumpHeight: 0.9, coyoteTimeMs: 200 } },
    });
    expect(resolved.issues).toEqual([]);
    expect(resolved.movement.jump.jumpHeight).toBe(0.9);
  });

  it('reports clamping as issues, never silently', () => {
    const resolved = resolveProfile('EXPLORER', {
      movement: {
        jump: {
          jumpHeight: 9,
          gravity: 1,
          airControl: 2,
          maxFallSpeed: 100,
          coyoteTimeMs: 999,
          jumpBufferMs: -5,
        },
      },
    });
    expect(resolved.movement.jump).toMatchObject({
      jumpHeight: 2.5,
      gravity: 5,
      airControl: 1,
      maxFallSpeed: 60,
      coyoteTimeMs: 400,
      jumpBufferMs: 0,
    });
    expect(resolved.issues.map((issue) => issue.path).sort()).toEqual(
      [
        'movement.jump.airControl',
        'movement.jump.coyoteTimeMs',
        'movement.jump.gravity',
        'movement.jump.jumpBufferMs',
        'movement.jump.jumpHeight',
        'movement.jump.maxFallSpeed',
      ].sort(),
    );
    const height = resolved.issues.find((issue) => issue.path === 'movement.jump.jumpHeight');
    expect(height).toMatchObject({ requested: 9, applied: 2.5 });
  });

  it('keeps the band default and reports malformed values', () => {
    const resolved = resolveProfile('SPROUT', { movement: { jump: { jumpHeight: Number.NaN } } });
    expect(resolved.movement.jump.jumpHeight).toBe(
      defaultMovementProfile('SPROUT').jump.jumpHeight,
    );
    expect(resolved.issues).toHaveLength(1);
  });

  it('refuses double jump for Sprouts but allows an explicit override for others', () => {
    const sprout = resolveProfile('SPROUT', { movement: { jump: { allowDoubleJump: true } } });
    expect(sprout.movement.jump.allowDoubleJump).toBe(false);
    expect(sprout.issues).toHaveLength(1);
    const explorer = resolveProfile('EXPLORER', { movement: { jump: { allowDoubleJump: true } } });
    expect(explorer.movement.jump.allowDoubleJump).toBe(true);
    expect(explorer.issues).toEqual([]);
  });

  it('caps difficulty at the band ceiling and refuses hazards on required routes', () => {
    const sprout = resolveProfile('SPROUT', {
      difficulty: {
        maxConsecutiveJumps: 5,
        maxMovingPlatformSpeed: 2,
        allowVanishingPlatforms: true,
        jumpRoutesOptionalOnly: false,
      },
    });
    expect(sprout.difficulty.maxConsecutiveJumps).toBe(1);
    expect(sprout.difficulty.maxMovingPlatformSpeed).toBe(0);
    expect(sprout.difficulty.allowVanishingPlatforms).toBe(false);
    expect(sprout.difficulty.jumpRoutesOptionalOnly).toBe(true);
    expect(sprout.issues).toHaveLength(4);

    const hazard = resolveProfile('EXPLORER', { difficulty: { hazardsOnRequiredRoutes: true } });
    expect(hazard.difficulty.hazardsOnRequiredRoutes).toBe(false);
    expect(hazard.issues).toHaveLength(1);
  });

  it('never throws on hostile overrides', () => {
    const resolved = resolveProfile('PATHFINDER', { movement: 5, difficulty: 'x' } as never);
    expect(resolved.issues).toHaveLength(2);
  });

  it('knows age bands', () => {
    expect(isAgeBand('SPROUT')).toBe(true);
    expect(isAgeBand('sprouts')).toBe(false);
  });
});

describe('movementSpecForProfile (LAI-2104S groundwork)', () => {
  it.each(AGE_BANDS)('%s maps to a movement spec the controller validator accepts', (band) => {
    const spec = movementSpecForProfile(resolveProfile(band));
    expect(validateMovementSpec(spec)).toEqual([]);
    expect(spec.jump).toEqual(defaultMovementProfile(band).jump);
    expect(spec.locomotion?.walkSpeed).toBe(defaultMovementProfile(band).walkSpeed);
  });

  it('never makes running or sprinting slower than walking', () => {
    const spec = movementSpecForProfile(resolveProfile('EXPLORER', { movement: { walkSpeed: 6 } }));
    expect(spec.locomotion).toEqual({ walkSpeed: 6, runSpeed: 6, sprintSpeed: 6.5 });
  });

  it('keeps what resolveProfile clamped clamped', () => {
    const resolved = resolveProfile('SPROUT', { movement: { walkSpeed: 99 } });
    expect(resolved.issues.map((issue) => issue.path)).toContain('movement.walkSpeed');
    const spec = movementSpecForProfile(resolved);
    expect(spec.locomotion?.walkSpeed).toBe(resolved.movement.walkSpeed);
    expect(validateMovementSpec(spec)).toEqual([]);
  });

  it('does not carry guided steering, which waits on owner decision O6', () => {
    const spec = movementSpecForProfile(resolveProfile('SPROUT'));
    expect(Object.keys(spec).sort()).toEqual(['jump', 'locomotion']);
  });

  it('returns a copy, so changing the spec never changes the profile', () => {
    const resolved = resolveProfile('PATHFINDER');
    const spec = movementSpecForProfile(resolved);
    spec.jump!.jumpHeight = 0;
    expect(resolved.movement.jump.jumpHeight).toBe(1.0);
  });
});
