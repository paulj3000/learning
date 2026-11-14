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
   * `puzzle`: an object a 3D Area puzzle uses (ADR-047 F). `return`: a safe way back (FP-D10).
   */
  kind: 'npc' | 'chest' | 'launch' | 'pickup' | 'rune' | 'puzzle' | 'return';
  entityId: string;
  npcId: string | null;
}

/** How a stand-in is drawn while its model is not published (Firepeak FP-3). */
export const STAND_IN_SHAPES = [
  'BOX',
  'TENT',
  'TELESCOPE',
  'PIPE',
  'PEDESTAL',
  'CRYSTAL',
  'PORTAL',
  'STONE',
  'VALVE',
  'MARKER',
  'FIGURE',
] as const;
export type StandInShape = (typeof STAND_IN_SHAPES)[number];

/**
 * An entity the extension draws: a stand-in shape now, and the published model instead once one
 * can be delivered (`assetId`), with no code change (ADR-035, FP-3).
 */
export interface RegionPlayDrawnConfig {
  entityId: string;
  shape: StandInShape;
  color: number;
  /** The model to load, when one can be delivered; otherwise the stand-in stays. */
  assetId: string | null;
  scale: number;
  size: { width: number; height: number; depth: number };
}

export interface Rect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface LavaConfig extends Rect {
  id: string;
  /** Parts that are safe to stand on once their change key exists (a repaired crossing). */
  safe: (Rect & { whenChangeKey: string })[];
}

export interface SteamConfig {
  id: string;
  x: number;
  z: number;
  height: number;
  hiddenWhenChangeKey: string | null;
  shownWhenChangeKey: string | null;
}

export interface CheckpointConfig {
  id: string;
  label: string;
  x: number;
  z: number;
  yaw: number;
  /** Open (a place to return to) once this key exists; absent means always. */
  whenChangeKey: string | null;
}

export interface RegionPlayEffects {
  lava: LavaConfig[];
  steam: SteamConfig[];
  checkpoints: CheckpointConfig[];
  openings: { colliderId: string; whenChangeKey: string }[];
  returns: { entityId: string; toCheckpoint: string; whenChangeKey: string; label: string }[];
  backdrop: { assetId: string | null; x: number; z: number; radius: number; height: number } | null;
}

export const NO_EFFECTS: RegionPlayEffects = {
  lava: [],
  steam: [],
  checkpoints: [],
  openings: [],
  returns: [],
  backdrop: null,
};

/** A puzzle as the scene needs it: which objects, and whether it is already solved. */
export interface RegionPlayPuzzleConfig {
  puzzleId: string;
  kind: string;
  entityIds: string[];
  solved: boolean;
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
  /**
   * TR-PALM-05: an asset library model that replaces the primitive, drawn at `height` (a palm's
   * overall height) and `rotationY`. The primitive stays the fallback while nothing is
   * published or the model fails to load. Only palms use it today.
   */
  assetId?: string;
}

/**
 * A static environment prop drawn from an asset library model (TR-ENV-06): a barrel, a log, a wood
 * pile. Instanced per model like the palms. Its `colliders` are added only once its model is
 * drawn, so a prop that never loads leaves no invisible wall.
 */
