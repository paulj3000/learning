import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOCOMOTION,
  resolveLocomotion,
  RUN_INPUT_THRESHOLD,
  targetSpeed,
  validateLocomotion,
} from './locomotionConfiguration';

describe('locomotion configuration (running & sprinting)', () => {
  it('keeps the existing 4 m/s as walking pace, with faster running and sprinting', () => {
    expect(DEFAULT_LOCOMOTION).toMatchObject({
      walkSpeed: 4,
      runSpeed: 5.5,
      sprintSpeed: 6.5,
      acceleration: 20,
      deceleration: 25,
      runEnabled: true,
      sprintEnabled: true,
    });
  });

  it('overrides only what a location names, clamps, and keeps walk <= run <= sprint', () => {
    expect(resolveLocomotion({ sprintSpeed: 5.6 })).toEqual({
      ...DEFAULT_LOCOMOTION,
      sprintSpeed: 5.6,
    });
    const odd = resolveLocomotion({ walkSpeed: 5, runSpeed: 3, sprintSpeed: 99 });
    expect(odd.runSpeed).toBe(5);
    expect(odd.sprintSpeed).toBe(12);
    expect(resolveLocomotion({ runEnabled: 'no' as never }).runEnabled).toBe(true);
  });

  describe('targetSpeed', () => {
    const config = DEFAULT_LOCOMOTION;
    it('walks with keys exactly as before: full keys are walking pace', () => {
      expect(targetSpeed(config, 1, {})).toBe(4);
      expect(targetSpeed(config, 0.5, {})).toBe(2);
      expect(targetSpeed(config, 0, { sprint: true })).toBe(0);
    });

    it('runs with strong analog input, continuously (no jump in speed)', () => {
      expect(targetSpeed(config, RUN_INPUT_THRESHOLD, { analog: true })).toBeCloseTo(4);
      expect(targetSpeed(config, RUN_INPUT_THRESHOLD - 1e-6, { analog: true })).toBeCloseTo(4, 4);
      expect(targetSpeed(config, RUN_INPUT_THRESHOLD + 1e-6, { analog: true })).toBeCloseTo(4, 4);
      expect(targetSpeed(config, 1, { analog: true })).toBe(5.5);
      expect(targetSpeed(config, 0.4, { analog: true })).toBeCloseTo(2);
    });

    it('sprints at sprint speed whenever moving with sprint on', () => {
      expect(targetSpeed(config, 1, { sprint: true })).toBe(6.5);
      expect(targetSpeed(config, 0.3, { sprint: true, analog: true })).toBe(6.5);
    });

    it('honours running and sprinting being turned off', () => {
      const calm = resolveLocomotion({ runEnabled: false, sprintEnabled: false });
      expect(targetSpeed(calm, 1, { analog: true })).toBe(4);
      expect(targetSpeed(calm, 1, { sprint: true })).toBe(4);
    });
  });

  it('validates an authored block by path', () => {
    expect(validateLocomotion(undefined)).toEqual([]);
    expect(validateLocomotion({ runSpeed: 4.8, sprintEnabled: false })).toEqual([]);
    expect(
      validateLocomotion({
        walkSpeed: 5,
        runSpeed: 4,
        sprintSpeed: 'fast',
        stamina: 10,
        runEnabled: 1,
      }),
    ).toEqual([
      { path: 'movement.locomotion.sprintSpeed', message: 'must be a number' },
      { path: 'movement.locomotion.stamina', message: 'is not a locomotion setting' },
      { path: 'movement.locomotion.runEnabled', message: 'must be true or false' },
      { path: 'movement.locomotion.runSpeed', message: 'must not be slower than walkSpeed' },
    ]);
    expect(validateLocomotion([])).toEqual([
      { path: 'movement.locomotion', message: 'must be an object' },
    ]);
  });
});
