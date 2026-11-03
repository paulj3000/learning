import { WALL_HEIGHT } from '../../sceneKit';
import { ROOMS, WALL_SEGMENTS, WALL_THICKNESS, type RoomSide } from '../../storykeeperCastleRegion';
import type {
  ColliderSpec,
  EffectSpec,
  MaterialPresetSpec,
  RectZone,
  ScenerySpec,
  SurfaceFace,
  SurfaceSpec,
  WallSide,
} from '../locationManifest';

/**
 * Storykeeper Castle's look (SC-R02): which material preset each room's
 * floor, walls and ceiling wear, plus the procedural decor that dresses them.
 *
 * This is **data over the generic visual system** (`runtime/visual/`,
 * SC-R02-01). Nothing here draws anything: it declares `materials`,
 * `surfaces`, `effects` and a little `BOX` decor, the manifest carries them,
 * and the runtime builds, shares and disposes them. A room is re-dressed by
 * adding one `RoomLook`, so a room's visual pass is one small commit.
 *
 * What a look never does (art direction, section 9): move a collider, add a
 * zone, change an interaction, or hold a gameplay id. The kit pieces the
 * castle already placed stay underneath as the fallback, so a surface that
 * fails to build leaves the old floor, wall and ceiling still standing.
 *
 * Palettes follow `docs/regions/storykeeper_castle_art_direction.md`
 * section 5. Every colour here is a preset or a named decor constant; scene
 * code carries no ad-hoc colours.
 */

/** Half a wall's thickness: how far a room's floor edge is from its wall's room-facing face. */
const WALL_HALF = WALL_THICKNESS / 2;

/**
 * Where a surface sits relative to the kit piece it overlays. The imported
 * floor tile's top is at y = 0 once placed (the generated one is lower), so
 * the floor sits 1 cm above it: clear of both, and not enough to read as a
 * raised floor. Carpets sit at 0.02 and stay above it.
 */
export const FLOOR_SURFACE_Y = 0.01;
/** The ceiling surface hangs 0.1 m below the kit ceiling slab, which rests on top of the walls. */
export const CEILING_SURFACE_Y = WALL_HEIGHT;
/** Wall surfaces stand this far off the kit wall panel, in front of it, so the two never share a plane. */
export const WALL_SURFACE_INSET = 0.02;
/** Trim stands proud of the wall surface for the same reason. */
export const TRIM_SURFACE_INSET = 0.04;
/**
 * A wall face's `area` is a box footprint (the manifest contract wants both axes non-empty), and only
 * one side of it is drawn. It runs this far behind the visible plane, into the wall.
 */
const FACE_DEPTH = 0.01;
export const BASEBOARD_HEIGHT = 0.18;
export const CORNICE_HEIGHT = 0.18;

/** A room's look: the preset ids its surfaces wear. Presets are declared in `CASTLE_MATERIALS`. */
export interface RoomLook {
  roomId: string;
  floor: string;
  walls: string;
  ceiling: string;
  /** A lower band of different wall material, from the floor up to `height` metres. */
  wainscot?: { materialId: string; height: number };
  /** A low strip along the foot of every wall, and a cornice along the head. */
  trim?: string;
  /** Drifting dust or magic, capped by the render-quality tier. */
  motes?: { color: number; count: number; minY: number; maxY: number; size?: number; seed: number };
}

export const CASTLE_MATERIALS: readonly MaterialPresetSpec[] = [
  {
    id: 'planks-library',
    pattern: 'PLANKS',
    baseColor: 0x5b3b25,
    accentColor: 0x3e2717,
    roughness: 0.8,
    metersPerRepeat: 1.6,
    seed: 21,
  },
  {
    id: 'ashlar-library',
    pattern: 'ASHLAR',
    baseColor: 0x8c7f6e,
    accentColor: 0x62574a,
    roughness: 0.9,
    metersPerRepeat: 2,
    seed: 22,
  },
  {
    id: 'trim-dark-wood',
    pattern: 'PLAIN',
    baseColor: 0x35210f,
    roughness: 0.75,
    metersPerRepeat: 1,
  },
];

export const ROOM_LOOKS: readonly RoomLook[] = [
  {
    // Dark wood, ashlar, candle dust: the darkest room, readable at a glance.
    roomId: 'great-library',
    floor: 'planks-library',
    walls: 'ashlar-library',
    ceiling: 'planks-library',
    trim: 'trim-dark-wood',
    motes: { color: 0xffe9a8, count: 40, minY: 0.4, maxY: 2.8, size: 0.045, seed: 7 },
  },
];

const FACING: Readonly<Record<RoomSide, WallSide>> = {
  south: 'north',
  north: 'south',
  west: 'east',
  east: 'west',
};

const roomById = (roomId: string) => {
  const room = ROOMS.find((candidate) => candidate.id === roomId);
  if (!room) throw new Error(`Storykeeper Castle has no room "${roomId}"`);
  return room;
};

