/**
 * The player's physical footprint for the shared movement controller (Defect 2: a child could
 * walk half-way into Storykeeper Castle's walls because the controller tested a single point).
 *
 * The same pattern as `locomotionConfiguration.ts`: plain JSON-shaped data under
 * `ThreeLocationManifest.movement.collision` (or a Django region's `scene.movement.collision`);
 * a location overrides only what it names, and only where it really needs to.
 *
 * Measured against the avatars the game draws, not their animated extremities:
 * - the placeholder explorer's capsule body is 0.27 m in radius (`playerAvatar.ts`), its feet
 *   reach 0.19 m from the centre;
 * - a typical humanoid published character (Mixamo-style, scaled to about 1.35 m) is roughly
 *   0.45-0.55 m across the shoulders at rest, 0.23-0.28 m from the centre (an estimate from
 *   the proportions, not a measurement of every owner upload). Arms swinging in a walk, wings
 *   and held items are deliberately not counted, so the footprint never changes per frame.
 *
 * A 0.35 m radius therefore keeps the visible body out of a wall face with a little margin, and
 * still passes every authored doorway (`playerFootprint.test.ts` walks each one).
 * These are starting values, not objective truths: tune within `PLAYER_COLLISION_LIMITS`.
 *
 * Only the horizontal footprint grows. Height (`bodyHeight`, `stepHeight`) is unchanged, so a
 * barrel, log or platform is exactly as tall to the child as before.
 *
 * Pure: no Three.js, no DOM.
 */
export interface PlayerCollisionConfiguration {
  /** Horizontal radius of the child's body, metres. */
  radius: number;
  /**
   * Extra separation kept between the body and a solid surface, metres: a small tolerance so
   * floating-point contact never shows a sliver of overlap. Added to `radius` when blocking.
   */
  skin: number;
}

export const DEFAULT_PLAYER_COLLISION: Readonly<PlayerCollisionConfiguration> = Object.freeze({
  radius: 0.35,
  skin: 0.02,
});

/** Accepted ranges. The suggested tuning band for the radius is 0.30-0.45 m. */
export const PLAYER_COLLISION_LIMITS = Object.freeze({
  radius: { min: 0.15, max: 0.6 },
  skin: { min: 0, max: 0.1 },
});

type NumericKey = keyof typeof PLAYER_COLLISION_LIMITS;
const NUMERIC_KEYS = Object.keys(PLAYER_COLLISION_LIMITS) as NumericKey[];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** The footprint in force: defaults overridden field by field, each clamped to its range. */
export function resolvePlayerCollision(
  override?: Partial<PlayerCollisionConfiguration> | null,
): PlayerCollisionConfiguration {
  const resolved: PlayerCollisionConfiguration = { ...DEFAULT_PLAYER_COLLISION };
  if (!override) return resolved;
  for (const key of NUMERIC_KEYS) {
    const value = override[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      resolved[key] = clamp(
        value,
        PLAYER_COLLISION_LIMITS[key].min,
        PLAYER_COLLISION_LIMITS[key].max,
      );
    }
  }
  return resolved;
}

export interface PlayerCollisionIssue {
  path: string;
  message: string;
}

/** Every problem with an authored `movement.collision` block. Unknown keys are reported. */
export function validatePlayerCollision(
  value: unknown,
  path = 'movement.collision',
): PlayerCollisionIssue[] {
  if (value === undefined) return [];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return [{ path, message: 'must be an object' }];
  }
  const issues: PlayerCollisionIssue[] = [];
  for (const [key, field] of Object.entries(value as Record<string, unknown>)) {
    const at = `${path}.${key}`;
    if (!(NUMERIC_KEYS as readonly string[]).includes(key)) {
      issues.push({ path: at, message: 'is not a collision setting' });
      continue;
    }
    const limits = PLAYER_COLLISION_LIMITS[key as NumericKey];
    if (typeof field !== 'number' || !Number.isFinite(field)) {
      issues.push({ path: at, message: 'must be a number' });
    } else if (field < limits.min || field > limits.max) {
      issues.push({ path: at, message: `must be between ${limits.min} and ${limits.max}` });
    }
  }
  return issues;
}

/**
 * Horizontal distance from (x, z) to an axis-aligned box's footprint: 0 inside it. Reads the
 * box only; never changes it (colliders are shared with the camera and the scene).
 */
export function footprintDistance(
  box: { min: { x: number; z: number }; max: { x: number; z: number } },
  x: number,
  z: number,
): number {
  const dx = x < box.min.x ? box.min.x - x : x > box.max.x ? x - box.max.x : 0;
  const dz = z < box.min.z ? box.min.z - z : z > box.max.z ? z - box.max.z : 0;
  return Math.hypot(dx, dz);
}
