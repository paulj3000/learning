import type { JsonValue } from '../island-map/three/runtime/locationManifest';
import type { RegionPlayChestConfig, RegionPlayConfig, RegionPlayInteractionConfig } from './regionManifest';

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

function list<T>(value: JsonValue | undefined, read: (item: JsonRecord) => T | undefined): T[] | undefined {
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
  if (!entityId || width === undefined || height === undefined || depth === undefined || scale === undefined) {
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
  if (!interactionId || !entityId || (kind !== 'npc' && kind !== 'chest')) return undefined;
  return { interactionId, kind, entityId, npcId: text(item.npcId) ?? null };
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
  return { chests, figures, interactions };
}
