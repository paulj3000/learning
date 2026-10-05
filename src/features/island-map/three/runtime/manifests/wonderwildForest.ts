import { WONDERWILD_FOREST_INTERACTIONS } from '../../../worldObjects';
import { HOME_WORLD_SLUG } from '../../../../worlds/slugs';
import {
  WONDERWILD_FOREST_CHECKPOINTS,
  WONDERWILD_FOREST_REGION_ID,
} from '../../../../discovery/checkpoints';
import {
  BEEHIVE_SPOT,
  BUTTERFLY_SPOT,
  CAVE_MOUTH_SPOT,
  CHATTY_PERCH_SPOT,
  FLOWER_PATCH_SPOT,
  GLOW_MOSS_SPOT,
  GROUND_HALF_EXTENT_X,
  GROUND_HALF_EXTENT_Z,
  HIVE_TRUNK_SPOT,
  LEAF_PILE_SPOT,
  NIGHT_STONE_SPOTS,
  POND_FROG_SPOT,
  POND_WATER,
  TRAILS,
  TREE_LINE_SEGMENTS,
  WONDER_STONE_SPOTS,
  ZONES,
  type RectZone as RegionRect,
} from '../../wonderwildForestRegion';
import {
  LOCATION_MANIFEST_SCHEMA_VERSION,
  type ColliderSpec,
  type ScenerySpec,
  type ThreeLocationManifest,
  type ZoneSpec,
} from '../locationManifest';

/**
 * Wonderwild Forest as a manifest (engine roadmap Phase 9, ADR-025). Built
 * from `wonderwildForestRegion.ts`'s own constants, as the Welcome Harbor
 * and Pirate Builder Bay manifests are, so the geometry cannot drift from
 * the region module the forest's tests already cover.
 *
 * The forest is the first migrated region whose ground is *derived* rather
 * than authored: its tree line is the complement of the walkable set
 * (`buildTreeLineSegments`), which is why it needs no boundary walls of its
 * own and why its trees are a `SCATTER` rather than a hand-listed cluster.
 * Both came in as generic vocabulary with this migration:
 *
 * - `SCATTER` - deterministic placements through the part of the region the
 *   child cannot walk on, which is exactly what a derived tree line is.
 * - `TILED_GROUND` `coverage: 'COVER'` - a centred grid that covers its area
 *   edge to edge. The forest floor and the trails both need it; the default
 *   `INSIDE` would leave a bare strip at the north edge of the floor.
 *
 * Three zone ids are renamed, which ADR-025 part G already established is
 * safe (zone ids are never persisted): the hive clearing becomes
 * `wonderwild-beehive`, the id the authored interactions already name, so
 * the before/after pair resolves from requirements instead of from a branch
 * in the view. And `wonderwild-leaf-pile`, `wonderwild-night-clearing` and
 * `wonderwild-cave` gain an `:approach` suffix, because in the generic
 * runtime zone ids and entity ids share one namespace and those three zones
 * named the same thing as the prop standing in them. Nothing listens to any
 * of the three: they are authored for a phase that has not come yet.
 *
 * `adventureBindings` is empty on purpose. The forest's table is authored
 * (`wonderWallBindings.ts`) but its four carved stones are still scenery -
 * WF-3 is the phase that makes them answer the `wonder-wall` step - and
 * binding an entity nothing places is exactly what
 * `findAdventureBindingIssues` refuses.
 */

const REGION_AREA = {
  minX: -GROUND_HALF_EXTENT_X,
  maxX: GROUND_HALF_EXTENT_X,
  minZ: -GROUND_HALF_EXTENT_Z,
  maxZ: GROUND_HALF_EXTENT_Z,
};

const WAGGLE_DANCE_DISCOVERED = 'WAGGLE_DANCE_DISCOVERED';
const BUTTERFLY_GARDEN_COMPLETE = 'SAVE_THE_BUTTERFLY_GARDEN_COMPLETE';
const GLOWING_MOSS_JAR = 'glowing-moss-jar';

