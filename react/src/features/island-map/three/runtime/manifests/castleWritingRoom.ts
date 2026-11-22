import { HOME_WORLD_SLUG } from '../../../../worlds/slugs';
import {
  CASTLE_WRITING_ROOM_CHECKPOINTS,
  CASTLE_WRITING_ROOM_REGION_ID,
} from '../../../../discovery/checkpoints';
import {
  CASTLE_WRITING_ROOM_3D_INTERACTIONS,
  CASTLE_WRITING_ROOM_INTERACTIONS,
} from '../../../worldObjects';
import {
  INTERACTIVE_BOOKSHELF_SPOT,
  WRITING_DESK_SPOT,
  WRITING_ROOM_CORNERS,
  WRITING_ROOM_DOOR_SPOT,
  WRITING_ROOM_EXIT_ZONE,
  WRITING_ROOM_HALF_EXTENT,
  WRITING_ROOM_SHELVES,
  WRITING_ROOM_SHELF_COLLIDERS,
  WRITING_ROOM_STEP_COLOR,
  WRITING_ROOM_STEP_HEIGHT,
  WRITING_ROOM_STEP_SIZE,
  WRITING_ROOM_STEP_SPOTS,
  WRITING_ROOM_OPEN_BOOK_SPOT,
  WRITING_ROOM_QUILL_COLLIDER_HALF,
  WRITING_ROOM_QUILL_SPOT,
  WRITING_ROOM_WALL_HEIGHT,
  WRITING_ROOM_WINDOW,
  WRITING_ROOM_WINDOW_LIGHT,
} from '../../castleWritingRoomRegion';
import type { PlatformingSpec } from '../../platforms/platformSpec';
import {
  LOCATION_MANIFEST_SCHEMA_VERSION,
  type ColliderSpec,
  type MaterialPresetSpec,
  type PropSpec,
  type ScenerySpec,
  type SurfaceSpec,
  type ThreeLocationManifest,
} from '../locationManifest';
import { box, rect, solid } from './castleRooms/castleVisualKit';

/**
 * The Writing Room as a manifest (SC-R10-01), the Three.js twin of the Phaser
 * `CastleWritingRoomWorldView`, served at `explore/castle-writing-room`.
 *
 * Parity is by construction: the original interactions are the very array the Phaser
 * view reads (`CASTLE_WRITING_ROOM_INTERACTIONS`), never a copy, so ids, titles, messages and
 * requirements cannot drift. SC-final-B adds, for this renderer only (ADR-020: Phaser gains
 * nothing), `CASTLE_WRITING_ROOM_3D_INTERACTIONS`: the open book on the desk (the optional
 * write-your-story activity, which runs in React) and Keeper Quill, who is placed here always,
 * as he is in the castle. The room has no entry requirement: it is open to every child (the old
 * Secret Door gate had an arithmetic step). It has no progress event and no world change.
 *
 * Reuses the castle's own models (`writing-desk`, `bookshelf`, `round-window`,
 * `secret-door-ajar`); a missing model falls back to the engine placeholder.
 * Two optional low steps under the window use the shared platforms runtime
 * (tops 0.3 m, never required, nothing gated on them).
 */

const SOLID_HEIGHT = 2.2;
const CORNER_COLOUR = 0xcdb89a;

const MATERIALS: readonly MaterialPresetSpec[] = [
  {
    id: 'writing-room-carpet',
    pattern: 'CARPET',
    baseColor: 0x8c3a4a,
    accentColor: 0x6b2a38,
    roughness: 0.95,
    metersPerRepeat: 1.5,
    seed: 31,
  },
  {
    id: 'writing-room-plaster',
    pattern: 'PLASTER',
    baseColor: 0xe6d3b0,
    roughness: 0.9,
    metersPerRepeat: 2,
    seed: 32,
  },
  {
    id: 'writing-room-ceiling',
    pattern: 'PLASTER',
    baseColor: 0xcdb89a,
    roughness: 0.9,
    metersPerRepeat: 2,
    seed: 33,
  },
];

