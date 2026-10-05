import { HOME_WORLD_SLUG } from '../../../../worlds/slugs';
import { PIRATE_BUILDER_BAY_INTERACTIONS, type WorldRequirement } from '../../../worldObjects';
import { runPlacements } from '../../sceneKit';
import {
  BARRELS,
  BRIDGE_APPROACH_ZONE,
  BRIDGE_MAX_Z,
  BRIDGE_MIN_Z,
  BRIDGE_SPAN,
  CHANNEL_BED_Y,
  CHANNEL_MAX_X,
  CHANNEL_MIN_X,
  CHANNEL_NORTH_WATER,
  CHANNEL_SOUTH_WATER,
  CHANNEL_SURFACE,
  COVE_GROUND,
  COVE_PATH_RUN,
  COVE_ROCKS,
  COVE_TREES,
  CRATES,
  DOCK_GROUND,
  FOLIAGE_TREES,
  GROUND_HALF_EXTENT_X,
  GROUND_HALF_EXTENT_Z,
  HARBOR_EXIT_ZONE,
  JETTY_PLANK_WIDTH,
  JETTY_RUN,
  MOORING_POSTS,
  NPC_ID,
  NPC_SPOT,
  PATH_RUN,
  PIRATE_BUILDER_BAY_REGION_CHECKPOINTS,
  REGION_ID,
  ROCKS,
  ROPE_COIL_ID,
  ROPE_COIL_SPOT,
  SEA_HALF_EXTENT,
  SHIPWRECK,
  SHORE_ROCK_RUNS,
  SHORE_ROCK_SCALE,
  SHORE_ROCK_SPACING,
  SOLID_PROPS,
  TIDE_BANK_TOP_CM,
  TIDE_POST_SPOT,
  TIDE_TUNNEL_BOULDERS,
  TIDE_TUNNEL_ZONE,
  TOOLBOX_ID,
  TOOLBOX_SPOT,
  TREASURE_ID,
  TREASURE_SPOT,
  WATER_SURFACE_Y,
} from '../../pirateBuilderBayRegion';
import { TIDE_TRIAL_EXTENSION_ID } from '../../extensions/tideTrial/tideTrialScene';
import {
  LOCATION_MANIFEST_SCHEMA_VERSION,
  type ClusterPosition,
  type ThreeLocationManifest,
} from '../locationManifest';

/**
 * Pirate Builder Bay as a `ThreeLocationManifest`: the second region on the
 * generic runtime (engine Phase 7), chosen because it is structurally unlike
 * Welcome Harbor. It has water instead of buildings, a bridge that is broken
 * or mended depending on the child's world state, interactive props, and
 * one bespoke mechanic, "Beat the Tide", declared as the `tide-trial`
 * extension rather than written into the runtime.
 *
 * Built from `pirateBuilderBayRegion.ts`'s constants, like
 * `welcomeHarbor.ts`, so the two cannot drift while the old scene is the
 * parity reference. Literals not imported here (colours, heights, the
 * fallen plank's angle, scale factors) are copied from
 * `pirateBuilderBayScene.ts`, where they are hard-coded.
 *
 * Interactions are the same `PIRATE_BUILDER_BAY_INTERACTIONS` the 2D view
 * uses, so both renderers keep resolving the same authored ids. The bridge
 * approach zone is named `bay-broken-bridge`, the zone those interactions
 * already declare, where the old 3D scene emitted `bay-bridge-approach` and
 * translated it in its view.
 */

const BRIDGE_REPAIRED = 'BRIDGE_REPAIRED';
const WHILE_BROKEN: readonly WorldRequirement[] = [
  { type: 'WORLD_CHANGE_ABSENT', changeKey: BRIDGE_REPAIRED },
];
const ONCE_REPAIRED: readonly WorldRequirement[] = [
  { type: 'WORLD_CHANGE_PRESENT', changeKey: BRIDGE_REPAIRED },
];

