import { FOSSIL_RIDGE_CAMP_INTERACTIONS } from '../../../worldObjects';
import { HOME_WORLD_SLUG } from '../../../../worlds/slugs';
import {
  CAMP_TENT,
  CAMP_TRAIL,
  DIG_PITS,
  DIG_TOOLS,
  FOSSIL_RIDGE_CAMP_CHECKPOINTS,
  FOSSIL_RIDGE_CAMP_REGION_ID,
  GROUND_HALF_EXTENT_X,
  GROUND_HALF_EXTENT_Z,
  HARBOR_EXIT_ZONE,
  PIT_ROPE_HEIGHT,
  RIDGE_BOULDERS,
  RIDGE_FACES,
  SKELETON_DISPLAY,
  SKELETON_PLACARD,
  solidFootprints,
  type Rect,
} from '../../fossilRidgeCampRegion';
import {
  LOCATION_MANIFEST_SCHEMA_VERSION,
  type ColliderSpec,
  type ScenerySpec,
  type ThreeLocationManifest,
} from '../locationManifest';

/**
 * Fossil Ridge Camp as a manifest (LAI-2206), built from
 * `fossilRidgeCampRegion.ts`. The interactions are the Phaser camp's own
 * `FOSSIL_RIDGE_CAMP_INTERACTIONS`, by identity, so the two routes cannot
 * drift (ADR-020: the Phaser camp gains nothing).
 *
 * Not built yet, on purpose:
 * - The exit still navigates to `world`, as the Phaser exit does. Pointing it
 *   at the 3D Welcome Harbor waits for the 3D hub (LAI-2201).
 * - The skeleton, tent and ridge are placeholder boxes until LAI 07's models;
 *   the skeleton's interactive prop is a bundled signpost standing in as its placard.
 * - The Sprouts guided route waits for LAI-2104S step B1; nothing here needs
 *   to change for it, because the camp is flat and every collider is solid.
 *
 * `entryRequirements` is the Phaser view's direct-URL guard: a child who has
 * not finished the dinosaur mystery sees the same calm "not discovered yet"
 * message and a way back to the map, never the scene.
 */

export const DINOSAUR_EXPEDITION_COMPLETE = 'DINOSAUR_EXPEDITION_COMPLETE';

const SAND = 0xd9bf8c;
const TRAIL = 0xb89a6a;
const BONE = 0xece2c6;
const PLINTH = 0x9c7a52;
const PIT_FLOOR = 0x6e5536;
const ROPE = 0xc9a24a;
const ROCK = 0x8a7258;
const CANVAS = 0x8c9a6a;

const area = (rect: Rect, suffix: string) => ({ ...rect, id: `${rect.id}:${suffix}` });

/** A box from `minY` to `maxY` over a rect centred on `x`, `z`. */
function box(
  id: string,
  color: number,
  x: number,
  z: number,
  halfX: number,
  halfZ: number,
  minY: number,
  maxY: number,
): ScenerySpec {
  return {
    kind: 'BOX',
    id,
    color,
    area: { id: `${id}:area`, minX: x - halfX, maxX: x + halfX, minZ: z - halfZ, maxZ: z + halfZ },
    minY,
    maxY,
    static: true,
  };
}

/** Colliders: every footprint solid at every height. None is jumpable. */
const COLLIDERS: readonly ColliderSpec[] = solidFootprints().map((rect) => {
  const face = RIDGE_FACES.find((candidate) => `collider:${candidate.id}` === rect.id);
  return { rect, minY: 0, maxY: face?.height ?? 4 };
});

/**
 * The skeleton as stand-in boxes on its plinth: a giant plant eater with a
 * long neck to the east and its tail to the west. Placeholder until LAI 07.
 */
function skeletonScenery(): ScenerySpec[] {
  const { x, z, halfWidth, halfDepth, plinthHeight } = SKELETON_DISPLAY;
  const top = plinthHeight;
  return [
    box('skeleton:plinth', PLINTH, x, z, halfWidth, halfDepth, 0, top),
    box('skeleton:body', BONE, x, z, 1.5, 0.6, top + 1.2, top + 2.4),
    box('skeleton:leg-front-left', BONE, x + 1.1, z - 0.4, 0.2, 0.2, top, top + 1.2),
    box('skeleton:leg-front-right', BONE, x + 1.1, z + 0.4, 0.2, 0.2, top, top + 1.2),
    box('skeleton:leg-back-left', BONE, x - 1.1, z - 0.4, 0.2, 0.2, top, top + 1.2),
    box('skeleton:leg-back-right', BONE, x - 1.1, z + 0.4, 0.2, 0.2, top, top + 1.2),
    box('skeleton:neck', BONE, x + 1.9, z, 0.4, 0.25, top + 2.0, top + 2.8),
    box('skeleton:head', BONE, x + 2.7, z, 0.45, 0.3, top + 2.6, top + 3.2),
    box('skeleton:tail', BONE, x - 2.4, z, 0.9, 0.2, top + 1.5, top + 2.0),
  ];
}