export interface RegionPlayPropConfig {
  id: string;
  assetId: string;
  x: number;
  z: number;
  rotationY?: number;
  /** A turn about the model's own Z before `rotationY`: a barrel lying on its side. */
  rotationZ?: number;
  scale?: number;
  /** Ground rectangles, axis-aligned, that make it solid (layout authored, footprint sized). */
  colliders: { id: string; minX: number; maxX: number; minZ: number; maxZ: number }[];
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
  /** Entities drawn by the extension (stand-ins, puzzle objects). Empty for older regions. */
  drawn: RegionPlayDrawnConfig[];
  puzzles: RegionPlayPuzzleConfig[];
  effects: RegionPlayEffects;
  /** The child's world change keys in this Place when the scene was built (Django's). */
  changeKeys: string[];
  /** Scenery drawn from primitives (TR-13). Absent in configs built before it. */
  procedural?: RegionPlayProceduralConfig[];
  /** TR-ENV-06: barrels and logs from the asset library. */
  props?: RegionPlayPropConfig[];
  /** TR-ENV-06: the scenery ids each prop model hides once it is drawn (the bundled stand-ins). */
  propReplaces?: { [assetId: string]: string[] };
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

const INTERACTION_KINDS = ['npc', 'chest', 'launch', 'pickup', 'rune', 'puzzle', 'return'] as const;

function interaction(item: JsonRecord): RegionPlayInteractionConfig | undefined {
  const interactionId = text(item.interactionId);
  const entityId = text(item.entityId);
  const kind = INTERACTION_KINDS.find((candidate) => candidate === item.kind);
  if (!interactionId || !entityId || !kind) return undefined;
  return { interactionId, kind, entityId, npcId: text(item.npcId) ?? null };
}

function rect(item: JsonRecord): Rect | undefined {
  const minX = num(item.minX);
  const maxX = num(item.maxX);
  const minZ = num(item.minZ);
  const maxZ = num(item.maxZ);
  if (minX === undefined || maxX === undefined || minZ === undefined || maxZ === undefined) {
    return undefined;
  }
  return minX < maxX && minZ < maxZ ? { minX, maxX, minZ, maxZ } : undefined;
}

function drawn(item: JsonRecord): RegionPlayDrawnConfig | undefined {
  const entityId = text(item.entityId);
  const shape = STAND_IN_SHAPES.find((candidate) => candidate === item.shape);
  const color = num(item.color);
  const scale = num(item.scale);
  const size = record(item.size);
  const width = num(size?.width);
  const height = num(size?.height);
  const depth = num(size?.depth);
  if (!entityId || !shape || color === undefined || scale === undefined) return undefined;
  if (width === undefined || height === undefined || depth === undefined) return undefined;
  return {
    entityId,
    shape,
    color,
    assetId: text(item.assetId) ?? null,
    scale,
    size: { width, height, depth },
  };
}

/** Effects are optional and forgiving: an unreadable entry is dropped, never the region. */
export function parseEffects(value: JsonValue | undefined): RegionPlayEffects {
  const effects = record(value);
  if (!effects) return NO_EFFECTS;
  const items = (key: string): JsonRecord[] => {
    const raw = effects[key];
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((entry) => {
      const parsed = record(entry);
      return parsed ? [parsed] : [];
    });
  };
  const keyOf = (entry: JsonRecord, key: string) => text(entry[key]) ?? null;
  const backdrop = record(effects.backdrop);
  return {
    lava: items('lava').flatMap((entry) => {
      const id = text(entry.id);
      const area = rect(entry);
      if (!id || !area) return [];
      const safe = (Array.isArray(entry.safe) ? entry.safe : []).flatMap((raw) => {
        const part = record(raw);
        const zone = part ? rect(part) : undefined;
        const when = part ? text(part.whenChangeKey) : undefined;
        return zone && when ? [{ ...zone, whenChangeKey: when }] : [];
      });
      return [{ id, ...area, safe }];
    }),
    steam: items('steam').flatMap((entry) => {
      const id = text(entry.id);
      const x = num(entry.x);
      const z = num(entry.z);
      const height = num(entry.height);
      if (!id || x === undefined || z === undefined || height === undefined) return [];
      return [
        {
          id,
          x,
          z,
          height,
          hiddenWhenChangeKey: keyOf(entry, 'hiddenWhenChangeKey'),
          shownWhenChangeKey: keyOf(entry, 'shownWhenChangeKey'),
        },
      ];
    }),
    checkpoints: items('checkpoints').flatMap((entry) => {
      const id = text(entry.id);
      const label = text(entry.label);
      const x = num(entry.x);
      const z = num(entry.z);
      if (!id || !label || x === undefined || z === undefined) return [];
      return [
        { id, label, x, z, yaw: num(entry.yaw) ?? 0, whenChangeKey: keyOf(entry, 'whenChangeKey') },
      ];
    }),
    openings: items('openings').flatMap((entry) => {
      const colliderId = text(entry.colliderId);
      const whenChangeKey = text(entry.whenChangeKey);
      return colliderId && whenChangeKey ? [{ colliderId, whenChangeKey }] : [];
    }),
    returns: items('returns').flatMap((entry) => {
      const entityId = text(entry.entityId);
      const toCheckpoint = text(entry.toCheckpoint);
      const whenChangeKey = text(entry.whenChangeKey);
      const label = text(entry.label);
      return entityId && toCheckpoint && whenChangeKey && label
        ? [{ entityId, toCheckpoint, whenChangeKey, label }]
        : [];
    }),
    backdrop: (() => {
      if (!backdrop) return null;
      const x = num(backdrop.x);
      const z = num(backdrop.z);
      const radius = num(backdrop.radius);
      const height = num(backdrop.height);
      if (x === undefined || z === undefined || radius === undefined || height === undefined) {
        return null;
      }
      return { assetId: text(backdrop.assetId) ?? null, x, z, radius, height };
    })(),
  };
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
  const assetId = text(item.assetId);
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
    ...(assetId !== undefined ? { assetId } : {}),
  };
}