const groundPositions = (points: readonly { x: number; z: number }[]): ClusterPosition[] =>
  points.map((point) => ({ x: point.x, z: point.z }));

/** Placements as plain cluster positions (`runPlacements` returns the loader's own shape). */
const runPositions = (
  from: { x: number; z: number },
  to: { x: number; z: number },
  spacing: number,
  y = 0,
): ClusterPosition[] =>
  runPlacements(from, to, spacing).map((placement) => ({
    x: placement.position.x,
    z: placement.position.z,
    y,
    rotationY: placement.rotationY,
  }));

const quayWall = (id: string, centreX: number) => ({
  kind: 'BOX' as const,
  id,
  color: 0x8a8274,
  area: {
    id: `${id}:area`,
    minX: centreX - 0.1,
    maxX: centreX + 0.1,
    minZ: CHANNEL_SURFACE.minZ,
    maxZ: CHANNEL_SURFACE.maxZ,
  },
  minY: CHANNEL_BED_Y,
  maxY: 0,
});

const bridgeSpanLength = BRIDGE_MAX_Z - BRIDGE_MIN_Z;

export const PIRATE_BUILDER_BAY_MANIFEST: ThreeLocationManifest = {
  schemaVersion: LOCATION_MANIFEST_SCHEMA_VERSION,
  regionId: REGION_ID,
  locationSlug: 'pirate-builder-bay',
  worldSlug: HOME_WORLD_SLUG,
  title: 'Pirate Builder Bay',
  version: 1,

  bounds: {
    halfExtentX: GROUND_HALF_EXTENT_X,
    halfExtentZ: GROUND_HALF_EXTENT_Z,
    wallThickness: 1,
  },
  environment: { backgroundColor: 0x9fd4ec },
  checkpoints: {
    ids: PIRATE_BUILDER_BAY_REGION_CHECKPOINTS.map((checkpoint) => checkpoint.id),
    triggerHalfSize: 1.5,
  },
  colliders: [
    ...SOLID_PROPS.map((rect) => ({ rect: { ...rect } })),
    { rect: { ...CHANNEL_NORTH_WATER }, minY: -1, maxY: 4 },
    { rect: { ...CHANNEL_SOUTH_WATER }, minY: -1, maxY: 4 },
    // The gap where the bridge should be, until it is mended.
    { rect: { ...BRIDGE_SPAN }, minY: -1, maxY: 4, requirements: WHILE_BROKEN },
  ],
  buildings: [],

  scenery: [
    // Sand either side of the channel, not one plane across it, so the water shows.
    { kind: 'FLAT_PLANE', id: 'bay-dock-ground', color: 0xdccf9a, area: { ...DOCK_GROUND }, y: 0 },
    { kind: 'FLAT_PLANE', id: 'bay-cove-ground', color: 0xdccf9a, area: { ...COVE_GROUND }, y: 0 },
    {
      kind: 'BOX',
      id: 'bay-channel',
      color: 0x2f6f9e,
      area: { ...CHANNEL_SURFACE },
      minY: CHANNEL_BED_Y,
      maxY: WATER_SURFACE_Y,
    },
    quayWall('bay-quay-west', CHANNEL_MIN_X - 0.101),
    quayWall('bay-quay-east', CHANNEL_MAX_X + 0.101),
    {
      kind: 'FLAT_PLANE',
      id: 'bay-sea',
      color: 0x3a7fae,
      area: {
        id: 'bay-sea:area',
        minX: -SEA_HALF_EXTENT,
        maxX: SEA_HALF_EXTENT,
        minZ: -SEA_HALF_EXTENT,
        maxZ: SEA_HALF_EXTENT,
      },
      y: WATER_SURFACE_Y,
    },
    {
      kind: 'CLUSTER',
      id: 'bay-bridge-deck',
      assetId: 'bridge-plank-repaired',
      requirements: ONCE_REPAIRED,
      positions: runPositions({ x: CHANNEL_MIN_X, z: 0 }, { x: CHANNEL_MAX_X, z: 0 }, 1).map(
        (position) => ({
          ...position,
          rotationY: 0,
          scale: { x: 1, y: 1, z: bridgeSpanLength / 3 },
        }),
      ),
    },
    {
      kind: 'CLUSTER',
      id: 'bay-bridge-stubs',
      assetId: 'bridge-plank',
      requirements: WHILE_BROKEN,
      positions: [
        { x: CHANNEL_MIN_X + 0.6, z: 0 },
        { x: CHANNEL_MAX_X - 0.6, z: 0 },
      ],
    },
    {
      kind: 'MODEL',
      id: 'bay-bridge-fallen-plank',
      assetId: 'bridge-plank',
      requirements: WHILE_BROKEN,
      // Half sunk against the dock bank, one end still out of the water.
      position: { x: CHANNEL_MIN_X + 0.5, y: WATER_SURFACE_Y - 0.1, z: 2.4 },
      rotation: { x: 0.1, y: 1.15, z: 0.35 },
    },
    {
      kind: 'CLUSTER',
      id: 'bay-rocks',
      assetId: 'rock',
      positions: groundPositions([...ROCKS, ...COVE_ROCKS]),
    },
    {
      kind: 'CLUSTER',
      id: 'bay-trees',
      assetId: 'foliage-tree',
      positions: groundPositions([...FOLIAGE_TREES, ...COVE_TREES]),
    },
    {
      kind: 'CLUSTER',
      id: 'bay-paths',
      assetId: 'path',
      // A hair above the sand: `path` is a flat quad and would z-fight the ground.
      positions: [
        ...runPositions(PATH_RUN.from, PATH_RUN.to, 1.5, 0.01),
        ...runPositions(COVE_PATH_RUN.from, COVE_PATH_RUN.to, 1.5, 0.01),
      ],
    },
    {
      kind: 'CLUSTER',
      id: 'bay-shore-boulders',
      assetId: 'rock',
      positions: [
        ...SHORE_ROCK_RUNS.flatMap((run) =>
          runPositions(run.from, run.to, SHORE_ROCK_SPACING).map((position, index) => ({
            ...position,
            rotationY: index * 1.1,
            scale: { x: SHORE_ROCK_SCALE, y: SHORE_ROCK_SCALE * 0.8, z: SHORE_ROCK_SCALE },
          })),
        ),
        ...TIDE_TUNNEL_BOULDERS.map((boulder) => ({
          x: boulder.x,
          z: boulder.z,
          rotationY: boulder.x,
          scale: { x: boulder.scale, y: boulder.scale, z: boulder.scale },
        })),
      ],
    },
    {
      kind: 'CLUSTER',
      id: 'bay-jetty',
      assetId: 'bridge-plank',
      positions: runPositions(
        JETTY_RUN.from,
        JETTY_RUN.to,
        JETTY_PLANK_WIDTH,
        WATER_SURFACE_Y + 0.35,
      ),
    },
    {
      kind: 'CLUSTER',
      id: 'bay-mooring-posts',
      assetId: 'mooring-post',
      positions: MOORING_POSTS.map((post) => ({ x: post.x, z: post.z, y: CHANNEL_BED_Y })),
    },
    {
      kind: 'CLUSTER',
      id: 'bay-crates',
      assetId: 'crate',
      positions: CRATES.map((crate) => ({
        x: crate.x,
        z: crate.z,
        y: crate.y ?? 0,
        rotationY: crate.rotationY ?? 0,
      })),
    },
    {
      kind: 'CLUSTER',
      id: 'bay-barrels',
      assetId: 'barrel',
      positions: BARRELS.map((barrel, index) => ({
        x: barrel.x,
        z: barrel.z,
        rotationY: index * 0.7,
      })),
    },
    {
      kind: 'MODEL',
      id: 'bay-shipwreck',
      assetId: 'shipwreck',
      position: { x: SHIPWRECK.x, y: 0, z: SHIPWRECK.z },
      rotation: { x: 0, y: SHIPWRECK.rotationY, z: 0 },
    },
    {
      kind: 'MODEL',
      id: 'bay-signpost',
      assetId: 'signpost',
      position: {
        x: (HARBOR_EXIT_ZONE.minX + HARBOR_EXIT_ZONE.maxX) / 2,
        y: 0,
        z: (HARBOR_EXIT_ZONE.minZ + HARBOR_EXIT_ZONE.maxZ) / 2,
      },
    },
  ],

  npcs: [
    {
      entityId: NPC_ID,
      npcId: NPC_ID,
      assetId: 'npc-pip',
      position: { ...NPC_SPOT },
      // The crosshair showed the interaction's title in the old view.
      label: 'Pirate Pip',
      idleClip: 'Idle',
      placeholderColor: 0x2f8f4e,
      interactionId: 'meet-pirate-pip',
    },
  ],

  props: [
    {
      entityId: ROPE_COIL_ID,
      assetId: 'rope-coil',
      position: { ...ROPE_COIL_SPOT },
      label: 'A coil of rope',
      interactionId: ROPE_COIL_ID,
    },
    {
      entityId: TOOLBOX_ID,
      assetId: 'toolbox',
      position: { ...TOOLBOX_SPOT },
      label: "Pirate Pip's toolbox",
      interactionId: TOOLBOX_ID,
    },
    {
      entityId: TREASURE_ID,
      assetId: 'treasure-chest',
      position: { ...TREASURE_SPOT },
      label: 'A hidden treasure chest',
      interactionId: TREASURE_ID,
      interactClip: 'Open',
    },
  ],

  collectibles: [],

  zones: [
    { rect: { ...BRIDGE_APPROACH_ZONE, id: 'bay-broken-bridge' } },
    { rect: { ...TIDE_TUNNEL_ZONE } },
    { rect: { ...HARBOR_EXIT_ZONE } },
  ],

  ambient: [],

  interactions: PIRATE_BUILDER_BAY_INTERACTIONS,

  adventureBindings: [],

  extensions: [
    {
      extensionId: TIDE_TRIAL_EXTENSION_ID,
      config: {
        interactionId: 'bay-broken-bridge',
        ageBands: ['EXPLORER'],
        channelSceneryId: 'bay-channel',
        seaSceneryId: 'bay-sea',
        hideDuringTrialSceneryIds: ['bay-bridge-stubs', 'bay-bridge-fallen-plank'],
        bridgeColliderId: BRIDGE_SPAN.id,
        npcEntityId: NPC_ID,
        plankAssetId: 'bridge-plank',
        bankTopY: 0,
        bankTopCm: TIDE_BANK_TOP_CM,
        bridge: { minZ: BRIDGE_MIN_Z, maxZ: BRIDGE_MAX_Z },
        deckPlankXs: [-2.5, -1.5, -0.5, 0.5, 1.5, 2.5],
        deckPostXs: [-1.5, 1.5],
        tidePost: { x: TIDE_POST_SPOT.x, z: TIDE_POST_SPOT.z },
        worldChange: {
          locationSlug: 'pirate-builder-bay',
          changeType: 'REPAIR',
          changeKey: BRIDGE_REPAIRED,
          source: 'exploration:beat-the-tide',
        },
      },
    },
  ],

  copy: {
    loading: 'Loading Pirate Builder Bay...',
    instructions:
      'Move: WASD or the arrow keys. Look: click the screen, then move your mouse (or drag with two fingers on a touch screen: left side to move, right side to look). Walk up to something and press E, or use the button below, to interact with it.',
    altNav: {
      label: 'Prefer not to walk in 3D? Use the location page instead',
      to: 'locations/pirate-builder-bay',
    },
  },
};
