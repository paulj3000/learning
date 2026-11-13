import type { RegionCheckpoint } from '../discovery/checkpoints';
import type { JsonObject, JsonValue } from '../../api/parse';
import {
  LOCATION_MANIFEST_SCHEMA_VERSION,
  type BoundsSpec,
  type ColliderSpec,
  type EnvironmentSpec,
  type LightSpec,
  type LocationCopy,
  type NpcPlacementSpec,
  type PlaceholderSize,
  type PropSpec,
  type ScenerySpec,
  type ThreeLocationManifest,
} from '../island-map/three/runtime/locationManifest';
import type { WorldInteraction } from '../island-map/worldObjects';
import {
  parseEffects,
  REGION_PLAY_EXTENSION_ID,
  STAND_IN_SHAPES,
  type RegionPlayChestConfig,
  type RegionPlayConfig,
  type RegionPlayDrawnConfig,
  type RegionPlayInteractionConfig,
  type StandInShape,
} from './regionPlayConfig';
import { readRegionLayout, RegionLayoutError, type RegionLayout } from './regionLayout';
import type { RegionSceneModel, SceneEntity } from './sceneModel';

// The extension id and config types live in `regionPlayConfig.ts`, which the Three.js scene
// imports; this module reads API types, which the engine must not reach (LAI-0203).
export {
  REGION_PLAY_EXTENSION_ID,
  type RegionPlayChestConfig,
  type RegionPlayConfig,
  type RegionPlayInteractionConfig,
};

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
 * - **Adventure launch object** (ADR-041: a sign, door or other placement with
 *   launch points): an interactive prop with its model, or a placeholder box
 *   reached from the "Things to do here" list when it has none.
 *
 * Every NPC, chest and launch object gets one interaction the extension
 * claims, so interacting reaches the play API through the extension and
 * never the generic Amplify panels.
 */

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

/**
 * Action prompt verbs (TR-12). Every server-published region runs with
 * `interactionAssist`, so a chest says "Open" and Pip says "Talk" whether or
 * not the child is aiming exactly at them. Child-facing and localizable.
 */
