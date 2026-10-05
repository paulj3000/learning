import { STORYKEEPER_CASTLE_INTERACTIONS } from '../../../worldObjects';
import { HOME_WORLD_SLUG } from '../../../../worlds/slugs';
import {
  STORYKEEPER_CASTLE_CHECKPOINTS,
  STORYKEEPER_CASTLE_REGION_ID,
} from '../../../../discovery/checkpoints';
import { CASTLE_CHOICE_BINDINGS } from '../../castleChoiceBindings';
import { WALL_HEIGHT } from '../../sceneKit';
import {
  ARCHWAYS,
  BINDING_LECTERN_SPOT,
  BINDING_TABLE_SPOT,
  CASTLE_DOORS_SPOT,
  COUNTING_STAR_SPOTS,
  GALLERY_FILLER_FRAME_SPOTS,
  GALLERY_PORTRAIT_SPOTS,
  HEARTH_SPOT,
  KEEPER_QUILL_ID,
  KEEPER_QUILL_SPOT,
  LAST_BOOKSHELF_SPOT,
  LIBRARY_BOOKSHELF_SPOTS,
  LIBRARY_CLUE_SPOTS,
  LIBRARY_CLUE_WALL_SPOT,
  LIBRARY_READING_TABLE_SPOTS,
  LIBRARY_SHELF_SLOT_SPOT,
  LOCK_CARVING_SPOTS,
  LOCK_ROD_RACK_SPOT,
  LOCK_ROD_SPOTS,
  QUILL_LECTERN_SPOT,
  ROOMS,
  SECRET_DOOR_SPOT,
  STORY_PLATE_SPOTS,
  STUDIO_EASEL_SPOT,
  TAPESTRY_NOOK_CUSHION_SPOTS,
  TAPESTRY_SPOTS,
  TOWER_WINDOW_SPOTS,
  WALL_SEGMENTS,
  WALL_THICKNESS,
  ZONES,
  type RectZone,
  type RoomSide,
  type WallMountedSpot,
} from '../../storykeeperCastleRegion';
import { facingIntoRoom, wallPanelPlacements } from '../sceneLayout';
import {
  LOCATION_MANIFEST_SCHEMA_VERSION,
  type ClusterPosition,
  type ColliderSpec,
  type LightSpec,
  type PropSpec,
  type ScenerySpec,
  type ThreeLocationManifest,
} from '../locationManifest';

/**
 * Storykeeper Castle as a manifest (engine roadmap Phase 9, ADR-025 part J),
 * built from `storykeeperCastleRegion.ts`'s own constants.
 *
 * The castle is the last region to migrate and the only one whose bespoke
 * part was *behaviour* rather than art: an in-world adventure host, a story
 * host, three seating puzzles, a composite easel, a carried plate, an NPC
 * gesture director. All of that lives behind the `castle-tale` extension's
 * two halves. What is here is everything that turned out to be ordinary
 * once the generic runtime could say it:
 *
 * - **Rooms.** Interior walls are derived from room floors minus archway
 *   gaps by the region module (`buildWallSegments`), so they arrive here as
 *   plain collider rects, and their panels come from the generic
 *   `wallPanelPlacements` - each room drawing its own face, each panel
 *   scaled to its segment so a run can never creep across a doorway.
 * - **Light.** One lamp per room at ceiling height, the daylight through the
 *   west doors, and the hearth: `lights`, where the per-region scene used to
 *   place its own.
 * - **Every zone and every interaction, unchanged.** The castle's authored
 *   interactions (`STORYKEEPER_CASTLE_INTERACTIONS`) already carry the
 *   requirements its view used to branch on - `castle-story-hall` while no
 *   story is told and `castle-story-hall-told` after, the secret door while
 *   the arc is unfinished and the open bookshelf after - so the view's
 *   `if (zoneId === ...)` chain is simply gone.
 * - **Its binding table.** `adventureBindings` is Phase 8's vocabulary, and
 *   the castle is the region it was written for: three portraits, three
 *   windows and three plates standing for the options of five steps across
 *   two adventures. The table moves here from `castleChoiceBindings.ts`
 *   unchanged, which is what that phase promised.
 *
 * Two deliberate differences from the per-region scene, both cosmetic and
 * both recorded in `docs/IMPLEMENTATION_STATUS.md`: Keeper Quill's
 * stand-in box is the runtime's size rather than the castle's own, and the
 * costume racks the region authors are still unplaced (they were never
 * placed by the old scene either).
 */

