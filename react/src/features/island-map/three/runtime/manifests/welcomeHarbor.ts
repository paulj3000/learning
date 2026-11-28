import { HOME_WORLD_SLUG } from '../../../../worlds/slugs';
import { WELCOME_HARBOR_INTERACTIONS, type WorldRequirement } from '../../../worldObjects';
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
import {
  LOCATION_MANIFEST_SCHEMA_VERSION,
  type ColliderSpec,
  type RectZone,
  type ThreeLocationManifest,
} from '../locationManifest';

/**
 * Welcome Harbor's first-person region expressed as a `ThreeLocationManifest`:
 * the reference migration (`docs/engine/09_MIGRATION_PLAN.md`, "Reference
 * Migration Choice"), rendered by the generic runtime since engine Phase 5,
 * with zero extensions.
 *
 * Built from `welcomeHarborRegion.ts`'s constants rather than restating
 * them. Every literal below that is not imported (asset ids, clip names,
 * colours, the checkpoint trigger size, the gull's speed) was copied from
 * the old per-region scene, removed in engine Phase 16.
 */

const PIP_INTERACTION_ID = 'harbor-say-hello-to-pip';

/*
  LAI-2201: the Phaser harbor's things, laid out for walking. Compass: north is -z (the castle
  path), south is +z (the sea and the dock the child spawns on), east is +x (the canal and the
  bridge), west is -x (the forest path). Every walk-in zone sits on open ground at an edge, every
  tap target stands on open ground, and the only solid water is the canal and the open sea, so
  nothing a child needs is behind a jump.
*/
const BRIDGE_REPAIRED = 'BRIDGE_REPAIRED';
const WHILE_BROKEN: readonly WorldRequirement[] = [
  { type: 'WORLD_CHANGE_ABSENT', changeKey: BRIDGE_REPAIRED },
];
const ONCE_REPAIRED: readonly WorldRequirement[] = [
  { type: 'WORLD_CHANGE_PRESENT', changeKey: BRIDGE_REPAIRED },
];

/** The canal along the east edge. The bridge crosses it between `BRIDGE_MIN_Z` and `BRIDGE_MAX_Z`. */
const CANAL_MIN_X = 10;
const CANAL_MAX_X = 12;
const BRIDGE_MIN_Z = -1.5;
const BRIDGE_MAX_Z = 1.5;
const CANAL_SURFACE_Y = -0.15;

const zone = (id: string, minX: number, maxX: number, minZ: number, maxZ: number): RectZone => ({
  id,
  minX,
  maxX,
  minZ,
  maxZ,
});

/** Walk-in zone on the west bank, where the bridge starts. Shared by the broken and repaired interactions. */
const BRIDGE_APPROACH = zone('broken-bridge', 8, CANAL_MIN_X, BRIDGE_MIN_Z, BRIDGE_MAX_Z);
const FOREST_ENTRANCE = zone('forest-entrance', -11.9, -9.5, 1.5, 3.8);
const CASTLE_ENTRANCE = zone('castle-entrance', -1.5, 1.5, -11.9, -10.4);
const MOUNTAIN_PATH = zone('mountain-path', 4, 7, -11.9, -10.4);
const FOSSIL_RIDGE_PATH = zone('fossil-ridge-path', -6, -3, -11.9, -10.4);
const BOLTS_WORKSHOP_PATH = zone('bolts-workshop-path', -11.9, -9.5, -9.5, -7);
/** The unmarked secret in the quiet south-east corner of the beach. */
const TIDE_POOL = zone('harbor-tide-pool', 6, 8, 2, 3.8);

/** Open sea: solid, except the dock the child spawns on (x -1.5 to 1.5). */
const sea = (id: string, minX: number, maxX: number): ColliderSpec => ({
  rect: zone(id, minX, maxX, 5, 12),
  minY: -1,
  maxY: 4,
});

