import type { JsonValue } from '../../runtime/locationManifest';

/**
 * The `castle-tale` extension's config: everything Storykeeper Castle's
 * bespoke half needs that the manifest cannot say, parsed rather than
 * trusted (the Phase 7 rule for extension config).
 *
 * Every position here is for something the extension *draws* - a state
 * variant that flips mid-visit, or a layer of the easel's picture. Anything
 * static is manifest scenery, and anything a child can aim at is a manifest
 * prop whose root this fills in.
 */
export interface CastleVariantPair {
  entityId: string;
  plain: string;
  lit: string;
}

export interface CastleWindow extends CastleVariantPair {
  x: number;
  z: number;
  yaw: number;
}

export interface CastleTaleConfig {
  /** The world change that means a story has been told here. */
  storyToldChangeKey: string;
  quillEntityId: string;
  /** The interaction that opens the tale in the room, and the one that opens the arc. */
  taleInteractionId: string;
  storyInteractionId: string;
  /** The scenery item that stirs in the draught - the castle's one unmarked secret. */
  swayingTapestrySceneryId: string;
  hearth: { x: number; z: number };
  /** The carpet's second run, which appears once the story is told. */
  carpetExtension: readonly { x: number; y: number; z: number; rotationY: number }[];
  shelfSlot: { x: number; y: number; z: number; yaw: number };
  lastBookshelf: { x: number; z: number; yaw: number };
  wornCarving: { x: number; y: number; z: number; yaw: number };
  secretDoor: { yaw: number };
  portraits: readonly CastleVariantPair[];
  windows: readonly CastleWindow[];
  easel: { x: number; z: number; yaw: number };
}

function text(value: JsonValue | undefined): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function num(value: JsonValue | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function record(value: JsonValue | undefined): { readonly [key: string]: JsonValue } | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as { readonly [key: string]: JsonValue })
    : undefined;
}

function spot(value: JsonValue | undefined): { x: number; z: number } | undefined {
  const at = record(value);
  const x = num(at?.x);
  const z = num(at?.z);
  return x === undefined || z === undefined ? undefined : { x, z };
}

function mounted(
  value: JsonValue | undefined,
): { x: number; y: number; z: number; yaw: number } | undefined {
  const at = record(value);
  const x = num(at?.x);
  const y = num(at?.y);
  const z = num(at?.z);
  const yaw = num(at?.yaw);
  if (x === undefined || y === undefined || z === undefined || yaw === undefined) return undefined;
  return { x, y, z, yaw };
}

function variantPair(value: JsonValue | undefined): CastleVariantPair | undefined {
  const pair = record(value);
  const entityId = text(pair?.entityId);
  const plain = text(pair?.plain);
  const lit = text(pair?.lit);
  return entityId && plain && lit ? { entityId, plain, lit } : undefined;
}

/** Parses config, or `null` so the runtime skips a broken binding with a warning. */
export function tryParseCastleTaleConfig(config: {
  readonly [key: string]: JsonValue;
}): CastleTaleConfig | null {
  const storyToldChangeKey = text(config.storyToldChangeKey);
  const quillEntityId = text(config.quillEntityId);
  const taleInteractionId = text(config.taleInteractionId);
  const storyInteractionId = text(config.storyInteractionId);
  const swayingTapestrySceneryId = text(config.swayingTapestrySceneryId);
  const hearth = spot(config.hearth);
  const shelfSlot = mounted(config.shelfSlot);
  const wornCarving = mounted(config.wornCarving);
  const lastBookshelfAt = record(config.lastBookshelf);
  const lastBookshelfSpot = spot(config.lastBookshelf);
  const lastBookshelfYaw = num(lastBookshelfAt?.yaw);
  const secretDoorYaw = num(record(config.secretDoor)?.yaw);
  const easelAt = spot(config.easel);
  const easelYaw = num(record(config.easel)?.yaw);
  if (!storyToldChangeKey || !quillEntityId || !taleInteractionId || !storyInteractionId) {
    return null;
  }
  if (!swayingTapestrySceneryId || !hearth || !shelfSlot || !wornCarving) return null;
  if (!lastBookshelfSpot || lastBookshelfYaw === undefined) return null;
  if (secretDoorYaw === undefined || !easelAt || easelYaw === undefined) return null;

  const carpetExtension: CastleTaleConfig['carpetExtension'][number][] = [];
  for (const entry of Array.isArray(config.carpetExtension) ? config.carpetExtension : []) {
    const tile = record(entry);
    const x = num(tile?.x);
    const y = num(tile?.y);
    const z = num(tile?.z);
    const rotationY = num(tile?.rotationY);
    if (x === undefined || y === undefined || z === undefined || rotationY === undefined) {
      return null;
    }
    carpetExtension.push({ x, y, z, rotationY });
  }

  const portraits: CastleVariantPair[] = [];
  for (const entry of Array.isArray(config.portraits) ? config.portraits : []) {
    const pair = variantPair(entry);
    if (!pair) return null;
    portraits.push(pair);
  }

  const windows: CastleWindow[] = [];
  for (const entry of Array.isArray(config.windows) ? config.windows : []) {
    const pair = variantPair(entry);
    const at = spot(entry);
    const yaw = num(record(entry)?.yaw);
    if (!pair || !at || yaw === undefined) return null;
    windows.push({ ...pair, ...at, yaw });
  }

  return {
    storyToldChangeKey,
    quillEntityId,
    taleInteractionId,
    storyInteractionId,
    swayingTapestrySceneryId,
    hearth,
    carpetExtension,
    shelfSlot,
    lastBookshelf: { ...lastBookshelfSpot, yaw: lastBookshelfYaw },
    wornCarving,
    secretDoor: { yaw: secretDoorYaw },
    portraits,
    windows,
    easel: { ...easelAt, yaw: easelYaw },
  };
}
