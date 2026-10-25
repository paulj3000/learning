import type {
  ChestState,
  NpcPlacement,
  ObjectPlacement,
  PlacedEntity,
  Placeholder,
  QuestEntry,
  RegionBootstrap,
  SpawnPoint,
} from '../../api/play/types';
import type { JsonObject } from '../../api/parse';

/**
 * The boundary TR-7 builds the Three.js region from (TR-6). Plain data, no
 * Three.js and no React: everything the scene needs, keyed by entity id, in
 * one shape whether it came from the API today or a fixture in a test.
 *
 * TR-7 turns this into a `ThreeLocationManifest` (props, NPCs, colliders...)
 * through its own adapter and validates the result with
 * `validateLocationManifest`; that mapping belongs to TR-7 because it depends
 * on runtime files LAI-2106 is still changing. Interactions flow back the
 * other way by entity id only: the scene reports "the child used
 * `cove-chest`", and `useRegionPlay` asks the server what that means.
 */

export type SceneEntityRole = 'npc' | 'object' | 'chest';

export interface SceneEntity {
  entityId: string;
  role: SceneEntityRole;
  label: string;
  position: { x: number; z: number; elevation: number };
  rotationY: number;
  scale: number;
  /** A bundled-manifest asset id, or null to draw the placeholder (TR-7a). */
  assetId: string | null;
  placeholder: Placeholder;
  interactionId: string | null;
  /** Chests only: whether this child has opened it. */
  isOpen?: boolean;
  /** Chests only: whether this child can be given a challenge for it now. */
  interactive?: boolean;
  /** Chests only: the clip to hold once open. */
  openClip?: string;
  /** NPCs only. */
  npcId?: string;
  /** Objects only: PROP, COLLECTIBLE, or SCENERY. */
  objectKind?: ObjectPlacement['kind'];
}

export interface RegionSceneModel {
  regionId: string;
  locationSlug: string;
  title: string;
  version: number;
  /** Bounds, environment, and copy, still unvalidated; TR-7 checks them. */
  scene: JsonObject;
  spawn: SpawnPoint | null;
  entities: SceneEntity[];
  /** `changeKey`s of this child's world changes in this region's location. */
  worldChangeKeys: ReadonlySet<string>;
  /** Quests to show beside NPCs (offers and progress), by giver NPC id. */
  questsByGiver: ReadonlyMap<string, readonly QuestEntry[]>;
}

function base(entity: PlacedEntity, role: SceneEntityRole): Omit<SceneEntity, 'interactionId'> {
  return {
    entityId: entity.entityId,
    role,
    label: entity.label,
    position: { x: entity.x, z: entity.z, elevation: entity.elevation },
    rotationY: entity.rotationY,
    scale: entity.scale,
    assetId: entity.assetId === '' ? null : entity.assetId,
    placeholder: entity.placeholder,
  };
}

function npc(entity: NpcPlacement): SceneEntity {
  return {
    ...base(entity, 'npc'),
    interactionId: entity.interactionId || null,
    npcId: entity.npcId,
  };
}

function object(entity: ObjectPlacement): SceneEntity {
  return {
    ...base(entity, 'object'),
    interactionId: entity.interactionId || null,
    objectKind: entity.kind,
  };
}

function chest(entity: ChestState): SceneEntity {
  return {
    ...base(entity, 'chest'),
    interactionId: null, // a chest's meaning is the play API, not a WorldInteraction
    isOpen: entity.isOpen,
    interactive: entity.challengeAvailable && !entity.isOpen,
    openClip: entity.openClip || undefined,
  };
}

export function toRegionSceneModel(bootstrap: RegionBootstrap): RegionSceneModel {
  const location = bootstrap.region.locationSlug;
  const questsByGiver = new Map<string, QuestEntry[]>();
  for (const quest of bootstrap.quests) {
    if (!quest.giverNpcId) continue;
    questsByGiver.set(quest.giverNpcId, [...(questsByGiver.get(quest.giverNpcId) ?? []), quest]);
  }
  return {
    regionId: bootstrap.region.regionId,
    locationSlug: location,
    title: bootstrap.region.title,
    version: bootstrap.region.version,
    scene: bootstrap.region.scene,
    spawn: bootstrap.spawn,
    entities: [
      ...bootstrap.npcs.map(npc),
      ...bootstrap.objects.map(object),
      ...bootstrap.chests.map(chest),
    ],
    worldChangeKeys: new Set(
      bootstrap.worldChanges.filter((c) => c.locationSlug === location).map((c) => c.changeKey),
    ),
    questsByGiver,
  };
}

/** The entity the scene reported, if the region has one by that id. */
export function findEntity(model: RegionSceneModel, entityId: string): SceneEntity | undefined {
  return model.entities.find((entity) => entity.entityId === entityId);
}