const STORY_TOLD = 'FIRST_STORY_TOLD';
const SLAB_SIZE_METERS = 4;
const FLOOR_SLAB_TOP_OFFSET = -0.05;
const CEILING_SLAB_BOTTOM_OFFSET = 0.1;
const WALL_PANEL_WIDTH_METERS = 2;
const CARPET_LIFT_METERS = 0.02;
const CARPET_TILE_METERS = 1.5;
const BOOKSHELF_WIDTH_METERS = 1.8;
const BOOKSHELF_DEPTH_METERS = 0.4;
const BOOKSHELF_HEIGHT_METERS = 2.4;
const QUILL_FACING_ENTRY_YAW = -Math.PI / 2;
/** Both face south, toward the child reading them from the front rather than toward a wall. */
const BINDING_LECTERN_YAW = Math.PI;
const BINDING_TABLE_YAW = 0;
/** An easel is looked at from the front, and the only way in is the studio's west archway. */
const EASEL_YAW = -Math.PI / 2;
/** How far a window's backdrop sits behind its frame, so it reads as "outside". */
const WINDOW_VIEW_DEPTH_METERS = 0.02;

const ROOM_LIGHT_INTENSITY: Readonly<Record<string, number>> = {
  'entry-hall': 3,
  'story-hall': 7,
  'character-gallery': 5,
  'costume-room': 3.5,
  'east-corridor': 2.5,
  'setting-tower': 8,
  'illustration-studio': 5,
  'great-library': 2.4,
};

const roomFloor = (id: string): RectZone => {
  const room = ROOMS.find((candidate) => candidate.id === id);
  if (!room) throw new Error(`Storykeeper Castle has no room "${id}"`);
  return room.floor;
};

const STORY_HALL = roomFloor('story-hall');
const GALLERY = roomFloor('character-gallery');
const TOWER = roomFloor('setting-tower');
const LIBRARY = roomFloor('great-library');

/** One slab per room, scaled to that room's exact footprint. */
const slabPositions = (y: number): ClusterPosition[] =>
  ROOMS.map((room) => ({
    x: (room.floor.minX + room.floor.maxX) / 2,
    y,
    z: (room.floor.minZ + room.floor.maxZ) / 2,
    scale: {
      x: (room.floor.maxX - room.floor.minX) / SLAB_SIZE_METERS,
      z: (room.floor.maxZ - room.floor.minZ) / SLAB_SIZE_METERS,
    },
  }));

/** Every interior wall's panels, on its own room-facing side. */
const WALL_PANEL_POSITIONS: ClusterPosition[] = WALL_SEGMENTS.flatMap((wall) =>
  wallPanelPlacements(
    wall,
    wall.id.split(':')[2] as RoomSide,
    WALL_PANEL_WIDTH_METERS,
    WALL_THICKNESS,
  ).map((placement) => ({
    x: placement.position.x,
    z: placement.position.z,
    rotationY: placement.rotationY,
    scale: placement.scale,
  })),
);

/** A carpet run, as tile positions lifted a hair clear of the floor plane. */
function carpetPositions(
  from: { x: number; z: number },
  to: { x: number; z: number },
): ClusterPosition[] {
  const length = Math.hypot(to.x - from.x, to.z - from.z);
  const tiles = Math.max(1, Math.round(length / CARPET_TILE_METERS));
  const rotationY = Math.abs(to.x - from.x) >= Math.abs(to.z - from.z) ? 0 : -Math.PI / 2;
  return Array.from({ length: tiles }, (_, index) => {
    const t = (index + 0.5) / tiles;
    return {
      x: from.x + (to.x - from.x) * t,
      y: CARPET_LIFT_METERS,
      z: from.z + (to.z - from.z) * t,
      rotationY,
    };
  });
}

/** Where a wall-mounted model sits once pushed out of its wall by `offset`. */
function outward(spot: WallMountedSpot, yaw: number, offset: number) {
  return {
    x: spot.x - Math.sin(yaw) * offset,
    y: spot.y,
    z: spot.z - Math.cos(yaw) * offset,
  };
}

/** The sixth carving, worn too smooth to read until the pattern is answered. */
const WORN_CARVING: WallMountedSpot = (() => {
  const spot = LOCK_CARVING_SPOTS.find((candidate) => candidate.entityId === 'lock-carving-worn');
  if (!spot) throw new Error('Storykeeper Castle has no worn lock carving');
  return spot;
})();