export const REGION_ACTIONS = {
  talk: 'Talk',
  open: 'Open',
  look: 'Look',
  // TR-14
  read: 'Read',
  pickUp: 'Pick up',
  touch: 'Touch',
} as const;

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
  let layout: RegionLayout;
  try {
    layout = readRegionLayout(model.scene.layout);
  } catch (error) {
    if (error instanceof RegionLayoutError) throw new RegionBuildError(error.path, error.detail);
    throw error;
  }
  const npcs: NpcPlacementSpec[] = [];
  const props: PropSpec[] = [];
  // The admin's layout (TR-13) lies on the grass the region always gets.
  const scenery: ScenerySpec[] = [
    ground(regionId, bounds, model.scene.groundAssetId),
    ...layout.scenery,
  ];
  const interactions: WorldInteraction[] = [];
  const rawEffects = isObject(model.scene.effects) ? model.scene.effects : undefined;
  const effects = parseEffects(rawEffects);
  const deliverable = (assetId: string) =>
    model.deliverableAssetIds === null || model.deliverableAssetIds.has(assetId);
  const config: RegionPlayConfig = {
    chests: [],
    figures: [],
    interactions: [],
    drawn: [],
    puzzles: model.puzzles.map((puzzle) => ({
      puzzleId: puzzle.puzzleId,
      kind: puzzle.kind,
      entityIds: [...puzzle.entityIds],
      solved: puzzle.solved,
    })),
    effects: {
      ...effects,
      backdrop:
        effects.backdrop && effects.backdrop.assetId && !deliverable(effects.backdrop.assetId)
          ? { ...effects.backdrop, assetId: null }
          : effects.backdrop,
    },
    changeKeys: [...model.worldChangeKeys],
    procedural: layout.procedural,
    pickups: [],
    runes: [],
    // TR-17: what the quest's completion opens, and whether this child has already earned it.
    ...(layout.unlock
      ? {
          unlock: {
            ...layout.unlock,
            unlocked: model.worldChangeKeys.has(layout.unlock.changeKey),
          },
        }
      : {}),
    ...(layout.ambience ? { ambience: layout.ambience } : {}),
  };
  const standIns = readStandIns(rawEffects);
  const puzzleEntities = new Set(model.puzzles.flatMap((puzzle) => puzzle.entityIds));
  const returnEntities = new Set(effects.returns.map((entry) => entry.entityId));

  /** An entity the extension draws: a stand-in now, the model once it can be delivered. */
  const drawnEntity = (entity: SceneEntity, interactionId?: string, action?: string): void => {
    const standIn = standIns.get(entity.entityId);
    props.push(drawnProp(entity, interactionId, action));
    config.drawn.push({
      entityId: entity.entityId,
      shape: standIn?.shape ?? 'BOX',
      color: standIn?.color ?? BOX_PLACEHOLDER_COLOR,
      assetId: entity.assetId && deliverable(entity.assetId) ? entity.assetId : null,
      scale: entity.scale,
      size: { ...entity.placeholder },
    });
  };

  for (const entity of model.entities) {
    if (entity.role === 'npc') {
      const interactionId = `${regionId}:talk:${entity.entityId}`;
      const npcId = entity.npcId ?? entity.entityId;
      if (entity.assetId && deliverable(entity.assetId)) {
        const clips = options.assetClips?.(entity.assetId) ?? [];
        npcs.push({
          entityId: entity.entityId,
          npcId,
          assetId: entity.assetId,
          position: { x: entity.position.x, z: entity.position.z },
          yaw: entity.rotationY,
          label: entity.label,
          action: REGION_ACTIONS.talk,
          ...(clips.includes('Idle') ? { idleClip: 'Idle' } : {}),
          placeholderColor: NPC_PLACEHOLDER_COLOR,
          ...placeholderSize(entity, entity.scale),
          interactionId,
        });
      } else {
        props.push(drawnProp(entity, interactionId, REGION_ACTIONS.talk));
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
      // A puzzle's pedestal is read, not opened (TR-14); a spyglass is looked through (TR-20).
      const action =
        entity.presentation === 'PUZZLE'
          ? REGION_ACTIONS.read
          : entity.presentation === 'REPLAY'
            ? REGION_ACTIONS.look
            : REGION_ACTIONS.open;
      props.push(drawnProp(entity, interactionId, action));
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
        ...(entity.presentation && entity.presentation !== 'CHEST'
          ? { presentation: entity.presentation }
          : {}),
        ...(entity.lockReason ? { lockReason: entity.lockReason } : {}),
      });
      config.interactions.push({
        interactionId,
        kind: 'chest',
        entityId: entity.entityId,
        npcId: null,
      });
    } else if (puzzleEntities.has(entity.entityId) || returnEntities.has(entity.entityId)) {
      // ADR-047 F: a puzzle object (or the safe way back). The extension draws it and the
      // play API decides what using it means; nothing here grades or moves anything.
      const kind = puzzleEntities.has(entity.entityId) ? 'puzzle' : 'return';
      const interactionId = `${regionId}:${kind}:${entity.entityId}`;
      drawnEntity(
        entity,
        interactionId,
        kind === 'puzzle' ? REGION_ACTIONS.touch : REGION_ACTIONS.look,
      );
      interactions.push({
        id: interactionId,
        type: 'OBJECT',
        trigger: 'TAP',
        title: entity.label,
        targetId: entity.entityId,
        action: { kind: 'SHOW_MESSAGE', message: entity.label },
      });
      config.interactions.push({ interactionId, kind, entityId: entity.entityId, npcId: null });
    } else if (entity.pickup) {
      // TR-14: a collectible picked up through the play API. Once picked up it is not drawn
      // again; until then the extension draws it (a key has no catalogue model yet).
      if (entity.collected) continue;
      const interactionId = `${regionId}:pickup:${entity.entityId}`;
      props.push(drawnProp(entity, interactionId, REGION_ACTIONS.pickUp));
      interactions.push({
        id: interactionId,
        type: 'OBJECT',
        trigger: 'TAP',
        title: entity.label,
        targetId: entity.entityId,
        action: { kind: 'SHOW_MESSAGE', message: entity.label },
      });
      config.pickups?.push({ entityId: entity.entityId });
      config.interactions.push({
        interactionId,
        kind: 'pickup',
        entityId: entity.entityId,
        npcId: null,
      });
    } else if (entity.puzzleAnswer) {
      // TR-14: a rune stone the child touches to answer a puzzle; the extension draws it.
      const interactionId = `${regionId}:rune:${entity.entityId}`;
      props.push(drawnProp(entity, interactionId, REGION_ACTIONS.touch));
      interactions.push({
        id: interactionId,
        type: 'OBJECT',
        trigger: 'TAP',
        title: entity.label,
        targetId: entity.entityId,
        action: { kind: 'SHOW_MESSAGE', message: entity.label },
      });
      config.runes?.push({ entityId: entity.entityId, ...entity.puzzleAnswer });
      config.interactions.push({
        interactionId,
        kind: 'rune',
        entityId: entity.entityId,
        npcId: null,
      });
    } else if (entity.launchesAdventure) {
      // ADR-041: an object that starts one of this Place's Adventures. With a model it is an
      // interactive prop; without one it stays a placeholder box and is reached from the
      // "Things to do here" list, so it never needs a model that is not available.
      const interactionId = `${regionId}:launch:${entity.entityId}`;
      if (entity.assetId) {
        props.push({
          ...drawnProp(entity, interactionId, REGION_ACTIONS.look),
          assetId: entity.assetId,
          ...placeholderSize(entity, entity.scale),
        });
      } else {
        scenery.push(objectScenery(entity));
      }
      interactions.push({
        id: interactionId,
        type: 'OBJECT',
        trigger: 'TAP',
        title: entity.label,
        targetId: entity.entityId,
        action: { kind: 'SHOW_MESSAGE', message: entity.label },
      });
      config.interactions.push({
        interactionId,
        kind: 'launch',
        entityId: entity.entityId,
        npcId: null,
      });
    } else if (
      standIns.has(entity.entityId) ||
      (entity.assetId !== null && !deliverable(entity.assetId))
    ) {
      // A model that is not published yet: a shaped stand-in, never the loud missing-model box.
      drawnEntity(entity);
    } else {
      scenery.push(objectScenery(entity));
    }
  }

  const lights = [...layout.lights, ...readLights(rawEffects?.lights)];
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
    colliders: [...layout.colliders, ...readColliders(model.scene.colliders)],
    buildings: [],
    scenery,
    npcs,
    props,
    collectibles: [],
    zones: layout.zones,
    ...(lights.length > 0 ? { lights } : {}),
    ambient: layout.ambient,
    interactions,
    adventureBindings: [],
    interactionAssist: true,
    // LAI-JMP-01: jumping is on with the defaults; Django may tune or disable it per region
    // through `scene.movement` (validated with the rest of the manifest).
    ...(isObject(model.scene.movement)
      ? { movement: model.scene.movement as unknown as ThreeLocationManifest['movement'] }
      : {}),
    extensions: [
      { extensionId: REGION_PLAY_EXTENSION_ID, config: config as unknown as JsonObject },
    ],
    copy: readCopy(model.scene.copy),
  };
  return { manifest, checkpoints: [spawn] };
}