const H = WRITING_ROOM_HALF_EXTENT;
const INSET = 0.02;
const FACE_DEPTH = 0.01;
const FLOOR_AREA = { id: 'writing-room-floor:area', minX: -H, maxX: H, minZ: -H, maxZ: H };

const SURFACES: readonly SurfaceSpec[] = [
  {
    id: 'writing-room-floor',
    materialId: 'writing-room-carpet',
    faces: [{ kind: 'FLOOR', area: FLOOR_AREA, y: 0.01 }],
  },
  {
    id: 'writing-room-ceiling',
    materialId: 'writing-room-ceiling',
    faces: [
      {
        kind: 'CEILING',
        area: { ...FLOOR_AREA, id: 'writing-room-ceiling:area' },
        y: WRITING_ROOM_WALL_HEIGHT,
      },
    ],
  },
  {
    id: 'writing-room-walls',
    materialId: 'writing-room-plaster',
    faces: [
      {
        kind: 'WALL',
        area: rect('writing-room-wall:north', -H, H, H - INSET, H - INSET + FACE_DEPTH),
        minY: 0,
        maxY: WRITING_ROOM_WALL_HEIGHT,
        sides: ['south'],
      },
      {
        kind: 'WALL',
        area: rect('writing-room-wall:south', -H, H, -H + INSET - FACE_DEPTH, -H + INSET),
        minY: 0,
        maxY: WRITING_ROOM_WALL_HEIGHT,
        sides: ['north'],
      },
      {
        kind: 'WALL',
        area: rect('writing-room-wall:east', H - INSET, H - INSET + FACE_DEPTH, -H, H),
        minY: 0,
        maxY: WRITING_ROOM_WALL_HEIGHT,
        sides: ['west'],
      },
      {
        kind: 'WALL',
        area: rect('writing-room-wall:west', -H + INSET - FACE_DEPTH, -H + INSET, -H, H),
        minY: 0,
        maxY: WRITING_ROOM_WALL_HEIGHT,
        sides: ['east'],
      },
    ],
  },
];

const COLLIDERS: readonly ColliderSpec[] = [
  solid(
    'writing-room-desk',
    WRITING_DESK_SPOT.x - WRITING_DESK_SPOT.halfX,
    WRITING_DESK_SPOT.x + WRITING_DESK_SPOT.halfX,
    WRITING_DESK_SPOT.z - WRITING_DESK_SPOT.halfZ,
    WRITING_DESK_SPOT.z + WRITING_DESK_SPOT.halfZ,
    WRITING_DESK_SPOT.height,
  ),
  // Keeper Quill stands solid, like the castle's: walking through the person you are about to talk to undoes the point.
  solid(
    'collider:keeper-quill',
    WRITING_ROOM_QUILL_SPOT.x - WRITING_ROOM_QUILL_COLLIDER_HALF,
    WRITING_ROOM_QUILL_SPOT.x + WRITING_ROOM_QUILL_COLLIDER_HALF,
    WRITING_ROOM_QUILL_SPOT.z - WRITING_ROOM_QUILL_COLLIDER_HALF,
    WRITING_ROOM_QUILL_SPOT.z + WRITING_ROOM_QUILL_COLLIDER_HALF,
    2,
  ),
  ...WRITING_ROOM_SHELF_COLLIDERS.map((shelf) => ({
    rect: { ...shelf },
    minY: 0,
    maxY: SOLID_HEIGHT,
  })),
  // The four cut corners that make the square room read as round.
  ...WRITING_ROOM_CORNERS.map((corner) =>
    solid(corner.id, corner.minX, corner.maxX, corner.minZ, corner.maxZ, WRITING_ROOM_WALL_HEIGHT),
  ),
];

