import type { RegionCheckpoint } from '../discovery/checkpoints';
import type { JsonObject, JsonValue } from '../../api/parse';
import {
  LOCATION_MANIFEST_SCHEMA_VERSION,
  type BoundsSpec,
  type EnvironmentSpec,
  type LocationCopy,
  type NpcPlacementSpec,
  type PropSpec,
  type ScenerySpec,
  type ThreeLocationManifest,
} from '../island-map/three/runtime/locationManifest';
import type { WorldInteraction } from '../island-map/worldObjects';
import type { RegionSceneModel, SceneEntity } from './sceneModel';

/**
 * Turns a server-published region (`RegionSceneModel`, TR-6) into the
 * `ThreeLocationManifest` the existing engine runs (TR-7, decision TR-D15).
 * Pure: the repository validates the result with `validateLocationManifest`
 * before anything renders, exactly as it does a source manifest.
 *
 * How each kind of entity maps, using only the existing asset contract
 * (ADR-030: ids from the bundled catalogue, never URLs):
 *
 * - **NPC with a model**: an `NpcPlacementSpec`, so the runtime's own
 *   approach, focus, and animation apply.
 * - **NPC without a model**: a prop with no `assetId`, which the
 *   `region-play` extension fills with a placeholder figure (the contract's
 *   "absent means an extension draws this one"). Still talks.
 * - **Chest**: always a prop with no `assetId`; the extension draws it from
 *   the child's server state, the catalogue model when there is one and a
 *   built chest when there is not or it fails to load. Its look comes from
 *   Django, never from the interaction.
 * - **Object** (scenery, props, collectibles from admin): non-interactive
 *   scenery in TR-7. With a model, a `MODEL`; without, a `BOX` of the
 *   admin's placeholder size.
 *
 * Every NPC and chest gets one interaction the extension claims, so
 * interacting reaches the play API through the extension and never the
 * generic Amplify panels.
 */

export const REGION_PLAY_EXTENSION_ID = 'region-play';
export const DEFAULT_GROUND_ASSET_ID = 'ground-tile';
const DEFAULT_BOUNDS: BoundsSpec = { halfExtentX: 18, halfExtentZ: 18, wallThickness: 1 };
const DEFAULT_BACKGROUND = 0x9fd8f0;
const NPC_PLACEHOLDER_COLOR = 0x2f8f4e;
const BOX_PLACEHOLDER_COLOR = 0x9a8a78;
const CHECKPOINT_TRIGGER_HALF_SIZE = 1.5;

export const DEFAULT_REGION_COPY = {
  loading: 'Getting this part of the island ready.',
  instructions: 'Look around and walk up to things to see what you can do.',
  altNavLabel: 'Go back to the harbor',
} as const;

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
  kind: 'npc' | 'chest';
  entityId: string;
  npcId: string | null;
}

/** The `region-play` binding's `config`: plain JSON, read back by both extension halves. */
export interface RegionPlayConfig {
  chests: RegionPlayChestConfig[];
  /** NPCs without a model, drawn as placeholder figures. */
  figures: { entityId: string; height: number }[];
  interactions: RegionPlayInteractionConfig[];
}

export interface BuiltRegion {
  manifest: ThreeLocationManifest;
  /** The region's checkpoints for the World State catalogue (`publishRegionCheckpoints`). */
  checkpoints: RegionCheckpoint[];
}

export class RegionBuildError extends Error {
  readonly path: string;
  constructor(path: string, detail: string) {
    super(`${path}: ${detail}`);
    this.name = 'RegionBuildError';
    this.path = path;
  }
}

export interface BuildOptions {
  worldSlug: string;
  /** The clips an asset authors, so an NPC only loops `Idle` where it exists. */
  assetClips?: (assetId: string) => readonly string[];
}

/** Server checkpoint ids are per region; the catalogue's are global, so they are namespaced. */
export function checkpointId(regionId: string, serverCheckpointId: string): string {
  return `${regionId}:${serverCheckpointId}`;
}