function drawnProp(entity: SceneEntity, interactionId?: string, action?: string): PropSpec {
  return {
    entityId: entity.entityId,
    position: { x: entity.position.x, z: entity.position.z },
    ...(entity.position.elevation ? { elevation: entity.position.elevation } : {}),
    rotationY: entity.rotationY,
    label: entity.label,
    ...(action ? { action } : {}),
    ...(interactionId ? { interactionId } : {}),
  };
}

/**
 * The admin's placeholder size times `scale`, as the stand-in drawn if the
 * model fails to load (TR-7a). Left out when a side is not positive, so the
 * runtime's default size is used rather than the region failing validation.
 */
function placeholderSize(
  entity: SceneEntity,
  scale: number,
): { placeholderSize: PlaceholderSize } | Record<string, never> {
  const { width, height, depth } = entity.placeholder;
  if (![width, height, depth].every((side) => Number.isFinite(side) && side > 0)) return {};
  return {
    placeholderSize: { width: width * scale, height: height * scale, depth: depth * scale },
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
      // The model's own `scale` is applied to its stand-in too, so the size stays unscaled here.
      ...placeholderSize(entity, 1),
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

function ground(
  regionId: string,
  bounds: BoundsSpec,
  groundAssetId: JsonValue | undefined,
): ScenerySpec {
  return {
    kind: 'TILED_GROUND',
    id: `${regionId}:ground`,
    assetId:
      typeof groundAssetId === 'string' && groundAssetId ? groundAssetId : DEFAULT_GROUND_ASSET_ID,
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
    isObject(value) &&
    typeof value.backgroundColor === 'number' &&
    Number.isInteger(value.backgroundColor)
      ? value.backgroundColor
      : DEFAULT_BACKGROUND;
  return { backgroundColor: background };
}

function text(value: JsonValue | undefined, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function readCopy(value: JsonValue | undefined): LocationCopy {
  const copy = isObject(value) ? value : {};
  // A legacy `copy.calmStop` (the retired play-time stop) is ignored: nothing stops a child.
  return {
    loading: text(copy.loading, DEFAULT_REGION_COPY.loading),
    instructions: text(copy.instructions, DEFAULT_REGION_COPY.instructions),
    altNav: { label: text(copy.altNavLabel, DEFAULT_REGION_COPY.altNavLabel), to: '' },
  };
}

/** Seed-authored colliders (`scene.colliders`); an extension may remove one by id. */
function readColliders(value: JsonValue | undefined): ColliderSpec[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (!isObject(raw) || typeof raw.id !== 'string') return [];
    const [minX, maxX, minZ, maxZ] = [raw.minX, raw.maxX, raw.minZ, raw.maxZ];
    if (![minX, maxX, minZ, maxZ].every((n) => typeof n === 'number' && Number.isFinite(n))) {
      return [];
    }
    return [
      {
        rect: {
          id: raw.id,
          minX: minX as number,
          maxX: maxX as number,
          minZ: minZ as number,
          maxZ: maxZ as number,
        },
      },
    ];
  });
}

/** Seed-authored point lights (`scene.effects.lights`): lava glow, crystal glow. */
function readLights(value: JsonValue | undefined): LightSpec[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (!isObject(raw) || typeof raw.id !== 'string') return [];
    const { x, y, z, color, intensity, distance } = raw;
    const numbers = [x, y, z, color, intensity];
    if (!numbers.every((n) => typeof n === 'number' && Number.isFinite(n))) return [];
    return [
      {
        id: raw.id,
        kind: 'POINT' as const,
        position: { x: x as number, y: y as number, z: z as number },
        color: color as number,
        intensity: intensity as number,
        ...(typeof distance === 'number' && distance >= 0 ? { distance } : {}),
      },
    ];
  });
}

function readStandIns(
  effects: JsonObject | undefined,
): Map<string, { shape: StandInShape; color: number }> {
  const out = new Map<string, { shape: StandInShape; color: number }>();
  const raw = effects?.standIns;
  if (!Array.isArray(raw)) return out;
  for (const entry of raw) {
    if (!isObject(entry) || typeof entry.entityId !== 'string') continue;
    const shape = STAND_IN_SHAPES.find((candidate) => candidate === entry.shape) ?? 'BOX';
    const color = typeof entry.color === 'number' ? entry.color : BOX_PLACEHOLDER_COLOR;
    out.set(entry.entityId, { shape, color });
  }
  return out;
}

export type { RegionPlayDrawnConfig };
