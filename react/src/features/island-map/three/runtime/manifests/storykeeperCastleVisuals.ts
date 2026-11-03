import { WALL_HEIGHT } from '../../sceneKit';
import { ROOMS, WALL_SEGMENTS, WALL_THICKNESS, type RoomSide } from '../../storykeeperCastleRegion';
import type {
  ColliderSpec,
  EffectSpec,
  MaterialPresetSpec,
  ScenerySpec,
  SurfaceFace,
  SurfaceSpec,
  WallSide,
} from '../locationManifest';
import { rect, type RoomLook, type RoomVisuals } from './castleRooms/castleVisualKit';
import { ENTRY_HALL_VISUALS } from './castleRooms/entryHall';
import { GREAT_LIBRARY_VISUALS } from './castleRooms/greatLibrary';

export type { RoomLook, RoomVisuals } from './castleRooms/castleVisualKit';
export { STORYBOOK_DAIS } from './castleRooms/greatLibrary';
export { ENTRY_MURAL } from './castleRooms/entryHall';

/**
 * Storykeeper Castle's look (SC-R02): which material preset each room's
 * floor, walls and ceiling wear, plus the procedural decor that dresses them.
 *
 * This is **data over the generic visual system** (`runtime/visual/`,
 * SC-R02-01). Nothing here draws anything: it declares `materials`,
 * `surfaces`, `effects` and a little `BOX` decor, the manifest carries them,
 * and the runtime builds, shares and disposes them. Each room's data lives
 * in its own module under `castleRooms/`, so a room's visual pass is one new
 * file and one line in `ROOM_VISUALS`.
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
/** An inlay lies 5 mm above the floor it is set into, and under the 2 cm carpets. */
export const INLAY_SURFACE_Y = 0.015;
/** The ceiling surface hangs 0.1 m below the kit ceiling slab, which rests on top of the walls. */
export const CEILING_SURFACE_Y = WALL_HEIGHT;
/** Wall surfaces stand this far off the kit wall panel, in front of it, so the two never share a plane. */
export const WALL_SURFACE_INSET = 0.02;
/** Trim stands proud of the wall surface for the same reason. */
export const TRIM_SURFACE_INSET = 0.04;
/**
 * A wall face's `area` is a box footprint (the manifest contract wants both
 * axes non-empty), and only one side of it is drawn. It runs this far behind
 * the visible plane, into the wall.
 */
const FACE_DEPTH = 0.01;
export const BASEBOARD_HEIGHT = 0.18;
export const CORNICE_HEIGHT = 0.18;

/** Presets more than one room wears, declared once here. */
const SHARED_MATERIALS: readonly MaterialPresetSpec[] = [
  {
    id: 'trim-dark-wood',
    pattern: 'PLAIN',
    baseColor: 0x35210f,
    roughness: 0.75,
    metersPerRepeat: 1,
  },
];

/** Every room that has had its visual pass, in castle order (the Library first, as SC-R02-02 came first). */
const ROOM_VISUALS: readonly RoomVisuals[] = [GREAT_LIBRARY_VISUALS, ENTRY_HALL_VISUALS];

export const ROOM_LOOKS: readonly RoomLook[] = ROOM_VISUALS.map((room) => room.look);

export const CASTLE_MATERIALS: readonly MaterialPresetSpec[] = [
  ...SHARED_MATERIALS,
  ...ROOM_VISUALS.flatMap((room) => room.materials),
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
      const plane =
        roomSide === 'south' ? floor.minZ + WALL_HALF + inset : floor.maxZ - WALL_HALF - inset;
      faces.push({
        kind: 'WALL',
        area:
          roomSide === 'south'
            ? rect(id, from, to, plane - FACE_DEPTH, plane)
            : rect(id, from, to, plane, plane + FACE_DEPTH),
        minY,
        maxY,
        sides: [FACING[roomSide]],
      });
    } else {
      const from = Math.max(wall.minZ, floor.minZ + WALL_HALF);
      const to = Math.min(wall.maxZ, floor.maxZ - WALL_HALF);
      if (!(to > from)) continue;
      const plane =
        roomSide === 'west' ? floor.minX + WALL_HALF + inset : floor.maxX - WALL_HALF - inset;
      faces.push({
        kind: 'WALL',
        area:
          roomSide === 'west'
            ? rect(id, plane - FACE_DEPTH, plane, from, to)
            : rect(id, plane, plane + FACE_DEPTH, from, to),
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
  for (const inlay of look.inlays ?? []) {
    surfaces.push({
      id: id(`inlay:${inlay.id}`),
      materialId: inlay.materialId,
      faces: [
        {
          kind: 'FLOOR',
          area: { ...inlay.area, id: id(`inlay:${inlay.id}:area`) },
          y: INLAY_SURFACE_Y,
        },
      ],
    });
  }
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

/** Decor with no domain meaning: never raycast, never a collider (those are `CASTLE_DECOR_COLLIDERS`). */
export const CASTLE_DECOR: readonly ScenerySpec[] = ROOM_VISUALS.flatMap((room) => room.decor);

/** The solid decor, so the child walks around it. A low step is still a wall to a first-person controller. */
export const CASTLE_DECOR_COLLIDERS: readonly ColliderSpec[] = ROOM_VISUALS.flatMap(
  (room) => room.colliders,
);