const SCENERY: readonly ScenerySpec[] = [
  ...WRITING_ROOM_CORNERS.map((corner) =>
    box(
      `writing-room-${corner.id}`,
      CORNER_COLOUR,
      corner.minX,
      corner.maxX,
      corner.minZ,
      corner.maxZ,
      0,
      WRITING_ROOM_WALL_HEIGHT,
    ),
  ),
  {
    kind: 'CLUSTER',
    id: 'writing-room-shelves',
    assetId: 'bookshelf',
    positions: WRITING_ROOM_SHELVES.map((shelf) => ({
      x: shelf.x,
      z: shelf.z,
      rotationY: shelf.rotationY,
    })),
  },
  // The secret door, ajar: the way back into the castle. Decoration; the exit is a zone.
  {
    kind: 'MODEL',
    id: 'writing-room-secret-door',
    assetId: 'secret-door-ajar',
    position: { x: WRITING_ROOM_DOOR_SPOT.x, y: 0, z: WRITING_ROOM_DOOR_SPOT.z },
    rotation: { x: 0, y: WRITING_ROOM_DOOR_SPOT.rotationY, z: 0 },
  },
  {
    kind: 'MODEL',
    id: 'writing-room-window',
    assetId: 'round-window',
    position: { x: WRITING_ROOM_WINDOW.x, y: WRITING_ROOM_WINDOW.y, z: WRITING_ROOM_WINDOW.z },
    rotation: { x: 0, y: WRITING_ROOM_WINDOW.rotationY, z: 0 },
    anchor: 'CENTRE',
  },
];

/** The desk and the one shelf that answers a tap, both with the shared interactions. */
const PROPS: readonly PropSpec[] = [
  {
    entityId: 'writing-room-desk',
    assetId: 'writing-desk',
    position: { x: WRITING_DESK_SPOT.x, z: WRITING_DESK_SPOT.z },
    label: 'The writing desk',
    interactionId: 'writing-room-desk',
    placeholderSize: { width: 1.4, height: 0.9, depth: 0.9 },
  },
  /*
    The open book on the desk: tapping it opens the write-your-story activity. Optional and
    never required. It reuses the castle's existing `clue-diary` model (no new asset); a
    dedicated open-book model can replace it later by changing this one id.
  */
  {
    entityId: 'writing-room-open-book',
    assetId: 'clue-diary',
    position: { x: WRITING_ROOM_OPEN_BOOK_SPOT.x, z: WRITING_ROOM_OPEN_BOOK_SPOT.z },
    elevation: WRITING_ROOM_OPEN_BOOK_SPOT.elevation,
    label: 'An open book',
    action: 'Write',
    interactionId: 'writing-room-write-story',
    placeholderSize: { width: 0.45, height: 0.06, depth: 0.32 },
  },
  {
    entityId: 'writing-room-bookshelf',
    assetId: 'bookshelf',
    position: { x: INTERACTIVE_BOOKSHELF_SPOT.x, z: INTERACTIVE_BOOKSHELF_SPOT.z },
    rotationY: INTERACTIVE_BOOKSHELF_SPOT.rotationY,
    label: 'Shelves of empty books',
    interactionId: 'writing-room-bookshelf',
    placeholderSize: { width: 1.8, height: 2, depth: 0.4 },
  },
];

/**
 * Two optional reading steps under the window. Static, jumpable, 0.3 m: a
 * child can ignore them, stand on them, or miss one and land on the floor.
 * No zone, no signal, no requirement: nothing depends on them. Sprouts get
 * none, so a three-year-old meets no obstacle they cannot step over.
 */
const PLATFORMING: PlatformingSpec = {
  platforms: WRITING_ROOM_STEP_SPOTS.map((spot) => ({
    id: spot.id,
    color: WRITING_ROOM_STEP_COLOR,
    size: {
      width: WRITING_ROOM_STEP_SIZE,
      height: WRITING_ROOM_STEP_HEIGHT,
      depth: WRITING_ROOM_STEP_SIZE,
    },
    position: { x: spot.x, y: 0, z: spot.z },
  })),
};