const rect = (id: string, minX: number, maxX: number, minZ: number, maxZ: number): RectZone => ({
  id,
  minX,
  maxX,
  minZ,
  maxZ,
});

/**
 * One room's wall faces: a thin area per derived wall segment, standing
 * `inset` in front of the room-facing plane, clamped to the room's inner
 * corners so a run never creeps into the next wall. A segment that an
 * archway has cut is simply shorter, so a doorway is never textured over.
 */
export function roomWallFaces(
  roomId: string,
  inset: number,
  minY: number,
  maxY: number,
  idPrefix: string,
): SurfaceFace[] {
  const { floor } = roomById(roomId);
  const faces: SurfaceFace[] = [];
  for (const wall of WALL_SEGMENTS) {
    const [, wallRoomId, side] = wall.id.split(':');
    if (wallRoomId !== roomId) continue;
    const roomSide = side as RoomSide;
    const id = `${idPrefix}:${wall.id}`;
    // The visible plane is the face's own side; the box runs FACE_DEPTH *behind* it, into the wall.
    if (roomSide === 'south' || roomSide === 'north') {
      const from = Math.max(wall.minX, floor.minX + WALL_HALF);
      const to = Math.min(wall.maxX, floor.maxX - WALL_HALF);
      if (!(to > from)) continue;
      faces.push({
        kind: 'WALL',
        area:
          roomSide === 'south'
            ? rect(
                id,
                from,
                to,
                floor.minZ + WALL_HALF + inset - FACE_DEPTH,
                floor.minZ + WALL_HALF + inset,
              )
            : rect(
                id,
                from,
                to,
                floor.maxZ - WALL_HALF - inset,
                floor.maxZ - WALL_HALF - inset + FACE_DEPTH,
              ),
        minY,
        maxY,
        sides: [FACING[roomSide]],
      });
    } else {
      const from = Math.max(wall.minZ, floor.minZ + WALL_HALF);
      const to = Math.min(wall.maxZ, floor.maxZ - WALL_HALF);
      if (!(to > from)) continue;
      faces.push({
        kind: 'WALL',
        area:
          roomSide === 'west'
            ? rect(
                id,
                floor.minX + WALL_HALF + inset - FACE_DEPTH,
                floor.minX + WALL_HALF + inset,
                from,
                to,
              )
            : rect(
                id,
                floor.maxX - WALL_HALF - inset,
                floor.maxX - WALL_HALF - inset + FACE_DEPTH,
                from,
                to,
              ),
        minY,
        maxY,
        sides: [FACING[roomSide]],
      });
    }
  }
  return faces;
}

function lookSurfaces(look: RoomLook): SurfaceSpec[] {
  const { floor } = roomById(look.roomId);
  const id = (kind: string) => `look:${look.roomId}:${kind}`;
  const surfaces: SurfaceSpec[] = [
    {
      id: id('floor'),
      materialId: look.floor,
      faces: [{ kind: 'FLOOR', area: { ...floor, id: id('floor:area') }, y: FLOOR_SURFACE_Y }],
    },
    {
      id: id('ceiling'),
      materialId: look.ceiling,
      faces: [
        { kind: 'CEILING', area: { ...floor, id: id('ceiling:area') }, y: CEILING_SURFACE_Y },
      ],
    },
  ];
  const wainscot = look.wainscot;
  if (wainscot) {
    surfaces.push({
      id: id('wainscot'),
      materialId: wainscot.materialId,
      faces: roomWallFaces(
        look.roomId,
        WALL_SURFACE_INSET,
        0,
        wainscot.height,
        id('wainscot:face'),
      ),
    });
  }
  surfaces.push({
    id: id('walls'),
    materialId: look.walls,
    faces: roomWallFaces(
      look.roomId,
      WALL_SURFACE_INSET,
      wainscot?.height ?? 0,
      WALL_HEIGHT,
      id('walls:face'),
    ),
  });
  if (look.trim) {
    surfaces.push({
      id: id('trim'),
      materialId: look.trim,
      faces: [
        ...roomWallFaces(
          look.roomId,
          TRIM_SURFACE_INSET,
          0,
          BASEBOARD_HEIGHT,
          id('baseboard:face'),
        ),
        ...roomWallFaces(
          look.roomId,
          TRIM_SURFACE_INSET,
          WALL_HEIGHT - CORNICE_HEIGHT,
          WALL_HEIGHT,
          id('cornice:face'),
        ),
      ],
    });
  }
  return surfaces;
}

function lookEffects(look: RoomLook): EffectSpec[] {
  if (!look.motes) return [];
  const { floor } = roomById(look.roomId);
  const margin = 0.5;
  return [
    {
      kind: 'MOTES',
      id: `motes:${look.roomId}`,
      area: rect(
        `motes:${look.roomId}:area`,
        floor.minX + margin,
        floor.maxX - margin,
        floor.minZ + margin,
        floor.maxZ - margin,
      ),
      ...look.motes,
    },
  ];
}