/** A pit: its dark floor and a low rope barrier on all four sides. */
function pitScenery(pit: Rect): ScenerySpec[] {
  const t = 0.05;
  const cx = (pit.minX + pit.maxX) / 2;
  const cz = (pit.minZ + pit.maxZ) / 2;
  const hx = (pit.maxX - pit.minX) / 2;
  const hz = (pit.maxZ - pit.minZ) / 2;
  return [
    {
      kind: 'FLAT_PLANE',
      id: `${pit.id}:floor`,
      color: PIT_FLOOR,
      area: area(pit, 'floor:area'),
      y: 0.02,
    },
    box(`${pit.id}:rope-north`, ROPE, cx, pit.minZ, hx, t, PIT_ROPE_HEIGHT - 0.1, PIT_ROPE_HEIGHT),
    box(`${pit.id}:rope-south`, ROPE, cx, pit.maxZ, hx, t, PIT_ROPE_HEIGHT - 0.1, PIT_ROPE_HEIGHT),
    box(`${pit.id}:rope-west`, ROPE, pit.minX, cz, t, hz, PIT_ROPE_HEIGHT - 0.1, PIT_ROPE_HEIGHT),
    box(`${pit.id}:rope-east`, ROPE, pit.maxX, cz, t, hz, PIT_ROPE_HEIGHT - 0.1, PIT_ROPE_HEIGHT),
  ];
}

const SCENERY: readonly ScenerySpec[] = [
  {
    kind: 'FLAT_PLANE',
    id: 'camp-floor',
    color: SAND,
    area: {
      id: 'camp-floor:area',
      minX: -GROUND_HALF_EXTENT_X,
      maxX: GROUND_HALF_EXTENT_X,
      minZ: -GROUND_HALF_EXTENT_Z,
      maxZ: GROUND_HALF_EXTENT_Z,
    },
    y: 0,
  },
  { kind: 'FLAT_PLANE', id: 'camp-trail', color: TRAIL, area: area(CAMP_TRAIL, 'area'), y: 0.01 },
  ...RIDGE_FACES.map((face): ScenerySpec => ({
    kind: 'BOX',
    id: `${face.id}:face`,
    color: ROCK,
    area: area(face, 'face:area'),
    minY: 0,
    maxY: face.height,
    static: true,
  })),
  {
    kind: 'CLUSTER',
    id: 'ridge-boulders',
    assetId: 'rock',
    positions: RIDGE_BOULDERS.map((boulder, index) => ({
      x: boulder.x,
      z: boulder.z,
      rotationY: index * 1.1,
    })),
  },
  ...skeletonScenery(),
  ...DIG_PITS.flatMap(pitScenery),
  box(
    'camp-tent',
    CANVAS,
    CAMP_TENT.x,
    CAMP_TENT.z,
    CAMP_TENT.halfWidth,
    CAMP_TENT.halfDepth,
    0,
    CAMP_TENT.height,
  ),
  // The way back to Welcome Harbor, visible from inside.
  {
    kind: 'MODEL',
    id: 'harbor-signpost',
    assetId: 'signpost',
    position: { x: -15, y: 0, z: 2.6 },
    rotation: { x: 0, y: Math.PI / 2, z: 0 },
  },
];

export const FOSSIL_RIDGE_CAMP_MANIFEST: ThreeLocationManifest = {
  schemaVersion: LOCATION_MANIFEST_SCHEMA_VERSION,
  regionId: FOSSIL_RIDGE_CAMP_REGION_ID,
  locationSlug: 'fossil-ridge-camp',
  worldSlug: HOME_WORLD_SLUG,
  title: 'Fossil Ridge Camp',
  version: 1,

  bounds: {
    halfExtentX: GROUND_HALF_EXTENT_X,
    halfExtentZ: GROUND_HALF_EXTENT_Z,
    wallThickness: 1,
  },

  // A warm, dry afternoon at the dig site.
  environment: {
    backgroundColor: 0xf0d9a8,
    lighting: { ambientIntensity: 0.65, sunIntensity: 0.9 },
  },

  checkpoints: {
    ids: FOSSIL_RIDGE_CAMP_CHECKPOINTS.map((checkpoint) => checkpoint.id),
    triggerHalfSize: 1.5,
  },

  colliders: COLLIDERS,
  buildings: [],
  scenery: SCENERY,
  npcs: [],

  props: [
    // The skeleton's display placard (a bundled signpost until LAI 07's
    // skeleton model): the placeholder skeleton itself is scenery boxes.
    {
      entityId: SKELETON_DISPLAY.entityId,
      assetId: 'signpost',
      position: { x: SKELETON_PLACARD.x, z: SKELETON_PLACARD.z },
      label: SKELETON_DISPLAY.label,
      action: 'Look',
      interactionId: 'meet-the-fossil',
    },
    {
      entityId: DIG_TOOLS.entityId,
      assetId: 'toolbox',
      position: { x: DIG_TOOLS.x, z: DIG_TOOLS.z },
      rotationY: -Math.PI / 4,
      label: DIG_TOOLS.label,
      action: 'Look',
      interactionId: 'fossil-ridge-dig-tools',
    },
  ],

  collectibles: [],
  zones: [{ rect: { ...HARBOR_EXIT_ZONE } }],
  ambient: [],

  // Young visitors need not aim: the nearest thing ahead takes focus.
  interactionAssist: true,

  interactions: FOSSIL_RIDGE_CAMP_INTERACTIONS,
  entryRequirements: [{ type: 'WORLD_CHANGE_PRESENT', changeKey: DINOSAUR_EXPEDITION_COMPLETE }],
  adventureBindings: [],
  extensions: [],

  copy: {
    loading: 'Loading Fossil Ridge Camp...',
    instructions:
      'Move: WASD or the arrow keys. Look: click the screen, then move your mouse (or drag with two fingers on a touch screen: left side to move, right side to look). Walk up to something and press E, or tap the button that appears, to look closer.',
    statusLines: [{ text: 'A huge assembled skeleton stands proudly at the ridge.' }],
    altNav: {
      label: 'Prefer not to walk? Use the location page instead',
      to: 'locations/fossil-ridge-camp',
    },
    locked:
      'This part of the island has not been discovered yet. Maybe a new story will lead you here.',
  },
};
