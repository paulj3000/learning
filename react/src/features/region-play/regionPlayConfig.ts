import type { JsonValue } from '../island-map/three/runtime/locationManifest';

/** The region-play extension's id (TR-7). Here, not in `regionManifest.ts`, so the engine-side
 * scene can import it without reaching the API types that module parses (LAI-0203). */
export const REGION_PLAY_EXTENSION_ID = 'region-play';

export interface RegionPlayChestConfig {
  entityId: string;
  assetId: string | null;
  openClip: string | null;
  isOpen: boolean;
  scale: number;
  placeholder: { width: number; height: number; depth: number };
  /**
   * TR-14. A `PUZZLE` draws no chest; a `HIDDEN` chest is not drawn while locked by progress.
   * TR-20: a `REPLAY` activity (the Lookout spyglass) draws no chest and never opens.
   */
  presentation?: 'CHEST' | 'HIDDEN' | 'PUZZLE' | 'REPLAY';
  /** Why it is locked at build time; the companion updates it from server state after. */
  lockReason?: 'PROGRESS' | 'ITEM' | null;
}

/** A collectible the child picks up through the play API (TR-14), drawn by the extension. */
export interface RegionPlayPickupConfig {
  entityId: string;
}

/** An object that answers a puzzle by being touched (TR-14): choice `index` of `puzzleEntityId`. */
export interface RegionPlayRuneConfig {
  entityId: string;
  puzzleEntityId: string;
  index: number;
}

export interface RegionPlayInteractionConfig {
  interactionId: string;
  /**
   * `launch`: an object that starts one of the Place's Adventures (ADR-041). `pickup` and
   * `rune`: a collectible to pick up and a puzzle answer to touch (TR-14).
   */
  kind: 'npc' | 'chest' | 'launch' | 'pickup' | 'rune';
  entityId: string;
  npcId: string | null;
}

/** The `region-play` binding's `config`: plain JSON, read back by both extension halves. */
/**
 * The procedural placeholders the scene extension draws from primitives
 * (TR-13), for scenery the bundled catalogue has no model for yet. Each is
 * listed with the asset that should replace it in
 * `docs/TREASURE_RUSH_ASSET_REQUIREMENTS.md`.
 */
export const PROCEDURAL_SHAPES = [
  'PALM',
  'TENT',
  'CAMPFIRE',
  'TORCH',
  'FLAG',
  'ROWBOAT',
  'PILLAR',
  'PEDESTAL',
  'GATE',
  // TR-17 and TR-20: the way to Lookout Point and what stands there.
  'BROKEN_PLANKS',
  'BRIDGE',
  'LANTERNS',
  'SPYGLASS',
] as const;
export type ProceduralShape = (typeof PROCEDURAL_SHAPES)[number];

export interface RegionPlayProceduralConfig {
  id: string;
  shape: ProceduralShape;
  x: number;
  z: number;
  rotationY?: number;
  /** Overall height in metres, for shapes that vary (palms, flags, pillars). */
  height?: number;
  /** 24-bit tint for the main surface (a flag's cloth, a tent's canvas), where it has one. */
  color?: number;
}

/**
 * What the quest's completion opens (TR-17): the world change Django records, and the pieces
 * of the scene that change with it. The scene only draws it; whether the child may use what is
 * beyond (the Lookout spyglass) is Django's, through the chest's lock.
 */
export interface RegionPlayUnlockConfig {
  /** The world change that opens the way, e.g. `TREASURE_COVE_QUEST_COMPLETE`. */
  changeKey: string;
  /** Whether the child already has it, at build time; the companion tells the scene later. */
  unlocked: boolean;
  /** Collider ids taken out when it opens (the gate, the closed channel). */
  openColliders: string[];
  /** Procedural ids shown only once it is open (the bridge). */
  showWhenOpen: string[];
  /** Procedural ids hidden once it is open (the sinking planks). */
  hideWhenOpen: string[];
  /** Procedural gates whose bars lift when it opens. */
  liftGates: string[];
}