/** The hive clearing's zone, renamed to the id its interactions already name. */
const HIVE_ZONE_ID = 'wonderwild-beehive';
const RENAMED_ZONE_IDS: Record<string, string> = {
  'wonderwild-hive-clearing': HIVE_ZONE_ID,
  'wonderwild-leaf-pile': 'wonderwild-leaf-pile:approach',
  'wonderwild-night-clearing': 'wonderwild-night-clearing:approach',
  'wonderwild-cave': 'wonderwild-cave:approach',
};

const ZONE_SPECS: readonly ZoneSpec[] = ZONES.map((zone) => ({
  rect: { ...zone, id: RENAMED_ZONE_IDS[zone.id] ?? zone.id },
}));

/**
 * The tree line to head height, and the pond only knee-deep, exactly as
 * `wonderwildForestScene.ts` built them.
 */
const COLLIDERS: readonly ColliderSpec[] = [
  ...TREE_LINE_SEGMENTS.map((rect) => ({ rect: { ...rect }, minY: -1, maxY: 6 })),
  { rect: { ...POND_WATER }, minY: -1, maxY: 2 },
];

/** One tiled run of forest path per drawn trail rect; the fern bank's `none` trail is not drawn. */
const TRAIL_SCENERY: readonly ScenerySpec[] = TRAILS.filter(
  (trail) => trail.wear !== 'none',
).flatMap((trail) =>
  trail.rects.map((rect: RegionRect): ScenerySpec => ({
    kind: 'TILED_GROUND',
    id: `path:${rect.id}`,
    assetId: 'path-forest',
    area: { ...rect },
    tileSize: 1.5,
    coverage: 'COVER',
  })),
);

/** The four carved stones. Only the bee stone has a lit variant, which is beat 10's payoff. */
const WONDER_STONE_SCENERY: readonly ScenerySpec[] = [
  {
    kind: 'MODEL',
    id: 'stone:bee',
    assetId: 'wonder-stone-bee',
    position: { x: WONDER_STONE_SPOTS[0]!.x, y: 0, z: WONDER_STONE_SPOTS[0]!.z },
    rotation: { x: 0, y: Math.PI, z: 0 },
    requirements: [{ type: 'WORLD_CHANGE_ABSENT', changeKey: WAGGLE_DANCE_DISCOVERED }],
  },
  {
    kind: 'MODEL',
    id: 'stone:bee-lit',
    assetId: 'wonder-stone-bee-lit',
    position: { x: WONDER_STONE_SPOTS[0]!.x, y: 0, z: WONDER_STONE_SPOTS[0]!.z },
    rotation: { x: 0, y: Math.PI, z: 0 },
    requirements: [{ type: 'WORLD_CHANGE_PRESENT', changeKey: WAGGLE_DANCE_DISCOVERED }],
  },
  ...(['seed', 'sun', 'chrysalis'] as const).map((name, index): ScenerySpec => ({
    kind: 'MODEL',
    id: `stone:${name}`,
    assetId: `wonder-stone-${name}`,
    position: {
      x: WONDER_STONE_SPOTS[index + 1]!.x,
      y: 0,
      z: WONDER_STONE_SPOTS[index + 1]!.z,
    },
    rotation: { x: 0, y: Math.PI, z: 0 },
  })),
];