export const CASTLE_WRITING_ROOM_MANIFEST: ThreeLocationManifest = {
  schemaVersion: LOCATION_MANIFEST_SCHEMA_VERSION,
  regionId: CASTLE_WRITING_ROOM_REGION_ID,
  locationSlug: 'castle-writing-room',
  worldSlug: HOME_WORLD_SLUG,
  title: 'The Writing Room',
  version: 1,

  bounds: { halfExtentX: H, halfExtentZ: H, wallThickness: 1 },

  // Warm and quiet: one window, a lamp over the desk, no sun.
  environment: {
    backgroundColor: 0x2b1d2a,
    lighting: { ambientIntensity: 0.7, sunIntensity: 0.15 },
  },

  checkpoints: {
    ids: CASTLE_WRITING_ROOM_CHECKPOINTS.map((checkpoint) => checkpoint.id),
    triggerHalfSize: 1.5,
  },

  colliders: COLLIDERS,
  buildings: [],
  scenery: SCENERY,
  npcs: [
    {
      entityId: 'keeper-quill',
      npcId: 'keeper-quill',
      assetId: 'npc-quill',
      position: { x: WRITING_ROOM_QUILL_SPOT.x, z: WRITING_ROOM_QUILL_SPOT.z },
      yaw: WRITING_ROOM_QUILL_SPOT.yaw,
      label: 'Keeper Quill',
      idleClip: 'Idle',
      placeholderColor: 0x4a5b8c,
      interactionId: 'writing-room-talk-to-quill',
    },
  ],
  props: PROPS,
  collectibles: [],

  zones: [{ rect: { ...WRITING_ROOM_EXIT_ZONE } }],

  lights: [
    {
      id: 'light:writing-room-window',
      kind: 'POINT',
      position: { ...WRITING_ROOM_WINDOW_LIGHT },
      color: 0xffe2a8,
      intensity: 4,
      decay: 1.8,
      priority: 6,
    },
    {
      id: 'light:writing-room-lamp',
      kind: 'POINT',
      position: { x: 2.5, y: 2.4, z: -1 },
      color: 0xffd080,
      intensity: 3,
      decay: 1.8,
      priority: 5,
    },
  ],
  materials: MATERIALS,
  surfaces: SURFACES,
  effects: [
    {
      kind: 'MOTES',
      id: 'writing-room-motes',
      area: rect('writing-room-motes:area', -3.5, 3.5, -3.5, 3.5),
      minY: 0.3,
      maxY: 2.6,
      color: 0xfff0c8,
      count: 20,
      size: 0.04,
      seed: 41,
    },
  ],
  ambient: [],

  // The very array the Phaser view reads, plus this renderer's own two (the open book, Quill).
  interactions: [...CASTLE_WRITING_ROOM_INTERACTIONS, ...CASTLE_WRITING_ROOM_3D_INTERACTIONS],
  // No `entryRequirements`: open to every child (SC-final-B).
  adventureBindings: [],
  extensions: [],

  copy: {
    loading: 'Loading the Writing Room...',
    instructions:
      'Move: WASD or the arrow keys. Look: click the screen, then move your mouse (or drag with two fingers on a touch screen: left side to move, right side to look). Tap the open book to write a story, tap Keeper Quill to talk, or use the buttons below.',
    statusLines: [
      { text: 'The Writing Room is quiet. The open book on the desk is waiting for your story.' },
    ],
    checkpointToasts: {
      found: 'You found {checkpoint}.',
      returning: 'You are back at {checkpoint}.',
    },
    altNav: {
      label: 'Prefer not to walk in 3D? Use the location page instead',
      to: 'locations/castle-writing-room',
    },
  },

  platforming: PLATFORMING,
  /*
    Sprouts get flat markers where the steps are (SC-final-B), like the castle's: nothing to jump on
    and no collider, so a three-year-old meets no obstacle, but the same spots still read as a place
    to stand and look at the window.
  */
  platformingByBand: {
    SPROUT: {
      platforms: [],
      pressurePlates: WRITING_ROOM_STEP_SPOTS.map((spot) => ({
        id: spot.id.replace('writing-room-step:', 'writing-room-marker:'),
        position: { x: spot.x, z: spot.z },
        halfSize: WRITING_ROOM_STEP_SIZE / 2,
        color: WRITING_ROOM_STEP_COLOR,
      })),
    },
  },
};
