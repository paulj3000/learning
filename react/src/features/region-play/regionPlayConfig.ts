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
  /** `launch`: an object that starts one of the Place's Adventures (ADR-041). */
  kind: 'npc' | 'chest' | 'launch';
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

export interface RegionPlayConfig {
  chests: RegionPlayChestConfig[];
  /** NPCs without a model, drawn as placeholder figures. */
  figures: { entityId: string; height: number }[];
  interactions: RegionPlayInteractionConfig[];
  /** Scenery drawn from primitives (TR-13). Absent in configs built before it. */
  procedural?: RegionPlayProceduralConfig[];
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

function interaction(item: JsonRecord): RegionPlayInteractionConfig | undefined {
  const interactionId = text(item.interactionId);
  const entityId = text(item.entityId);
  const kind = item.kind;
  if (!interactionId || !entityId || (kind !== 'npc' && kind !== 'chest' && kind !== 'launch')) {
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
  if (!chests || !figures || !interactions || !procedural) return null;
  return { chests, figures, interactions, procedural };
}
