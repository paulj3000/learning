/**
 * A staff-configured collision profile, as the asset resolver sends it (`collision` on an
 * answer; Django `apps/assets/collision.py`, `docs/ASSET_COLLISION_PROFILES.md`).
 *
 * Every box is axis-aligned in the model's own space, metres, before a placement's position,
 * rotation and scale: the only shape the movement controller has. Django has already turned
 * cylinders, capsules and compound shapes into boxes. An empty `boxes` list is deliberate: the
 * piece never blocks, and the runtime must not put its built-in default back.
 */

export type CollisionBehavior = 'SOLID' | 'JUMPABLE' | 'WALKABLE' | 'DECORATIVE';

export interface ModelBox {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

export interface CollisionProfile {
  behavior: CollisionBehavior;
  shape: string;
  boxes: readonly ModelBox[];
}

export type CollisionProfiles = ReadonlyMap<string, CollisionProfile>;

const BEHAVIORS: readonly CollisionBehavior[] = ['SOLID', 'JUMPABLE', 'WALKABLE', 'DECORATIVE'];
const MAX_BOXES = 32;
const MAX_EXTENT = 200;
const KEYS = ['minX', 'minY', 'minZ', 'maxX', 'maxY', 'maxZ'] as const;

/** A resolver answer's `collision`, validated; `undefined` for anything malformed or absent. */
export function parseCollisionProfile(raw: unknown): CollisionProfile | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const { behavior, shape, boxes } = raw as Record<string, unknown>;
  if (typeof behavior !== 'string' || !(BEHAVIORS as readonly string[]).includes(behavior)) {
    return undefined;
  }
  if (!Array.isArray(boxes) || boxes.length > MAX_BOXES) return undefined;
  const parsed: ModelBox[] = [];
  for (const box of boxes) {
    if (typeof box !== 'object' || box === null) return undefined;
    const values = box as Record<string, unknown>;
    if (!KEYS.every((key) => isFiniteWithin(values[key]))) return undefined;
    const out = Object.fromEntries(KEYS.map((key) => [key, values[key] as number])) as unknown as ModelBox;
    if (out.maxX <= out.minX || out.maxY <= out.minY || out.maxZ <= out.minZ) return undefined;
    parsed.push(out);
  }
  const quiet = behavior === 'WALKABLE' || behavior === 'DECORATIVE';
  return {
    behavior: behavior as CollisionBehavior,
    shape: typeof shape === 'string' ? shape.slice(0, 16) : 'BOX',
    boxes: quiet ? [] : parsed,
  };
}

function isFiniteWithin(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= MAX_EXTENT;
}