export function buildRegionManifest(model: RegionSceneModel, options: BuildOptions): BuiltRegion {
  if (!model.spawn) throw new RegionBuildError('spawn', 'the region has no spawn point');
  const regionId = model.regionId;
  const spawn: RegionCheckpoint = {
    id: checkpointId(regionId, model.spawn.checkpointId),
    regionId,
    label: model.spawn.label,
    x: model.spawn.x,
    z: model.spawn.z,
    yaw: model.spawn.yaw,
  };

  const bounds = readBounds(model.scene.bounds);
  const npcs: NpcPlacementSpec[] = [];
  const props: PropSpec[] = [];
  const scenery: ScenerySpec[] = [ground(regionId, bounds, model.scene.groundAssetId)];
  const interactions: WorldInteraction[] = [];
  const config: RegionPlayConfig = { chests: [], figures: [], interactions: [] };

  for (const entity of model.entities) {
    if (entity.role === 'npc') {
      const interactionId = `${regionId}:talk:${entity.entityId}`;
      const npcId = entity.npcId ?? entity.entityId;
      if (entity.assetId) {
        const clips = options.assetClips?.(entity.assetId) ?? [];
        npcs.push({
          entityId: entity.entityId,
          npcId,
          assetId: entity.assetId,
          position: { x: entity.position.x, z: entity.position.z },
          yaw: entity.rotationY,
          label: entity.label,
          ...(clips.includes('Idle') ? { idleClip: 'Idle' } : {}),
          placeholderColor: NPC_PLACEHOLDER_COLOR,
          interactionId,
        });
      } else {
        props.push(drawnProp(entity, interactionId));
        config.figures.push({ entityId: entity.entityId, height: entity.placeholder.height });
      }
      interactions.push({
        id: interactionId,
        type: 'NPC',
        trigger: 'TAP',
        title: entity.label,
        targetId: entity.entityId,
        action: { kind: 'TALK_TO', npcId },
      });
      config.interactions.push({ interactionId, kind: 'npc', entityId: entity.entityId, npcId });
    } else if (entity.role === 'chest') {
      const interactionId = `${regionId}:chest:${entity.entityId}`;
      props.push(drawnProp(entity, interactionId));
      interactions.push({
        id: interactionId,
        type: 'OBJECT',
        trigger: 'TAP',
        title: entity.label,
        targetId: entity.entityId,
        action: { kind: 'SHOW_MESSAGE', message: entity.label },
      });
      config.chests.push({
        entityId: entity.entityId,
        assetId: entity.assetId,
        openClip: entity.openClip ?? null,
        isOpen: entity.isOpen === true,
        scale: entity.scale,
        placeholder: { ...entity.placeholder },
      });
      config.interactions.push({ interactionId, kind: 'chest', entityId: entity.entityId, npcId: null });
    } else {
      scenery.push(objectScenery(entity));
    }
  }

  const manifest: ThreeLocationManifest = {
    schemaVersion: LOCATION_MANIFEST_SCHEMA_VERSION,
    regionId,
    locationSlug: model.locationSlug,
    worldSlug: options.worldSlug,
    title: model.title,
    version: model.version,
    bounds,
    environment: readEnvironment(model.scene.environment),
    checkpoints: { ids: [spawn.id], triggerHalfSize: CHECKPOINT_TRIGGER_HALF_SIZE },
    colliders: [],
    buildings: [],
    scenery,
    npcs,
    props,
    collectibles: [],
    zones: [],
    ambient: [],
    interactions,
    adventureBindings: [],
    extensions: [{ extensionId: REGION_PLAY_EXTENSION_ID, config: config as unknown as JsonObject }],
    copy: readCopy(model.scene.copy),
  };
  return { manifest, checkpoints: [spawn] };
}

function drawnProp(entity: SceneEntity, interactionId: string): PropSpec {
  return {
    entityId: entity.entityId,
    position: { x: entity.position.x, z: entity.position.z },
    ...(entity.position.elevation ? { elevation: entity.position.elevation } : {}),
    rotationY: entity.rotationY,
    label: entity.label,
    interactionId,
  };
}

function objectScenery(entity: SceneEntity): ScenerySpec {
  const { x, z, elevation } = entity.position;
  if (entity.assetId) {
    return {
      kind: 'MODEL',
      id: entity.entityId,
      assetId: entity.assetId,
      position: { x, y: elevation, z },
      rotation: { x: 0, y: entity.rotationY, z: 0 },
      scale: { x: entity.scale, y: entity.scale, z: entity.scale },
    };
  }
  const halfWidth = (entity.placeholder.width * entity.scale) / 2;
  const halfDepth = (entity.placeholder.depth * entity.scale) / 2;
  return {
    kind: 'BOX',
    id: entity.entityId,
    color: BOX_PLACEHOLDER_COLOR,
    area: {
      id: `${entity.entityId}:area`,
      minX: x - halfWidth,
      maxX: x + halfWidth,
      minZ: z - halfDepth,
      maxZ: z + halfDepth,
    },
    minY: elevation,
    maxY: elevation + entity.placeholder.height * entity.scale,
  };
}

function ground(regionId: string, bounds: BoundsSpec, groundAssetId: JsonValue | undefined): ScenerySpec {
  return {
    kind: 'TILED_GROUND',
    id: `${regionId}:ground`,
    assetId: typeof groundAssetId === 'string' && groundAssetId ? groundAssetId : DEFAULT_GROUND_ASSET_ID,
    area: {
      id: `${regionId}:ground:area`,
      minX: -bounds.halfExtentX,
      maxX: bounds.halfExtentX,
      minZ: -bounds.halfExtentZ,
      maxZ: bounds.halfExtentZ,
    },
    tileSize: 4,
    coverage: 'COVER',
  };
}

function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function positiveNumber(value: JsonValue | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function readBounds(value: JsonValue | undefined): BoundsSpec {
  if (!isObject(value)) return { ...DEFAULT_BOUNDS };
  return {
    halfExtentX: positiveNumber(value.halfExtentX, DEFAULT_BOUNDS.halfExtentX),
    halfExtentZ: positiveNumber(value.halfExtentZ, DEFAULT_BOUNDS.halfExtentZ),
    wallThickness: positiveNumber(value.wallThickness, DEFAULT_BOUNDS.wallThickness),
  };
}

function readEnvironment(value: JsonValue | undefined): EnvironmentSpec {
  const background =
    isObject(value) && typeof value.backgroundColor === 'number' && Number.isInteger(value.backgroundColor)
      ? value.backgroundColor
      : DEFAULT_BACKGROUND;
  return { backgroundColor: background };
}

function text(value: JsonValue | undefined, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function readCopy(value: JsonValue | undefined): LocationCopy {
  const copy = isObject(value) ? value : {};
  const calmStop = typeof copy.calmStop === 'string' && copy.calmStop.trim() ? copy.calmStop : undefined;
  return {
    loading: text(copy.loading, DEFAULT_REGION_COPY.loading),
    instructions: text(copy.instructions, DEFAULT_REGION_COPY.instructions),
    ...(calmStop ? { calmStop } : {}),
    altNav: { label: text(copy.altNavLabel, DEFAULT_REGION_COPY.altNavLabel), to: '' },
  };
}
