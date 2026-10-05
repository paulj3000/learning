import { HOME_WORLD_SLUG } from '../../../../worlds/slugs';
import {
  AMBIENT_GULL_PATH,
  BUILDINGS,
  COLLECTIBLE_ID,
  COLLECTIBLE_SPOT,
  FENCE_RUN,
  FOLIAGE_BUSHES,
  FOLIAGE_TREES,
  GROUND_HALF_EXTENT,
  NPC_ID,
  NPC_SPOT,
  REGION_ID,
  SCENERY_CLUSTER,
  WELCOME_HARBOR_REGION_CHECKPOINTS,
} from '../../welcomeHarborRegion';
import { LOCATION_MANIFEST_SCHEMA_VERSION, type ThreeLocationManifest } from '../locationManifest';

/**
 * Welcome Harbor's first-person region expressed as a `ThreeLocationManifest`:
 * the reference migration (`docs/engine/09_MIGRATION_PLAN.md`, "Reference
 * Migration Choice"). Not rendered by anything yet. It exists in Phase 1 to
 * prove the manifest vocabulary can describe a real region with zero
 * extensions, and `welcomeHarbor.test.ts` checks it against what
 * `welcomeHarborScene.ts` actually builds.
 *
 * Built from `welcomeHarborRegion.ts`'s constants rather than restating
 * them, so the two cannot drift while both exist. Once the generic runtime
 * renders this manifest (Phase 5), the numbers move here and the region
 * module retires.
 *
 * Every literal below that is not imported (asset ids, clip names, colours,
 * the checkpoint trigger size, the gull's speed) is copied from
 * `welcomeHarborScene.ts`, where it is currently hard-coded.
 */

const PIP_INTERACTION_ID = 'harbor-say-hello-to-pip';

export const WELCOME_HARBOR_MANIFEST: ThreeLocationManifest = {
  schemaVersion: LOCATION_MANIFEST_SCHEMA_VERSION,
  regionId: REGION_ID,
  worldSlug: HOME_WORLD_SLUG,
  title: 'Welcome Harbor',
  version: 1,

  bounds: { halfExtentX: GROUND_HALF_EXTENT, halfExtentZ: GROUND_HALF_EXTENT, wallThickness: 1 },
  environment: { backgroundColor: 0x8fc7e6 },
  checkpoints: {
    ids: WELCOME_HARBOR_REGION_CHECKPOINTS.map((checkpoint) => checkpoint.id),
    triggerHalfSize: 1.5,
  },
  colliders: [],

  buildings: BUILDINGS.map((building) => ({
    id: building.id,
    label: building.label,
    x: building.x,
    z: building.z,
    halfWidth: building.halfWidth,
    halfDepth: building.halfDepth,
    height: building.height,
    wallSides: [...building.wallSides],
    interiorZone: { ...building.interiorZone },
    enterMessage: `You're inside ${building.label}.`,
    wallAssetId: 'wall',
    roofAssetId: 'roof',
    doorAssetId: 'door',
  })),

  scenery: [
    {
      kind: 'TILED_GROUND',
      id: 'harbor-ground',
      assetId: 'ground-tile',
      area: {
        id: 'harbor-ground:area',
        minX: -GROUND_HALF_EXTENT,
        maxX: GROUND_HALF_EXTENT,
        minZ: -GROUND_HALF_EXTENT,
        maxZ: GROUND_HALF_EXTENT,
      },
      tileSize: 4,
    },
    {
      kind: 'FLAT_PLANE',
      id: 'harbor-water',
      color: 0x2f6f9e,
      area: {
        id: 'harbor-water:area',
        minX: -GROUND_HALF_EXTENT,
        maxX: GROUND_HALF_EXTENT,
        minZ: GROUND_HALF_EXTENT - 8,
        maxZ: GROUND_HALF_EXTENT,
      },
      y: -0.05,
    },
    {
      kind: 'CLUSTER',
      id: 'harbor-rocks',
      assetId: 'rock',
      positions: SCENERY_CLUSTER.map((position, index) => ({
        x: position.x,
        z: position.z,
        rotationY: index * 0.6,
      })),
    },
    {
      kind: 'LOD_PLACEMENTS',
      id: 'harbor-trees',
      assetId: 'foliage-tree',
      positions: FOLIAGE_TREES.map((tree) => ({ x: tree.x, z: tree.z })),
    },
    {
      kind: 'CLUSTER',
      id: 'harbor-bushes',
      assetId: 'foliage-bush',
      positions: FOLIAGE_BUSHES.map((bush) => ({ x: bush.x, z: bush.z })),
    },
    {
      kind: 'RUN',
      id: 'harbor-fence',
      assetId: 'fence',
      from: { ...FENCE_RUN.from },
      to: { ...FENCE_RUN.to },
      segmentLength: 1.2,
    },
  ],

  npcs: [
    {
      entityId: NPC_ID,
      npcId: NPC_ID,
      assetId: 'npc-pip',
      position: { ...NPC_SPOT },
      label: 'Pip',
      idleClip: 'Idle',
      placeholderColor: 0x2f8f4e,
      interactionId: PIP_INTERACTION_ID,
    },
  ],

  props: [],

  collectibles: [
    {
      entityId: COLLECTIBLE_ID,
      assetId: 'collectible-gem',
      position: { ...COLLECTIBLE_SPOT },
      label: 'a shiny gem',
      idleClip: 'Idle',
    },
  ],

  zones: [],

  ambient: [
    {
      kind: 'SPLINE_LOOP',
      id: 'harbor-gull',
      path: AMBIENT_GULL_PATH.map((point) => ({ ...point })),
      loopsPerSecond: 0.05,
      appearance: { primitive: 'CONE', color: 0xf4f1e8 },
    },
  ],

  interactions: [
    {
      id: PIP_INTERACTION_ID,
      type: 'NPC',
      trigger: 'TAP',
      title: 'Say hello to Pip',
      targetId: NPC_ID,
      action: { kind: 'TALK_TO', npcId: NPC_ID },
    },
  ],

  adventureBindings: [],

  extensions: [],

  copy: {
    loading: 'Loading Welcome Harbor...',
    instructions:
      'Move: WASD or the arrow keys. Look: click the screen, then move your mouse (or drag with two fingers on a touch screen: left side to move, right side to look). Walk up to Pip and press E, or use the button below, to say hello.',
    altNav: { label: 'Prefer not to walk in 3D? Go back to the harbor', to: '' },
  },
};