export const WONDERWILD_FOREST_MANIFEST: ThreeLocationManifest = {
  schemaVersion: LOCATION_MANIFEST_SCHEMA_VERSION,
  regionId: WONDERWILD_FOREST_REGION_ID,
  locationSlug: 'wonderwild-forest',
  worldSlug: HOME_WORLD_SLUG,
  title: 'Wonderwild Forest',
  version: 1,

  // No boundary walls are needed: the derived tree line runs to the ground
  // extents and closes the forest in. `wallThickness` is only used for the
  // generic boundary, which sits outside those extents.
  bounds: {
    halfExtentX: GROUND_HALF_EXTENT_X,
    halfExtentZ: GROUND_HALF_EXTENT_Z,
    wallThickness: 1,
  },

  // A canopy, not an open plot: dimmer fill and a lower sun than the bay's,
  // so the glades read brighter than the tree line between them.
  environment: {
    backgroundColor: 0x9ecfe0,
    lighting: {
      ambientIntensity: 0.55,
      sunIntensity: 0.85,
      sunPosition: { x: 6, y: 16, z: -4 },
    },
  },

  checkpoints: {
    ids: WONDERWILD_FOREST_CHECKPOINTS.map((checkpoint) => checkpoint.id),
    triggerHalfSize: 1.2,
  },

  colliders: COLLIDERS,
  buildings: [],

  scenery: [
    {
      kind: 'TILED_GROUND',
      id: 'forest-floor',
      assetId: 'ground-tile-moss',
      area: { id: 'forest-floor:area', ...REGION_AREA },
      tileSize: 4,
      coverage: 'COVER',
    },
    ...TRAIL_SCENERY,
    /*
      The tree line, as three scatters of decreasing size. Density is tuned
      against the measured tree-line area (449 m2, 48% of the region): at one
      tree per 16 m2 a child can see clean through the "wall of trees" while
      the colliders still stop them, which reads as a bug rather than as a
      forest. These seeds and spacings are the ones the forest shipped with.
    */
    {
      kind: 'SCATTER',
      id: 'tree-line',
      assetId: 'foliage-tree',
      area: { id: 'tree-line:area', ...REGION_AREA },
      spacing: 1.5,
      seed: 1337,
      clearance: 0.9,
    },
    {
      kind: 'SCATTER',
      id: 'undergrowth-bushes',
      assetId: 'foliage-bush',
      area: { id: 'undergrowth-bushes:area', ...REGION_AREA },
      spacing: 3,
      seed: 90210,
      clearance: 0.6,
    },
    {
      kind: 'SCATTER',
      id: 'undergrowth-ferns',
      assetId: 'fern',
      area: { id: 'undergrowth-ferns:area', ...REGION_AREA },
      spacing: 2.4,
      seed: 5150,
      clearance: 0.4,
    },
    // Ferns inside the fern bank too, so beat 11's moss has something to hide
    // under rather than sitting on open ground like a lamp on a lawn.
    {
      kind: 'CLUSTER',
      id: 'fern-bank-ferns',
      assetId: 'fern',
      positions: [
        { x: GLOW_MOSS_SPOT.x - 1.1, z: GLOW_MOSS_SPOT.z + 0.5 },
        { x: GLOW_MOSS_SPOT.x + 1.2, z: GLOW_MOSS_SPOT.z - 0.4 },
        { x: GLOW_MOSS_SPOT.x + 0.3, z: GLOW_MOSS_SPOT.z + 1.3 },
        { x: GLOW_MOSS_SPOT.x - 0.6, z: GLOW_MOSS_SPOT.z - 1.2 },
        { x: GLOW_MOSS_SPOT.x + 2.4, z: GLOW_MOSS_SPOT.z + 1.8 },
        { x: GLOW_MOSS_SPOT.x - 2.6, z: GLOW_MOSS_SPOT.z - 2 },
      ],
    },

    // The pond: the water itself, reeds around the shore, lily pads on top.
    {
      kind: 'FLAT_PLANE',
      id: 'pond-surface',
      color: 0x2f6f9e,
      area: { ...POND_WATER, id: 'pond-surface:area' },
      y: -0.05,
    },
    {
      kind: 'CLUSTER',
      id: 'pond-reeds',
      assetId: 'reed',
      positions: [
        { x: 5.4, z: 7.2 },
        { x: 6.2, z: 6.6 },
        { x: 13.6, z: 7.4 },
        { x: 14.2, z: 9.1 },
        { x: 5.2, z: 10.4 },
        { x: 13.9, z: 11.2 },
        { x: 7.1, z: 6.4 },
        { x: 11.8, z: 6.5 },
      ],
    },
    {
      kind: 'CLUSTER',
      id: 'pond-lily-pads',
      assetId: 'lily-pad',
      positions: [
        { x: 8.2, z: 9.1 },
        { x: 10.4, z: 8.3 },
        { x: 9.1, z: 10.4 },
        { x: 11.6, z: 10.1 },
        { x: 7.4, z: 8.2 },
      ],
    },

    // Flavour scattered through the glades.
    {
      kind: 'CLUSTER',
      id: 'mushrooms',
      assetId: 'mushroom-cluster',
      positions: [
        { x: -10.5, z: 6.4 },
        { x: -9.2, z: 10.6 },
        { x: -13.4, z: -6.2 },
        { x: 9.8, z: -8.4 },
        { x: -3.2, z: -9.6 },
        { x: 12.4, z: 2.8 },
      ],
    },
    {
      kind: 'CLUSTER',
      id: 'fallen-logs',
      assetId: 'log-fallen',
      positions: [
        { x: -12.5, z: 9.6, rotationY: 0.4 },
        { x: 3.2, z: -2.6, rotationY: 1.9 },
        { x: 10.8, z: -3.1, rotationY: 0.8 },
        { x: -9.6, z: -10.4, rotationY: 2.6 },
      ],
    },

    /*
      The night clearing's ring, minus its first stone: that one is a prop,
      because it is what the child's reticle reads the clearing by. The old
      scene instanced all five and then placed an invisible sixth copy over
      the first as its raycast target; one real stone in its place is the
      same picture with one fewer object.
    */
    {
      kind: 'CLUSTER',
      id: 'night-stone-ring',
      assetId: 'standing-stone',
      positions: NIGHT_STONE_SPOTS.slice(1).map((spot, index) => ({
        x: spot.x,
        z: spot.z,
        rotationY: (index + 1) * 0.7,
      })),
    },
    // The stone Chatty sits on, so they are perched rather than hovering.
    {
      kind: 'CLUSTER',
      id: 'chatty-perch-stone',
      assetId: 'standing-stone',
      positions: [{ x: CHATTY_PERCH_SPOT.x, z: CHATTY_PERCH_SPOT.z }],
    },

    ...WONDER_STONE_SCENERY,

    /*
      Chatty on the low centre stone: the narration anchor for a step list
      that is mostly `NARRATIVE`. Not an NPC, no conversation, and it never
      follows the child (storyboard section 9), so it is scenery that
      breathes rather than an NPC placement.
    */
    {
      kind: 'MODEL',
      id: 'chatty-perched',
      assetId: 'companion-chatty',
      position: { x: CHATTY_PERCH_SPOT.x, y: 0.55, z: CHATTY_PERCH_SPOT.z },
      rotation: { x: 0, y: Math.PI, z: 0 },
      idleClip: 'Idle',
    },

    // The hive clearing: the trunk the hive hangs on, and the bare patch
    // beside the worn trail that beat 10 fills with flowers.
    {
      kind: 'MODEL',
      id: 'hive-trunk',
      assetId: 'foliage-tree',
      position: { x: HIVE_TRUNK_SPOT.x, y: 0, z: HIVE_TRUNK_SPOT.z },
    },
    {
      kind: 'MODEL',
      id: 'flower-patch-bare',
      assetId: 'flower-patch-bare',
      position: { x: FLOWER_PATCH_SPOT.x, y: 0, z: FLOWER_PATCH_SPOT.z },
      requirements: [{ type: 'WORLD_CHANGE_ABSENT', changeKey: WAGGLE_DANCE_DISCOVERED }],
    },
    {
      kind: 'MODEL',
      id: 'flower-patch-bloomed',
      assetId: 'flower-patch-bloomed',
      position: { x: FLOWER_PATCH_SPOT.x, y: 0, z: FLOWER_PATCH_SPOT.z },
      requirements: [{ type: 'WORLD_CHANGE_PRESENT', changeKey: WAGGLE_DANCE_DISCOVERED }],
    },

    // The way back to Welcome Harbor, visible from inside.
    {
      kind: 'MODEL',
      id: 'harbor-signpost',
      assetId: 'signpost',
      position: { x: -16.9, y: 0, z: 0 },
      rotation: { x: 0, y: Math.PI / 2, z: 0 },
    },
  ],

  npcs: [],

  props: [
    {
      entityId: 'wonderwild-beehive-peek',
      assetId: 'beehive',
      position: { x: BEEHIVE_SPOT.x, z: BEEHIVE_SPOT.z },
      rotationY: Math.PI / 2,
      label: 'Peek at the hive',
      interactionId: 'wonderwild-beehive-peek',
    },
    {
      entityId: 'wonderwild-pond-frog',
      assetId: 'frog',
      position: { x: POND_FROG_SPOT.x, z: POND_FROG_SPOT.z },
      rotationY: Math.PI,
      label: 'A quiet pond',
      interactionId: 'wonderwild-pond-frog',
    },
    {
      entityId: 'wonderwild-leaf-pile',
      assetId: 'leaf-pile',
      position: { x: LEAF_PILE_SPOT.x, z: LEAF_PILE_SPOT.z },
      label: 'A pile of leaves',
      interactionId: 'wonderwild-leaf-pile',
    },
    {
      entityId: 'wonderwild-night-clearing',
      assetId: 'standing-stone',
      position: { x: NIGHT_STONE_SPOTS[0]!.x, z: NIGHT_STONE_SPOTS[0]!.z },
      label: 'A quiet clearing',
      interactionId: 'wonderwild-night-clearing',
    },
    /*
      The cave mouth, dark or lit, as two props sharing one interaction: the
      jar of glowing moss hidden in this same forest is what lights it. The
      Discovery Engine still owns whether the cave opens and what it says in
      either case (`wonderwild-glowworm-cave`); this is only what the child
      sees standing in front of it.
    */
    {
      entityId: 'wonderwild-cave',
      assetId: 'cave-mouth',
      position: { x: CAVE_MOUTH_SPOT.x, z: CAVE_MOUTH_SPOT.z },
      label: 'A shadowy cave',
      interactionId: 'wonderwild-cave',
      requirements: [{ type: 'ITEM_ABSENT', itemId: GLOWING_MOSS_JAR }],
    },
    {
      entityId: 'wonderwild-cave-lit',
      assetId: 'cave-mouth-lit',
      position: { x: CAVE_MOUTH_SPOT.x, z: CAVE_MOUTH_SPOT.z },
      label: 'A shadowy cave',
      interactionId: 'wonderwild-cave',
      requirements: [{ type: 'ITEM_OWNED', itemId: GLOWING_MOSS_JAR }],
    },
    // `wonderwild-glow-moss` is the walk-in zone's id, so the moss itself
    // takes a `-patch` entity id and both routes open the same interaction.
    {
      entityId: 'wonderwild-glow-moss-patch',
      assetId: 'glow-moss',
      position: { x: GLOW_MOSS_SPOT.x, z: GLOW_MOSS_SPOT.z },
      label: 'A green light under the ferns',
      interactionId: 'wonderwild-glow-moss',
    },
    {
      entityId: 'wonderwild-butterfly',
      assetId: 'butterfly',
      position: { x: BUTTERFLY_SPOT.x, z: BUTTERFLY_SPOT.z },
      label: 'A visiting butterfly',
      interactionId: 'wonderwild-butterfly',
      requirements: [{ type: 'WORLD_CHANGE_PRESENT', changeKey: BUTTERFLY_GARDEN_COMPLETE }],
    },
  ],

  collectibles: [],
  zones: ZONE_SPECS,
  ambient: [],

  // The same authored interactions the card-based forest uses, unchanged.
  interactions: WONDERWILD_FOREST_INTERACTIONS,

  adventureBindings: [],
  extensions: [],

  copy: {
    loading: 'Loading Wonderwild Forest...',
    instructions:
      'Move: WASD or the arrow keys. Look: click the screen, then move your mouse (or drag with two fingers on a touch screen: left side to move, right side to look). Walk up to something and press E, or use the button below, to interact with it.',
    altNav: {
      label: 'Prefer not to walk in 3D? Use the location page instead',
      to: 'locations/wonderwild-forest',
    },
  },
};