/** A drifting cloud of lights (TR-18), around `x`, `z`. Decoration only. */
export interface RegionPlayFirefliesConfig {
  id: string;
  x: number;
  z: number;
  radius: number;
  height: number;
  count: number;
}

/** The living-cove extras (TR-18): scenery ids that shimmer, and the fireflies. */
export interface RegionPlayAmbienceConfig {
  water: string[];
  fireflies: RegionPlayFirefliesConfig[];
}

export interface RegionPlayConfig {
  chests: RegionPlayChestConfig[];
  /** NPCs without a model, drawn as placeholder figures. */
  figures: { entityId: string; height: number }[];
  interactions: RegionPlayInteractionConfig[];
  /** Scenery drawn from primitives (TR-13). Absent in configs built before it. */
  procedural?: RegionPlayProceduralConfig[];
  /** TR-14. Absent in configs built before it. */
  pickups?: RegionPlayPickupConfig[];
  runes?: RegionPlayRuneConfig[];
  /** TR-17. Absent in configs built before it. */
  unlock?: RegionPlayUnlockConfig;
  /** TR-18. Absent in configs built before it. */
  ambience?: RegionPlayAmbienceConfig;
}

/**
 * The `region-play` binding's config, parsed rather than trusted, as every
 * extension reads its own (`sanctuaryArtConfig.ts`). `buildRegionManifest`
 * writes it; both extension halves read it back here. Returns null for
 * anything malformed, so a bad binding draws and claims nothing.
 */

type JsonRecord = { readonly [key: string]: JsonValue };

function record(value: JsonValue | undefined): JsonRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function text(value: JsonValue | undefined): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function num(value: JsonValue | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function list<T>(
  value: JsonValue | undefined,
  read: (item: JsonRecord) => T | undefined,
): T[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: T[] = [];
  for (const item of value) {
    const entry = record(item);
    const parsed = entry ? read(entry) : undefined;
    if (parsed === undefined) return undefined;
    out.push(parsed);
  }
  return out;
}

function chest(item: JsonRecord): RegionPlayChestConfig | undefined {
  const entityId = text(item.entityId);
  const placeholder = record(item.placeholder);
  const width = num(placeholder?.width);
  const height = num(placeholder?.height);
  const depth = num(placeholder?.depth);
  const scale = num(item.scale);
  if (
    !entityId ||
    width === undefined ||
    height === undefined ||
    depth === undefined ||
    scale === undefined
  ) {
    return undefined;
  }
  if (typeof item.isOpen !== 'boolean') return undefined;
  return {
    entityId,
    assetId: text(item.assetId) ?? null,
    openClip: text(item.openClip) ?? null,
    isOpen: item.isOpen,
    scale,
    placeholder: { width, height, depth },
    ...(item.presentation === 'HIDDEN' ||
    item.presentation === 'PUZZLE' ||
    item.presentation === 'REPLAY'
      ? { presentation: item.presentation }
      : {}),
    ...(item.lockReason === 'PROGRESS' || item.lockReason === 'ITEM'
      ? { lockReason: item.lockReason }
      : {}),
  };
}

function interaction(item: JsonRecord): RegionPlayInteractionConfig | undefined {
  const interactionId = text(item.interactionId);
  const entityId = text(item.entityId);
  const kind = item.kind;
  if (
    !interactionId ||
    !entityId ||
    (kind !== 'npc' &&
      kind !== 'chest' &&
      kind !== 'launch' &&
      kind !== 'pickup' &&
      kind !== 'rune')
  ) {
    return undefined;
  }
  return { interactionId, kind, entityId, npcId: text(item.npcId) ?? null };
}

function proceduralEntry(item: JsonRecord): RegionPlayProceduralConfig | undefined {
  const id = text(item.id);
  const shape = item.shape;
  const x = num(item.x);
  const z = num(item.z);
  if (!id || x === undefined || z === undefined) return undefined;
  if (typeof shape !== 'string' || !(PROCEDURAL_SHAPES as readonly string[]).includes(shape)) {
    return undefined;
  }
  const rotationY = num(item.rotationY);
  const height = num(item.height);
  const color = num(item.color);
  return {
    id,
    shape: shape as ProceduralShape,
    x,
    z,
    ...(rotationY !== undefined ? { rotationY } : {}),
    ...(height !== undefined && height > 0 ? { height } : {}),
    ...(color !== undefined && Number.isInteger(color) && color >= 0 && color <= 0xffffff
      ? { color }
      : {}),
  };
}

function textList(value: JsonValue | undefined): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: string[] = [];
  for (const item of value) {
    const entry = text(item);
    if (entry === undefined) return undefined;
    out.push(entry);
  }
  return out;
}