/** The three zones SC-10 gave the same names as the portraits they stand at. */
const GALLERY_PORTRAIT_ZONE_IDS = new Set(GALLERY_PORTRAIT_SPOTS.map((spot) => spot.entityId));

const QUILL_COLLIDER_HALF_METERS = 0.45;
const LECTERN_COLLIDER_HALF_METERS = 0.35;
const BINDING_LECTERN_HALF = { width: 0.68, depth: 0.26, height: 1.1 };
const BINDING_TABLE_HALF = { width: 0.72, depth: 0.35, height: 0.85 };
const EASEL_HALF = { width: 0.45, depth: 0.35, height: 1.6 };
const READING_TABLE_HALF = { width: 0.7, depth: 0.4, height: 0.8 };

const standingCollider = (
  id: string,
  spot: { x: number; z: number },
  half: number,
  height: number,
): ColliderSpec => ({
  rect: { id, minX: spot.x - half, maxX: spot.x + half, minZ: spot.z - half, maxZ: spot.z + half },
  minY: 0,
  maxY: height,
});

/** A rectangular prop's collider, with its footprint turned by `yaw` (always a right angle here). */
const propCollider = (
  id: string,
  spot: { x: number; z: number },
  half: { width: number; depth: number; height: number },
  yaw: number,
): ColliderSpec => {
  const turned = Math.abs(Math.sin(yaw)) > 0.5;
  const halfX = turned ? half.depth : half.width;
  const halfZ = turned ? half.width : half.depth;
  return {
    rect: {
      id,
      minX: spot.x - halfX,
      maxX: spot.x + halfX,
      minZ: spot.z - halfZ,
      maxZ: spot.z + halfZ,
    },
    minY: 0,
    maxY: half.height,
  };
};

const COLLIDERS: readonly ColliderSpec[] = [
  ...WALL_SEGMENTS.map((wall) => ({ rect: { ...wall }, minY: 0, maxY: WALL_HEIGHT })),
  // Quill and his lectern stand up as solid objects: walking through the
  // person you are about to talk to undoes the point of him being a place.
  standingCollider('collider:keeper-quill', KEEPER_QUILL_SPOT, QUILL_COLLIDER_HALF_METERS, 2),
  standingCollider('collider:quill-lectern', QUILL_LECTERN_SPOT, LECTERN_COLLIDER_HALF_METERS, 1.2),
  propCollider(
    'collider:binding-lectern',
    BINDING_LECTERN_SPOT,
    BINDING_LECTERN_HALF,
    BINDING_LECTERN_YAW,
  ),
  propCollider('collider:binding-table', BINDING_TABLE_SPOT, BINDING_TABLE_HALF, BINDING_TABLE_YAW),
  propCollider('collider:studio-easel', STUDIO_EASEL_SPOT, EASEL_HALF, EASEL_YAW),
  ...LIBRARY_BOOKSHELF_SPOTS.map((shelf) =>
    propCollider(
      `collider:${shelf.entityId}`,
      shelf,
      {
        width: shelf.width / 2,
        depth: BOOKSHELF_DEPTH_METERS / 2,
        height: BOOKSHELF_HEIGHT_METERS,
      },
      shelf.axis === 'x' ? 0 : Math.PI / 2,
    ),
  ),
  ...LIBRARY_READING_TABLE_SPOTS.map((spot) =>
    propCollider(`collider:${spot.entityId}`, spot, READING_TABLE_HALF, 0),
  ),
];

const LIGHTS: readonly LightSpec[] = [
  // One lamp per room at ceiling height. The map is authored rather than
  // derived: "the library is the darkest room and the hearth corner the
  // warmest" is a statement about story, not about geometry.
  ...ROOMS.map((room): LightSpec => ({
    id: `light:${room.id}`,
    kind: 'POINT',
    position: {
      x: (room.floor.minX + room.floor.maxX) / 2,
      y: WALL_HEIGHT - 0.4,
      z: (room.floor.minZ + room.floor.maxZ) / 2,
    },
    color: 0xffffff,
    intensity: ROOM_LIGHT_INTENSITY[room.id] ?? 3,
    decay: 1.6,
  })),
  {
    id: 'light:doorway',
    kind: 'POINT',
    position: { x: CASTLE_DOORS_SPOT.x + 1.2, y: 2, z: CASTLE_DOORS_SPOT.z },
    color: 0xdfeaff,
    intensity: 6,
    decay: 1.8,
  },
  {
    id: 'light:hearth',
    kind: 'POINT',
    position: { x: 0, y: 1.2, z: -5.2 },
    color: 0xff9c3a,
    intensity: 9,
    decay: 1.7,
  },
];