function propEntry(item: JsonRecord): RegionPlayPropConfig | undefined {
  const id = text(item.id);
  const assetId = text(item.assetId);
  const x = num(item.x);
  const z = num(item.z);
  if (!id || !assetId || x === undefined || z === undefined) return undefined;
  const colliders = list(item.colliders, (rect) => {
    const rectId = text(rect.id);
    const minX = num(rect.minX);
    const maxX = num(rect.maxX);
    const minZ = num(rect.minZ);
    const maxZ = num(rect.maxZ);
    if (!rectId || minX === undefined || maxX === undefined) return undefined;
    if (minZ === undefined || maxZ === undefined || !(minX < maxX && minZ < maxZ)) return undefined;
    return { id: rectId, minX, maxX, minZ, maxZ };
  });
  if (!colliders) return undefined;
  const rotationY = num(item.rotationY);
  const rotationZ = num(item.rotationZ);
  const scale = num(item.scale);
  if (scale !== undefined && !(scale > 0)) return undefined;
  return {
    id,
    assetId,
    x,
    z,
    ...(rotationY !== undefined ? { rotationY } : {}),
    ...(rotationZ !== undefined ? { rotationZ } : {}),
    ...(scale !== undefined ? { scale } : {}),
    colliders,
  };
}

function propReplacesConfig(
  value: JsonValue | undefined,
): { [assetId: string]: string[] } | undefined | null {
  if (value === undefined) return undefined;
  const fields = record(value);
  if (!fields) return null;
  const out: { [assetId: string]: string[] } = {};
  for (const [assetId, ids] of Object.entries(fields)) {
    const parsed = textList(ids);
    if (!parsed) return null;
    out[assetId] = parsed;
  }
  return out;
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
  if (!chests || !figures || !interactions) return null;
  // Added for ADR-047 / Firepeak; absent in a config built before them.
  const drawnEntities = config.drawn === undefined ? [] : list(config.drawn, drawn);
  const puzzles =
    config.puzzles === undefined
      ? []
      : list(config.puzzles, (item) => {
          const puzzleId = text(item.puzzleId);
          const kind = text(item.kind);
          const entityIds = Array.isArray(item.entityIds)
            ? item.entityIds.filter((id): id is string => typeof id === 'string')
            : undefined;
          return puzzleId && kind && entityIds && typeof item.solved === 'boolean'
            ? { puzzleId, kind, entityIds, solved: item.solved }
            : undefined;
        });
  const changeKeys = Array.isArray(config.changeKeys)
    ? config.changeKeys.filter((key): key is string => typeof key === 'string')
    : [];
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
  const props = config.props === undefined ? [] : list(config.props, propEntry);
  const propReplaces = propReplacesConfig(config.propReplaces);
  if (!procedural || !pickups || !runes || !drawnEntities || !puzzles || !props) return null;
  if (unlock === null || ambience === null || propReplaces === null) return null;
  return {
    chests,
    figures,
    interactions,
    drawn: drawnEntities,
    puzzles,
    effects: parseEffects(config.effects),
    changeKeys,
    procedural,
    pickups,
    runes,
    ...(props.length > 0 ? { props } : {}),
    ...(propReplaces ? { propReplaces } : {}),
    ...(unlock ? { unlock } : {}),
    ...(ambience ? { ambience } : {}),
  };
}