function unlockConfig(value: JsonValue | undefined): RegionPlayUnlockConfig | null | undefined {
  if (value === undefined) return undefined;
  const fields = record(value);
  if (!fields) return null;
  const changeKey = text(fields.changeKey);
  const openColliders = textList(fields.openColliders);
  const showWhenOpen = textList(fields.showWhenOpen);
  const hideWhenOpen = textList(fields.hideWhenOpen);
  const liftGates = textList(fields.liftGates);
  if (
    !changeKey ||
    typeof fields.unlocked !== 'boolean' ||
    !openColliders ||
    !showWhenOpen ||
    !hideWhenOpen ||
    !liftGates
  ) {
    return null;
  }
  return {
    changeKey,
    unlocked: fields.unlocked,
    openColliders,
    showWhenOpen,
    hideWhenOpen,
    liftGates,
  };
}

function ambienceConfig(value: JsonValue | undefined): RegionPlayAmbienceConfig | null | undefined {
  if (value === undefined) return undefined;
  const fields = record(value);
  if (!fields) return null;
  const water = textList(fields.water);
  const fireflies = list(fields.fireflies, (item) => {
    const id = text(item.id);
    const x = num(item.x);
    const z = num(item.z);
    const radius = num(item.radius);
    const height = num(item.height);
    const count = num(item.count);
    return id &&
      x !== undefined &&
      z !== undefined &&
      radius !== undefined &&
      radius > 0 &&
      height !== undefined &&
      count !== undefined &&
      Number.isInteger(count) &&
      count > 0 &&
      count <= MAX_FIREFLIES
      ? { id, x, z, radius, height, count }
      : undefined;
  });
  return water && fireflies ? { water, fireflies } : null;
}

/** A cloud is one draw call, but a typo of a million should not reach the GPU. */
export const MAX_FIREFLIES = 200;

export function tryParseRegionPlayConfig(config: JsonRecord): RegionPlayConfig | null {
  const chests = list(config.chests, chest);
  const figures = list(config.figures, (item) => {
    const entityId = text(item.entityId);
    const height = num(item.height);
    return entityId && height !== undefined ? { entityId, height } : undefined;
  });
  const interactions = list(config.interactions, interaction);
  const procedural =
    config.procedural === undefined ? [] : list(config.procedural, proceduralEntry);
  const pickups =
    config.pickups === undefined
      ? []
      : list(config.pickups, (item) => {
          const entityId = text(item.entityId);
          return entityId ? { entityId } : undefined;
        });
  const runes =
    config.runes === undefined
      ? []
      : list(config.runes, (item) => {
          const entityId = text(item.entityId);
          const puzzleEntityId = text(item.puzzleEntityId);
          const index = num(item.index);
          return entityId && puzzleEntityId && index !== undefined && Number.isInteger(index)
            ? { entityId, puzzleEntityId, index }
            : undefined;
        });
  const unlock = unlockConfig(config.unlock);
  const ambience = ambienceConfig(config.ambience);
  if (!chests || !figures || !interactions || !procedural || !pickups || !runes) return null;
  if (unlock === null || ambience === null) return null;
  return {
    chests,
    figures,
    interactions,
    procedural,
    pickups,
    runes,
    ...(unlock ? { unlock } : {}),
    ...(ambience ? { ambience } : {}),
  };
}
