/**
 * Jump tuning for the shared player movement controller (LAI-JMP-01).
 *
 * Jumping is standard movement, not a platforming feature: every free-roaming
 * 3D location gets it with these defaults unless its manifest says otherwise
 * (`ThreeLocationManifest.movement.jump`). A location overrides only the
 * fields it names, so a castle can lower the jump for its ceilings without
 * restating gravity, and an adventure that must keep the child on the ground
 * sets `enabled: false`.
 *
 * Plain data, JSON-shaped, so the same block can later be authored in Django
 * for a server-served region (`region-play/regionManifest.ts` already reads it
 * from `scene.movement`). Pure: no Three.js, no DOM.
 *
 * Defaults are tuned to the runtime's scale: metres, a 1.6 m eye height
 * (`sceneKit.EYE_HEIGHT`), a 4 m/s walk (`FirstPersonController`), crates
 * 0.8 m and barrels 0.9 m tall (`public/models`). A 1.2 m jump clears a
 * barrel with a little to spare, lands about 2.8 m further on at full walking
 * speed, and is in the air for roughly two thirds of a second: quick enough to
 * feel responsive, long enough for a young child to steer.
 */
export interface JumpConfiguration {
  /** Whether the child can jump here at all. */
  enabled: boolean;
  /** Metres the feet rise above take-off at the top of a jump. */
  jumpHeight: number;
  /** Downward acceleration, m/s². Higher than Earth's 9.8 so jumps feel snappy, not floaty. */
  gravity: number;
  /**
   * How much the child can steer in the air, 0 to 1: the fraction of ground
   * acceleration that applies while airborne. 0 keeps the take-off momentum;
   * 1 steers exactly as on the ground.
   */
  airControl: number;
  /** Terminal falling speed, m/s, so a long drop never tunnels or jolts. */
  maxFallSpeed: number;
  /** How long after walking off an edge a jump still counts, ms ("coyote time"). */
  coyoteTimeMs: number;
  /** How long a jump pressed just before landing is remembered, ms ("jump buffer"). */
  jumpBufferMs: number;
  /** One extra jump in the air. Off by default: a child holding the button should not fly. */
  allowDoubleJump: boolean;
}

export const DEFAULT_JUMP_CONFIGURATION: Readonly<JumpConfiguration> = Object.freeze({
  enabled: true,
  jumpHeight: 1.2,
  gravity: 22,
  airControl: 0.65,
  maxFallSpeed: 18,
  coyoteTimeMs: 120,
  jumpBufferMs: 150,
  allowDoubleJump: false,
});

/** A configuration with jumping off: what a location gets when it opts out. */
export const JUMP_DISABLED: Readonly<JumpConfiguration> = Object.freeze({
  ...DEFAULT_JUMP_CONFIGURATION,
  enabled: false,
});

/**
 * Accepted ranges, so an authored value cannot make the child launch through
 * a ceiling or hang in the air. The validator reports anything outside them;
 * the resolver clamps, so a bad value that slips through still plays safely.
 */
export const JUMP_LIMITS = Object.freeze({
  jumpHeight: { min: 0.2, max: 2.5 },
  gravity: { min: 5, max: 80 },
  airControl: { min: 0, max: 1 },
  maxFallSpeed: { min: 2, max: 60 },
  coyoteTimeMs: { min: 0, max: 400 },
  jumpBufferMs: { min: 0, max: 400 },
});

/** What a manifest may say about movement. Every field optional: absent means the default. */
export interface MovementSpec {
  jump?: Partial<JumpConfiguration>;
}

type NumericKey = keyof typeof JUMP_LIMITS;
const NUMERIC_KEYS = Object.keys(JUMP_LIMITS) as NumericKey[];
const BOOLEAN_KEYS = ['enabled', 'allowDoubleJump'] as const;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * The full configuration a location plays with: defaults, overridden field by
 * field by what it authored. Non-finite numbers fall back to the default and
 * finite ones are clamped into `JUMP_LIMITS`.
 */
export function resolveJumpConfiguration(
  override?: Partial<JumpConfiguration> | null,
): JumpConfiguration {
  const resolved: JumpConfiguration = { ...DEFAULT_JUMP_CONFIGURATION };
  if (!override) return resolved;
  for (const key of BOOLEAN_KEYS) {
    const value = override[key];
    if (typeof value === 'boolean') resolved[key] = value;
  }
  for (const key of NUMERIC_KEYS) {
    const value = override[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      resolved[key] = clamp(value, JUMP_LIMITS[key].min, JUMP_LIMITS[key].max);
    }
  }
  return resolved;
}

/** Launch speed that reaches `jumpHeight` under `gravity`: v = sqrt(2gh). */
export function jumpLaunchSpeed(config: Pick<JumpConfiguration, 'jumpHeight' | 'gravity'>): number {
  return Math.sqrt(2 * config.gravity * config.jumpHeight);
}

export interface JumpConfigurationIssue {
  path: string;
  message: string;
}

/**
 * Every problem with an authored movement block, for the manifest validator
 * and a future Django publish step. An empty list means it is publishable.
 * Unknown keys are reported, so a typo ("jumpHieght") is not silently ignored.
 */
export function validateMovementSpec(
  movement: unknown,
  path = 'movement',
): JumpConfigurationIssue[] {
  const issues: JumpConfigurationIssue[] = [];
  if (movement === undefined) return issues;
  if (typeof movement !== 'object' || movement === null || Array.isArray(movement)) {
    return [{ path, message: 'must be an object' }];
  }
  for (const key of Object.keys(movement)) {
    if (key !== 'jump')
      issues.push({ path: `${path}.${key}`, message: 'is not a movement setting' });
  }
  const jump = (movement as { jump?: unknown }).jump;
  if (jump === undefined) return issues;
  if (typeof jump !== 'object' || jump === null || Array.isArray(jump)) {
    issues.push({ path: `${path}.jump`, message: 'must be an object' });
    return issues;
  }
  const fields = jump as Record<string, unknown>;
  for (const [key, value] of Object.entries(fields)) {
    const at = `${path}.jump.${key}`;
    if ((BOOLEAN_KEYS as readonly string[]).includes(key)) {
      if (typeof value !== 'boolean') issues.push({ path: at, message: 'must be true or false' });
    } else if ((NUMERIC_KEYS as readonly string[]).includes(key)) {
      const limits = JUMP_LIMITS[key as NumericKey];
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        issues.push({ path: at, message: 'must be a number' });
      } else if (value < limits.min || value > limits.max) {
        issues.push({ path: at, message: `must be between ${limits.min} and ${limits.max}` });
      }
    } else {
      issues.push({ path: at, message: 'is not a jump setting' });
    }
  }
  return issues;
}