export const CASTLE_SURFACES: readonly SurfaceSpec[] = ROOM_LOOKS.flatMap(lookSurfaces);
export const CASTLE_EFFECTS: readonly EffectSpec[] = ROOM_LOOKS.flatMap(lookEffects);

// --- Procedural decor ------------------------------------------------------

const DAIS_GOLD = 0xb08a45;
const DAIS_GOLD_BRIGHT = 0xd8b45a;
const BEAM_WOOD = 0x3b2614;
const CANDLE_WAX = 0xf3e6c3;
const CANDLE_FLAME = 0xffc45a;

/**
 * Where the Great Storybook rests in the Great Library (`docs/regions/
 * STORYKEEPER_CASTLE_REBOOT_ROADMAP.md` section 2.1). SC-R02-02 builds the
 * empty dais; SC-R04 puts the book and its pages on it. Chosen from the one
 * stretch of open floor the authored puzzle spots leave: clear of the east
 * shelves, both reading tables, the clue spots and the secret door's wall.
 */
export const STORYBOOK_DAIS = {
  x: 12.9,
  z: -4.55,
  /** Half-extent of the lower tier; the upper tier is 0.7 of it. */
  half: 1,
  tierHeight: 0.12,
} as const;

const BEAM_Z = [-3.5, -6, -8.5] as const;
const BEAM_HALF_WIDTH = 0.15;
const BEAM_BOTTOM = WALL_HEIGHT - 0.25;
/** Library reading tables are 0.8 m high (`READING_TABLE_HALF` in the manifest). */
const TABLE_TOP = 0.8;
const CANDLE_SPOTS = [
  { id: 'castle-candle-a', x: 7.55, z: -5.2 },
  { id: 'castle-candle-b', x: 11.0, z: -7.2 },
] as const;

const box = (
  id: string,
  color: number,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  minY: number,
  maxY: number,
): ScenerySpec => ({
  kind: 'BOX',
  id,
  color,
  area: rect(`${id}:area`, minX, maxX, minZ, maxZ),
  minY,
  maxY,
});

const upper = STORYBOOK_DAIS.half * 0.7;

/** Decor with no domain meaning: never raycast, never a collider (those are `CASTLE_DECOR_COLLIDERS`). */
export const CASTLE_DECOR: readonly ScenerySpec[] = [
  box(
    'castle-dais-tier-1',
    DAIS_GOLD,
    STORYBOOK_DAIS.x - STORYBOOK_DAIS.half,
    STORYBOOK_DAIS.x + STORYBOOK_DAIS.half,
    STORYBOOK_DAIS.z - STORYBOOK_DAIS.half,
    STORYBOOK_DAIS.z + STORYBOOK_DAIS.half,
    0,
    STORYBOOK_DAIS.tierHeight,
  ),
  box(
    'castle-dais-tier-2',
    DAIS_GOLD_BRIGHT,
    STORYBOOK_DAIS.x - upper,
    STORYBOOK_DAIS.x + upper,
    STORYBOOK_DAIS.z - upper,
    STORYBOOK_DAIS.z + upper,
    STORYBOOK_DAIS.tierHeight,
    STORYBOOK_DAIS.tierHeight * 2,
  ),
  // Three ceiling beams across the library: they break up the long dark ceiling and cannot be walked into.
  ...BEAM_Z.map((z, index) =>
    box(
      `castle-library-beam-${index + 1}`,
      BEAM_WOOD,
      5.3,
      14.7,
      z - BEAM_HALF_WIDTH,
      z + BEAM_HALF_WIDTH,
      BEAM_BOTTOM,
      WALL_HEIGHT,
    ),
  ),
  // A candle on each reading table, off to the side of anything the child picks up.
  ...CANDLE_SPOTS.flatMap((spot) => [
    box(
      `${spot.id}-wax`,
      CANDLE_WAX,
      spot.x - 0.03,
      spot.x + 0.03,
      spot.z - 0.03,
      spot.z + 0.03,
      TABLE_TOP,
      TABLE_TOP + 0.14,
    ),
    box(
      `${spot.id}-flame`,
      CANDLE_FLAME,
      spot.x - 0.015,
      spot.x + 0.015,
      spot.z - 0.015,
      spot.z + 0.015,
      TABLE_TOP + 0.14,
      TABLE_TOP + 0.19,
    ),
  ]),
];

/** The dais is solid, so the child walks around it. A low step is still a wall to a first-person controller. */
export const CASTLE_DECOR_COLLIDERS: readonly ColliderSpec[] = [
  {
    rect: rect(
      'collider:storybook-dais',
      STORYBOOK_DAIS.x - STORYBOOK_DAIS.half,
      STORYBOOK_DAIS.x + STORYBOOK_DAIS.half,
      STORYBOOK_DAIS.z - STORYBOOK_DAIS.half,
      STORYBOOK_DAIS.z + STORYBOOK_DAIS.half,
    ),
    minY: 0,
    maxY: STORYBOOK_DAIS.tierHeight * 2,
  },
];