const SCENERY: readonly ScenerySpec[] = [
  {
    kind: 'CLUSTER',
    id: 'room-floors',
    assetId: 'ground-tile-stone',
    positions: slabPositions(FLOOR_SLAB_TOP_OFFSET),
  },
  {
    kind: 'CLUSTER',
    id: 'room-ceilings',
    assetId: 'ceiling-tile',
    positions: slabPositions(WALL_HEIGHT + CEILING_SLAB_BOTTOM_OFFSET),
  },
  { kind: 'CLUSTER', id: 'room-walls', assetId: 'wall-stone', positions: WALL_PANEL_POSITIONS },
  /*
    Seven archways, placed individually rather than instanced: `archway` is
    multi-part (a one-mesh archway cannot have a hole in it) and an instanced
    run would silently keep only its first jamb.
  */
  {
    kind: 'LOD_PLACEMENTS',
    id: 'archways',
    assetId: 'archway',
    positions: ARCHWAYS.map((archway) => ({
      x: (archway.gap.minX + archway.gap.maxX) / 2,
      z: (archway.gap.minZ + archway.gap.maxZ) / 2,
      rotationY:
        archway.gap.maxX - archway.gap.minX >= archway.gap.maxZ - archway.gap.minZ
          ? 0
          : -Math.PI / 2,
    })),
  },
  /*
    A carpet from the doors to Keeper Quill: the only wayfinding in the
    castle, and deliberately the kind that cannot be wrong, since it points
    at the hub every route passes through anyway. Beat 8's extension through
    the hub is the extension's, because it appears mid-visit.
  */
  {
    kind: 'CLUSTER',
    id: 'carpet-to-quill',
    assetId: 'carpet',
    positions: carpetPositions({ x: -14.5, z: 0 }, { x: -5, z: 0 }),
  },
  // The doors themselves, so the way out is a thing you can see from inside.
  {
    kind: 'LOD_PLACEMENTS',
    id: 'castle-doors',
    assetId: 'door',
    positions: [{ x: CASTLE_DOORS_SPOT.x, z: CASTLE_DOORS_SPOT.z, rotationY: -Math.PI / 2 }],
  },
  // Beat 2: Quill's lectern, with the blank page the story fills.
  {
    kind: 'LOD_PLACEMENTS',
    id: 'quill-lectern',
    assetId: 'lectern',
    positions: [
      { x: QUILL_LECTERN_SPOT.x, z: QUILL_LECTERN_SPOT.z, rotationY: QUILL_FACING_ENTRY_YAW },
    ],
  },
  {
    kind: 'LOD_PLACEMENTS',
    id: 'binding-table',
    assetId: 'binding-table',
    positions: [{ x: BINDING_TABLE_SPOT.x, z: BINDING_TABLE_SPOT.z, rotationY: BINDING_TABLE_YAW }],
  },
  {
    kind: 'LOD_PLACEMENTS',
    id: 'studio-easel',
    assetId: 'easel',
    positions: [{ x: STUDIO_EASEL_SPOT.x, z: STUDIO_EASEL_SPOT.z, rotationY: EASEL_YAW }],
  },
  /*
    The Great Library's shelves, one draw call: `bookshelf` is single-mesh
    precisely so a wall of them can be instanced, and each run's authored
    width rides in as an x scale.
  */
  {
    kind: 'CLUSTER',
    id: 'library-bookshelves',
    assetId: 'bookshelf',
    positions: LIBRARY_BOOKSHELF_SPOTS.map((shelf) => ({
      x: shelf.x,
      z: shelf.z,
      rotationY: shelf.axis === 'x' ? 0 : -Math.PI / 2,
      scale: { x: shelf.width / BOOKSHELF_WIDTH_METERS },
    })),
  },
  ...LIBRARY_READING_TABLE_SPOTS.map((spot): ScenerySpec => ({
    kind: 'LOD_PLACEMENTS',
    id: spot.entityId,
    assetId: 'reading-table',
    positions: [{ x: spot.x, z: spot.z }],
  })),
  /*
    Beat 12's nook: three cushions on the floor of the hub's south-west
    corner, each at its own rest angle so three identical cushions read as
    dropped there rather than as a placed set.
  */
  {
    kind: 'CLUSTER',
    id: 'nook-cushions',
    assetId: 'cushion',
    positions: TAPESTRY_NOOK_CUSHION_SPOTS.map((spot, index) => ({
      x: spot.x,
      z: spot.z,
      rotationY: (index * 2 * Math.PI) / 5,
    })),
  },
  /*
    Three tapestries, and it must stay at least three: the one in the
    south-west corner hides the castle's unmarked secret, and if it were the
    only tapestry it would be a signpost pointing at itself. The swaying one
    keeps its own scenery id, which is how `castle-tale` finds it to stir it.
  */
  ...TAPESTRY_SPOTS.map((spot): ScenerySpec => ({
    kind: 'MODEL',
    // `castle-tapestry-stair` is the discovery zone's id, so the tapestry
    // hanging in it takes a scenery id of its own.
    id: `tapestry:${spot.entityId}`,
    assetId: 'tapestry',
    position: { x: spot.x, y: spot.y, z: spot.z },
    rotation: { x: 0, y: facingIntoRoom(spot, STORY_HALL), z: 0 },
    anchor: 'CENTRE',
  })),
  /*
    The gallery's filler frames. Decorative and never interactive, but not
    optional: without them the three portraits that *are* the choice would be
    the only pictures in a room the content has called a wall of portraits
    since Phase 14.
  */
  ...GALLERY_FILLER_FRAME_SPOTS.map((spot): ScenerySpec => ({
    kind: 'MODEL',
    id: spot.entityId,
    assetId: 'portrait-frame',
    position: { x: spot.x, y: spot.y, z: spot.z },
    rotation: { x: 0, y: facingIntoRoom(spot, GALLERY), z: 0 },
    anchor: 'CENTRE',
  })),
  /*
    The three tower windows' frames. Floor-to-ceiling by design, so they
    stand on the floor rather than centring on the authored mounting height;
    their two backdrops are state variants and belong to `castle-tale`.
  */
  ...TOWER_WINDOW_SPOTS.map((spot): ScenerySpec => {
    const yaw = facingIntoRoom(spot, TOWER);
    return {
      kind: 'MODEL',
      id: `${spot.entityId}:frame`,
      assetId: 'window-frame',
      position: { x: spot.x, y: 0, z: spot.z },
      rotation: { x: 0, y: yaw, z: 0 },
    };
  }),
  /*
    Beat 9's nine carved stars, above the secret door. The point of the whole
    beat: `count-the-stars` asks "5 in the top row and 4 in the bottom row,
    how many altogether?", and here a child can look up and count them. A
    quarter turn about x aims a cone standing on its base out of the wall.
  */
  ...COUNTING_STAR_SPOTS.map((spot): ScenerySpec => ({
    kind: 'MODEL',
    id: spot.entityId,
    assetId: 'star-carving',
    position: { x: spot.x, y: spot.y, z: spot.z },
    rotation: { x: -Math.PI / 2, y: facingIntoRoom(spot, LIBRARY), z: 0 },
  })),
  // Beat 10's pattern: star, moon, star, moon, star. The sixth carving is
  // worn too smooth to read, and is `castle-tale`'s (it is revealed live).
  ...LOCK_CARVING_SPOTS.filter((spot) => spot.entityId !== 'lock-carving-worn').map(
    (spot): ScenerySpec => ({
      kind: 'MODEL',
      id: spot.entityId,
      assetId: spot.entityId.includes('moon') ? 'moon-carving' : 'star-carving',
      position: { x: spot.x, y: spot.y, z: spot.z },
      rotation: { x: -Math.PI / 2, y: facingIntoRoom(spot, LIBRARY), z: 0 },
    }),
  ),
];

