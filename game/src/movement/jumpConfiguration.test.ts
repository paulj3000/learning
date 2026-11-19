import { describe, expect, it } from 'vitest';
import {
  DEFAULT_JUMP_CONFIGURATION,
  JUMP_LIMITS,
  jumpLaunchSpeed,
  resolveJumpConfiguration,
  validateMovementSpec,
} from './jumpConfiguration';

describe('jump configuration (LAI-JMP-01)', () => {
  it('defaults to jumping on, no double jump, with forgiving windows', () => {
    expect(DEFAULT_JUMP_CONFIGURATION).toMatchObject({
      enabled: true,
      allowDoubleJump: false,
    });
    expect(DEFAULT_JUMP_CONFIGURATION.coyoteTimeMs).toBeGreaterThan(0);
    expect(DEFAULT_JUMP_CONFIGURATION.jumpBufferMs).toBeGreaterThan(0);
  });

  it('clears a 0.9 m barrel by default', () => {
    expect(DEFAULT_JUMP_CONFIGURATION.jumpHeight).toBeGreaterThan(0.9);
  });

  it('resolves to the defaults when a location says nothing', () => {
    expect(resolveJumpConfiguration(undefined)).toEqual(DEFAULT_JUMP_CONFIGURATION);
    expect(resolveJumpConfiguration(null)).toEqual(DEFAULT_JUMP_CONFIGURATION);
    expect(resolveJumpConfiguration({})).toEqual(DEFAULT_JUMP_CONFIGURATION);
  });

  it('overrides only the fields a location names', () => {
    const resolved = resolveJumpConfiguration({ jumpHeight: 0.9, enabled: false });
    expect(resolved).toEqual({ ...DEFAULT_JUMP_CONFIGURATION, jumpHeight: 0.9, enabled: false });
  });

  it('clamps out-of-range numbers and ignores non-finite or mistyped values', () => {
    const resolved = resolveJumpConfiguration({
      jumpHeight: 50,
      gravity: Number.NaN,
      airControl: -1,
      allowDoubleJump: 'yes' as unknown as boolean,
    });
    expect(resolved.jumpHeight).toBe(JUMP_LIMITS.jumpHeight.max);
    expect(resolved.gravity).toBe(DEFAULT_JUMP_CONFIGURATION.gravity);
    expect(resolved.airControl).toBe(0);
    expect(resolved.allowDoubleJump).toBe(false);
  });

  it('computes launch speed as sqrt(2gh)', () => {
    expect(jumpLaunchSpeed({ jumpHeight: 2, gravity: 9 })).toBeCloseTo(6);
  });

  describe('validateMovementSpec', () => {
    it('accepts an absent or well-formed movement block', () => {
      expect(validateMovementSpec(undefined)).toEqual([]);
      expect(validateMovementSpec({})).toEqual([]);
      expect(validateMovementSpec({ jump: { enabled: false, jumpHeight: 0.9 } })).toEqual([]);
    });

    it('reports typos, wrong types and out-of-range values by path', () => {
      expect(
        validateMovementSpec({
          jump: { jumpHieght: 1, enabled: 'no', gravity: 500, coyoteTimeMs: 'a' },
          run: true,
        }),
      ).toEqual([
        { path: 'movement.run', message: 'is not a movement setting' },
        { path: 'movement.jump.jumpHieght', message: 'is not a jump setting' },
        { path: 'movement.jump.enabled', message: 'must be true or false' },
        { path: 'movement.jump.gravity', message: 'must be between 5 and 80' },
        { path: 'movement.jump.coyoteTimeMs', message: 'must be a number' },
      ]);
    });

    it('rejects a movement block that is not an object', () => {
      expect(validateMovementSpec([])).toEqual([
        { path: 'movement', message: 'must be an object' },
      ]);
      expect(validateMovementSpec({ jump: 3 })).toEqual([
        { path: 'movement.jump', message: 'must be an object' },
      ]);
    });
  });
});