const pathStrip = (id: string, area: RectZone) => ({
  kind: 'BOX' as const,
  id,
  color: 0xb59a6a,
  area: { ...area, id: `${id}:area` },
  minY: 0,
  maxY: 0.03,
  static: true,
});

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
  colliders: [
    {
      rect: zone('harbor-canal-north', CANAL_MIN_X, CANAL_MAX_X, -12, BRIDGE_MIN_Z),
      minY: -1,
      maxY: 4,
    },
    {
      rect: zone('harbor-canal-south', CANAL_MIN_X, CANAL_MAX_X, BRIDGE_MAX_Z, 12),
      minY: -1,
      maxY: 4,
    },
    // The gap where the bridge should be, until it is mended.
    {
      rect: zone('harbor-bridge-gap', CANAL_MIN_X, CANAL_MAX_X, BRIDGE_MIN_Z, BRIDGE_MAX_Z),
      minY: -1,
      maxY: 4,
      requirements: WHILE_BROKEN,
    },
    sea('harbor-sea-west', -12, -1.5),
    sea('harbor-sea-east', 1.5, CANAL_MIN_X),
  ],

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
        maxX: 8,
        minZ: -GROUND_HALF_EXTENT,
        maxZ: GROUND_HALF_EXTENT,
      },
      tileSize: 4,
    },
    // The east bank, either side of the canal (a tiled ground would run over the water).
    {
      kind: 'FLAT_PLANE',
      id: 'harbor-east-bank',
      color: 0xdccf9a,
      area: zone('harbor-east-bank:area', 8, CANAL_MIN_X, -GROUND_HALF_EXTENT, GROUND_HALF_EXTENT),
      y: 0,
    },
    {
      kind: 'BOX',
      id: 'harbor-canal',
      color: 0x2f6f9e,
      area: zone(
        'harbor-canal:area',
        CANAL_MIN_X,
        CANAL_MAX_X,
        -GROUND_HALF_EXTENT,
        GROUND_HALF_EXTENT,
      ),
      minY: -0.6,
      maxY: CANAL_SURFACE_Y,
    },
    {
      kind: 'CLUSTER',
      id: 'harbor-bridge-deck',
      assetId: 'bridge-plank-repaired',
      requirements: ONCE_REPAIRED,
      positions: [10.5, 11.5].map((x) => ({
        x,
        z: 0,
        y: CANAL_SURFACE_Y,
        rotationY: 0,
        scale: { x: 1, y: 1, z: (BRIDGE_MAX_Z - BRIDGE_MIN_Z) / 3 },
      })),
    },
    {
      kind: 'CLUSTER',
      id: 'harbor-bridge-stubs',
      assetId: 'bridge-plank',
      requirements: WHILE_BROKEN,
      positions: [
        { x: CANAL_MIN_X + 0.4, z: 0 },
        { x: CANAL_MAX_X - 0.4, z: 0 },
      ],
    },
    {
      kind: 'MODEL',
      id: 'harbor-bridge-fallen-plank',
      assetId: 'bridge-plank',
      requirements: WHILE_BROKEN,
      position: { x: CANAL_MIN_X + 0.5, y: CANAL_SURFACE_Y - 0.1, z: 2.4 },
      rotation: { x: 0.1, y: 1.15, z: 0.35 },
    },
    // The dock the child spawns on, running out into the sea.
    {
      kind: 'BOX',
      id: 'harbor-dock',
      color: 0x8a6b43,
      area: zone('harbor-dock:area', -1.5, 1.5, 3, 9.5),
      minY: -0.05,
      maxY: 0.1,
      static: true,
    },
    pathStrip('harbor-forest-path', FOREST_ENTRANCE),
    pathStrip('harbor-castle-path', CASTLE_ENTRANCE),
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

  props: [
    {
      entityId: 'chatty',
      assetId: 'companion-chatty',
      position: { x: -1, z: 6.2 },
      rotationY: Math.PI,
      label: 'Chatty the Parrot',
      interactionId: 'talk-to-chatty',
      placeholderSize: { width: 0.4, height: 0.5, depth: 0.3 },
    },
    {
      entityId: 'dock-sign',
      assetId: 'signpost',
      position: { x: 1.1, z: 3.6 },
      label: 'A wooden sign',
      interactionId: 'dock-sign',
    },
    {
      entityId: 'palm-tree',
      assetId: 'foliage-tree',
      position: { x: -8.5, z: 3 },
      label: 'A palm tree',
      interactionId: 'palm-tree',
    },
    {
      entityId: 'harbor-door',
      assetId: 'door',
      position: { x: -10.5, z: -4.5 },
      rotationY: Math.PI / 2,
      label: "The harbor keeper's door",
      interactionId: 'harbor-door',
    },
  ],

  collectibles: [
    {
      entityId: COLLECTIBLE_ID,
      assetId: 'collectible-gem',
      position: { ...COLLECTIBLE_SPOT },
      label: 'a shiny gem',
      idleClip: 'Idle',
    },
  ],

  zones: [
    BRIDGE_APPROACH,
    FOREST_ENTRANCE,
    CASTLE_ENTRANCE,
    MOUNTAIN_PATH,
    FOSSIL_RIDGE_PATH,
    BOLTS_WORKSHOP_PATH,
    TIDE_POOL,
  ].map((rect) => ({ rect })),

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
    // The same table the Phaser harbor uses, so both keep the same ids, actions and requirements.
    ...WELCOME_HARBOR_INTERACTIONS,
  ],

  // The tide pool is a secret: it stays out of "Things to do here" and is found by wandering.
  hiddenInteractionIds: ['harbor-tide-pool'],

  adventureBindings: [],

  extensions: [],

  copy: {
    loading: 'Loading Welcome Harbor...',
    instructions:
      'Move: WASD or the arrow keys. Look: click the screen, then move your mouse (or drag with two fingers on a touch screen: left side to move, right side to look). Walk up to Pip and press E, or use the button below, to say hello.',
    altNav: { label: 'Prefer not to walk in 3D? Go back to the harbor', to: '' },
  },
};