/**
 * Everything a child can aim at. Each of these is a prop with no
 * `interactionId`: interacting with one is a move inside a puzzle rather
 * than a domain event, and `castle-tale` owns it through
 * `interceptInteract`. The portraits have no `assetId` either, because their
 * two states are variants the extension toggles.
 */
const PROPS: readonly PropSpec[] = [
  ...GALLERY_PORTRAIT_SPOTS.map((spot): PropSpec => ({
    entityId: spot.entityId,
    position: { x: spot.x, z: spot.z },
    elevation: spot.y,
    rotationY: facingIntoRoom(spot, GALLERY),
    label: 'a portrait',
  })),
  ...STORY_PLATE_SPOTS.map((spot): PropSpec => ({
    entityId: spot.entityId,
    assetId: spot.entityId,
    position: { x: spot.x, z: spot.z },
    elevation: BINDING_TABLE_HALF.height - 0.03,
    label: 'a story plate',
  })),
  {
    entityId: 'binding-lectern',
    assetId: 'binding-lectern',
    position: { x: BINDING_LECTERN_SPOT.x, z: BINDING_LECTERN_SPOT.z },
    rotationY: BINDING_LECTERN_YAW,
    label: 'the binding lectern',
  },
  ...LIBRARY_CLUE_SPOTS.map((spot): PropSpec => ({
    entityId: spot.entityId,
    assetId: spot.entityId.replace('library-clue-', 'clue-'),
    position: { x: spot.x, z: spot.z },
    elevation: 0.78,
    label: 'a clue',
  })),
  {
    entityId: 'library-clue-wall',
    assetId: 'portrait-frame',
    position: { x: LIBRARY_CLUE_WALL_SPOT.x, z: LIBRARY_CLUE_WALL_SPOT.z },
    elevation: LIBRARY_CLUE_WALL_SPOT.y,
    rotationY: facingIntoRoom(LIBRARY_CLUE_WALL_SPOT, LIBRARY),
    anchor: 'CENTRE',
    label: 'the clue wall',
  },
  ...LOCK_ROD_SPOTS.map((spot): PropSpec => ({
    entityId: spot.entityId,
    assetId: spot.entityId.replace('lock-rod-', 'rod-'),
    position: { x: spot.x, z: spot.z },
    elevation: 0.62,
    label: 'a rod',
  })),
  {
    entityId: 'lock-rod-rack',
    assetId: 'rod-rack',
    position: { x: LOCK_ROD_RACK_SPOT.x, z: LOCK_ROD_RACK_SPOT.z },
    label: 'the rod rack',
  },
  /*
    The pattern lock *is* the shut secret door: aiming at the door is how a
    rod is seated. Both door states are variants `castle-tale` draws into
    this root, so it has no asset of its own.
  */
  {
    entityId: 'secret-door',
    position: { x: SECRET_DOOR_SPOT.x, z: SECRET_DOOR_SPOT.z },
    elevation: SECRET_DOOR_SPOT.y,
    rotationY: facingIntoRoom(SECRET_DOOR_SPOT, LIBRARY),
    label: 'a door with no handle',
  },
];

