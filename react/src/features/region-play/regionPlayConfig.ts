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
}

export interface RegionPlayInteractionConfig {
  interactionId: string;
  /**
   * `launch`: an object that starts one of the Place's Adventures (ADR-041).
   * `puzzle`: an object a 3D Area puzzle uses (ADR-043 F). `return`: a safe way back (FP-D10).
   */
  kind: 'npc' | 'chest' | 'launch' | 'puzzle' | 'return';
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
  };
}

const INTERACTION_KINDS = ['npc', 'chest', 'launch', 'puzzle', 'return'] as const;

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

export function tryParseRegionPlayConfig(config: JsonRecord): RegionPlayConfig | null {
  const chests = list(config.chests, chest);
  const figures = list(config.figures, (item) => {
    const entityId = text(item.entityId);
    const height = num(item.height);
    return entityId && height !== undefined ? { entityId, height } : undefined;
  });
  const interactions = list(config.interactions, interaction);
  if (!chests || !figures || !interactions) return null;
  // Added for ADR-043 / Firepeak; absent in a config built before them.
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
  if (!drawnEntities || !puzzles) return null;
  return {
    chests,
    figures,
    interactions,
    drawn: drawnEntities,
    puzzles,
    effects: parseEffects(config.effects),
    changeKeys,
  };
}
