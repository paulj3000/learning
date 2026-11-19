/**
 * Ground speed tuning for the shared player movement controller: walking,
 * running and sprinting (Shared Player Running & Sprinting, ADR-058). The
 * same pattern as `jumpConfiguration.ts`: plain JSON-shaped data under
 * `ThreeLocationManifest.movement.locomotion` (or a Django region's
 * `scene.movement.locomotion`); a location overrides only what it names.
 *
 * Speeds, in metres per second, against the world's scale (1.6 m eye height,
 * a 1.35 m avatar, regions 30 to 90 m across):
 *
 * - **walk 4.0**: the speed every location already had (keyboard, a short
 *   joystick drag, a partly tilted stick). Kept exactly, so walking is
 *   unchanged everywhere.
 * - **run 5.5**: a long joystick drag or a fully tilted stick.
 * - **sprint 6.5**: Shift, L3, or dragging the joystick past its edge.
 *
 * Changing speed eases at `gaitAcceleration` / `gaitDeceleration` (m/s²)
 * above walking pace, so walk to sprint takes about a third of a second and
 * never jumps; starting and stopping keep their snappy existing rates. No
 * stamina, cooldown or penalty: a child may sprint as long as they like.
 */
export interface LocomotionConfiguration {
  /** Full-input speed without running or sprinting. */
  walkSpeed: number;
  /** Full analog input (long drag, fully tilted stick). */
  runSpeed: number;
  /** Shift, L3, or a drag past the joystick's edge. */
  sprintSpeed: number;
  /** How fast velocity eases toward the target while there is input, per second. */
  acceleration: number;
  /** How fast it eases toward zero with no input, per second. */
  deceleration: number;
  /** Most the speed may rise per second above walking pace (m/s²): smooth gait changes. */
  gaitAcceleration: number;
  /** Most it may fall per second above walking pace while still moving (m/s²). */
  gaitDeceleration: number;
  /** Analog input above walking pace runs. Off: analog input tops out at walking. */
  runEnabled: boolean;
  /** Sprinting is allowed. Off: the sprint control does nothing. */
  sprintEnabled: boolean;
}

export const DEFAULT_LOCOMOTION: Readonly<LocomotionConfiguration> = Object.freeze({
  walkSpeed: 4,
  runSpeed: 5.5,
  sprintSpeed: 6.5,
  acceleration: 20,
  deceleration: 25,
  gaitAcceleration: 8,
  gaitDeceleration: 10,
  runEnabled: true,
  sprintEnabled: true,
});

export const LOCOMOTION_LIMITS = Object.freeze({
  walkSpeed: { min: 0.5, max: 8 },
  runSpeed: { min: 0.5, max: 10 },
  sprintSpeed: { min: 0.5, max: 12 },
  acceleration: { min: 1, max: 100 },
  deceleration: { min: 1, max: 100 },
  gaitAcceleration: { min: 0.5, max: 50 },
  gaitDeceleration: { min: 0.5, max: 50 },
});

type NumericKey = keyof typeof LOCOMOTION_LIMITS;
const NUMERIC_KEYS = Object.keys(LOCOMOTION_LIMITS) as NumericKey[];
const BOOLEAN_KEYS = ['runEnabled', 'sprintEnabled'] as const;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * The tuning a location plays with: defaults overridden field by field,
 * numbers clamped, and the speeds kept in order (walk <= run <= sprint).
 */
export function resolveLocomotion(
  override?: Partial<LocomotionConfiguration> | null,
): LocomotionConfiguration {
  const resolved: LocomotionConfiguration = { ...DEFAULT_LOCOMOTION };
  if (override) {
    for (const key of BOOLEAN_KEYS) {
      const value = override[key];
      if (typeof value === 'boolean') resolved[key] = value;
    }
    for (const key of NUMERIC_KEYS) {
      const value = override[key];
      if (typeof value === 'number' && Number.isFinite(value)) {
        resolved[key] = clamp(value, LOCOMOTION_LIMITS[key].min, LOCOMOTION_LIMITS[key].max);
      }
    }
  }
  resolved.runSpeed = Math.max(resolved.runSpeed, resolved.walkSpeed);
  resolved.sprintSpeed = Math.max(resolved.sprintSpeed, resolved.runSpeed);
  return resolved;
}

/** Analog input at or above this (0 to 1) is a full run; below it scales up to walking pace. */
export const RUN_INPUT_THRESHOLD = 0.8;

/**
 * The ground speed for an input of strength `magnitude` (0 to 1). Continuous,
 * so a joystick sweeping out never makes the speed jump:
 *
 * - sprint (and allowed): sprint speed;
 * - analog input with running allowed: walking pace scaled up to
 *   `RUN_INPUT_THRESHOLD`, then rising to run speed at full deflection;
 * - otherwise (keyboard): walking pace times the input, as it always was.
 */
export function targetSpeed(
  config: LocomotionConfiguration,
  magnitude: number,
  options: { analog?: boolean; sprint?: boolean },
): number {
  const m = clamp(Number.isFinite(magnitude) ? magnitude : 0, 0, 1);
  if (m === 0) return 0;
  if (options.sprint && config.sprintEnabled) return config.sprintSpeed;
  if (options.analog && config.runEnabled) {
    if (m <= RUN_INPUT_THRESHOLD) return (config.walkSpeed * m) / RUN_INPUT_THRESHOLD;
    const t = (m - RUN_INPUT_THRESHOLD) / (1 - RUN_INPUT_THRESHOLD);
    return config.walkSpeed + (config.runSpeed - config.walkSpeed) * t;
  }
  return config.walkSpeed * m;
}

export interface LocomotionIssue {
  path: string;
  message: string;
}

/** Every problem with an authored `movement.locomotion` block. */
export function validateLocomotion(
  value: unknown,
  path = 'movement.locomotion',
): LocomotionIssue[] {
  if (value === undefined) return [];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return [{ path, message: 'must be an object' }];
  }
  const issues: LocomotionIssue[] = [];
  const fields = value as Record<string, unknown>;
  for (const [key, field] of Object.entries(fields)) {
    const at = `${path}.${key}`;
    if ((BOOLEAN_KEYS as readonly string[]).includes(key)) {
      if (typeof field !== 'boolean') issues.push({ path: at, message: 'must be true or false' });
    } else if ((NUMERIC_KEYS as readonly string[]).includes(key)) {
      const limits = LOCOMOTION_LIMITS[key as NumericKey];
      if (typeof field !== 'number' || !Number.isFinite(field)) {
        issues.push({ path: at, message: 'must be a number' });
      } else if (field < limits.min || field > limits.max) {
        issues.push({ path: at, message: `must be between ${limits.min} and ${limits.max}` });
      }
    } else {
      issues.push({ path: at, message: 'is not a locomotion setting' });
    }
  }
  const number = (key: NumericKey) =>
    typeof fields[key] === 'number' ? (fields[key] as number) : undefined;
  const walk = number('walkSpeed');
  const run = number('runSpeed');
  const sprint = number('sprintSpeed');
  if (walk !== undefined && run !== undefined && run < walk) {
    issues.push({ path: `${path}.runSpeed`, message: 'must not be slower than walkSpeed' });
  }
  if (run !== undefined && sprint !== undefined && sprint < run) {
    issues.push({ path: `${path}.sprintSpeed`, message: 'must not be slower than runSpeed' });
  }
  return issues;
}