export const STORYKEEPER_CASTLE_MANIFEST: ThreeLocationManifest = {
  schemaVersion: LOCATION_MANIFEST_SCHEMA_VERSION,
  regionId: STORYKEEPER_CASTLE_REGION_ID,
  locationSlug: 'storykeeper-castle',
  worldSlug: HOME_WORLD_SLUG,
  title: 'Storykeeper Castle',
  version: 1,

  bounds: { halfExtentX: 16, halfExtentZ: 10, wallThickness: 1 },

  // A dark stone background rather than a sky: indoors it is only ever seen
  // through the doorway gap, and a bright sky there would read as a hole.
  environment: {
    backgroundColor: 0x14171d,
    lighting: { ambientIntensity: 0.3, sunIntensity: 0.25, sunPosition: { x: -14, y: 12, z: 2 } },
  },

  checkpoints: {
    ids: STORYKEEPER_CASTLE_CHECKPOINTS.map((checkpoint) => checkpoint.id),
    triggerHalfSize: 1.2,
  },

  colliders: COLLIDERS,
  buildings: [],
  scenery: SCENERY,
  lights: LIGHTS,

  npcs: [
    {
      entityId: KEEPER_QUILL_ID,
      npcId: KEEPER_QUILL_ID,
      assetId: 'npc-quill',
      position: { x: KEEPER_QUILL_SPOT.x, z: KEEPER_QUILL_SPOT.z },
      yaw: QUILL_FACING_ENTRY_YAW,
      label: 'Keeper Quill',
      idleClip: 'Idle',
      placeholderColor: 0x4a5b8c,
      interactionId: 'talk-to-keeper-quill',
    },
  ],

  props: PROPS,
  collectibles: [],

  /*
    Zones, with the three gallery ones suffixed: SC-10 made standing in front
    of a portrait a way to choose it, so the zone and the portrait meant the
    same name, and entity and zone ids share one namespace in the generic
    runtime. Zone ids are never persisted (ADR-025 part G), and `castle-tale`
    strips the suffix before resolving a binding.
  */
  zones: ZONES.map((zone) => ({
    rect: {
      ...zone,
      id: GALLERY_PORTRAIT_ZONE_IDS.has(zone.id) ? `${zone.id}:approach` : zone.id,
    },
  })),
  ambient: [],

  // The castle's authored interactions, unchanged: their own requirements
  // are what the per-region view used to branch on.
  interactions: STORYKEEPER_CASTLE_INTERACTIONS,

  /*
    Phase 8's binding table, moved here from `castleChoiceBindings.ts` as
    that phase promised. Five steps across two adventures: a portrait *is*
    `choose-hero`'s `hero-fox`, a window *is* a setting, a row of seated
    plates *is* an ordering. The Adventure Engine still owns every verdict.
  */
  adventureBindings: CASTLE_CHOICE_BINDINGS,

  extensions: [
    {
      extensionId: 'castle-tale',
      config: {
        storyToldChangeKey: STORY_TOLD,
        quillEntityId: KEEPER_QUILL_ID,
        taleInteractionId: 'castle-story-hall',
        storyInteractionId: 'castle-secret-door',
        swayingTapestrySceneryId: 'tapestry:castle-tapestry-stair',
        hearth: { x: HEARTH_SPOT.x, z: HEARTH_SPOT.z },
        carpetExtension: carpetPositions({ x: -5, z: 0 }, { x: 2, z: 0 }).map((position) => ({
          x: position.x,
          y: position.y ?? 0,
          z: position.z,
          rotationY: position.rotationY ?? 0,
        })),
        shelfSlot: {
          x: LIBRARY_SHELF_SLOT_SPOT.x,
          y: LIBRARY_SHELF_SLOT_SPOT.y,
          z: LIBRARY_SHELF_SLOT_SPOT.z,
          yaw: facingIntoRoom(LIBRARY_SHELF_SLOT_SPOT, LIBRARY),
        },
        lastBookshelf: { x: LAST_BOOKSHELF_SPOT.x, z: LAST_BOOKSHELF_SPOT.z, yaw: -Math.PI / 2 },
        wornCarving: {
          x: WORN_CARVING.x,
          y: WORN_CARVING.y,
          z: WORN_CARVING.z,
          yaw: facingIntoRoom(WORN_CARVING, LIBRARY),
        },
        secretDoor: {
          yaw: facingIntoRoom(SECRET_DOOR_SPOT, LIBRARY),
        },
        portraits: GALLERY_PORTRAIT_SPOTS.map((spot) => ({
          entityId: spot.entityId,
          plain: `portrait-${spot.entityId.replace('gallery-portrait-', '')}`,
          lit: `portrait-${spot.entityId.replace('gallery-portrait-', '')}-lit`,
        })),
        windows: TOWER_WINDOW_SPOTS.map((spot) => {
          const yaw = facingIntoRoom(spot, TOWER);
          const at = outward(spot, yaw, WINDOW_VIEW_DEPTH_METERS);
          const view = spot.entityId.replace('tower-window-', '');
          return {
            entityId: spot.entityId,
            plain: `window-view-${view}`,
            lit: `window-view-${view}-lit`,
            x: at.x,
            z: at.z,
            yaw,
          };
        }),
        easel: { x: STUDIO_EASEL_SPOT.x, z: STUDIO_EASEL_SPOT.z, yaw: EASEL_YAW },
      },
    },
  ],

  noReticleBands: ['SPROUT'],

  copy: {
    loading: 'Loading Storykeeper Castle...',
    instructions:
      'Move: WASD or the arrow keys. Look: click the screen, then move your mouse (or drag with two fingers on a touch screen: left side to move, right side to look). Walk up to Keeper Quill and press E, or use the button below, to say hello.',
    progressUnavailable:
      'We could not load your backpack just now. You can still explore the castle.',
    checkpointToasts: {
      found: 'You found {checkpoint}.',
      returning: 'You are back at {checkpoint}.',
    },
    calmStop:
      'Keeper Quill closes the book and looks over at the cushions in the corner. It is a good place to sit for a while.',
    altNav: {
      label: 'Prefer not to walk in 3D? Use the location page instead',
      to: 'locations/storykeeper-castle',
    },
  },
};
