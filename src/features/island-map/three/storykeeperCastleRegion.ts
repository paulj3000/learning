import {
  STORYKEEPER_CASTLE_CHECKPOINTS,
  STORYKEEPER_CASTLE_REGION_ID,
} from '../../discovery/checkpoints';

/**
 * Pure content and geometry for Storykeeper Castle's first-person region
 * (`docs/STORYKEEPER_CASTLE_3D_ROADMAP.md` SC-0, building the plan in
 * `docs/STORYKEEPER_CASTLE_3D_STORYBOARD.md` section 3). Same split as
 * `welcomeHarborRegion.ts`/`pirateBuilderBayRegion.ts`: plain numbers, no
 * `three` import, so this stays unit-testable without a rendering context.
 * `storykeeperCastleScene.ts` (SC-2) will be the only file that turns these
 * numbers into `three` objects.
 *
 * Two things make this region different from the two that came before it,
 * and both shaped how it is authored:
 *
 * **It is indoors.** Welcome Harbor and Pirate Builder Bay are open plots
 * whose ground extent reads as the edge of the world, so both get away with
 * four boundary rects and no interior structure. A castle is rooms, and
 * rooms are walls with holes in them. So walls here are *derived*
 * (`buildWallSegments`) from authored room floors minus authored archway
 * gaps, rather than hand-listed: hand-listing roughly two dozen wall rects
 * and keeping every doorway gap consistent between the two rooms that share
 * it is exactly the kind of authoring that drifts silently.
 *
 * **Nothing is gated by geometry.** Unlike the bay's bridge, no adventure
 * here is locked behind crossing anything - the secret door is gated by a
 * world change on the *interaction*, not by a wall. Every room is reachable
 * from spawn on foot the moment the child arrives, which is what
 * `storykeeperCastleRegion.test.ts`'s flood fill asserts.
 *
 * Checkpoint *positions* are authored here; the checkpoint *id vocabulary
 * and persistence* live one layer down in
 * `src/features/discovery/checkpoints.ts`, per ADR-008's rule that World
 * State must never depend on World Engine code.
 */

export const REGION_ID = STORYKEEPER_CASTLE_REGION_ID;

/**
 * A rectangular footprint or trigger volume on the ground plane, in world
 * x/z meters. Declared here rather than imported from a sibling region for
 * the same reason `pirateBuilderBayRegion.ts` re-declares it: each region
 * module stands alone, and `sceneKit.ts` consumes the shape structurally
 * (`RectZoneLike`) rather than by identity.
 */
export interface RectZone {
  id: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export function isInsideRect(x: number, z: number, zone: RectZone): boolean {
  return x >= zone.minX && x <= zone.maxX && z >= zone.minZ && z <= zone.maxZ;
}

export const GROUND_HALF_EXTENT_X = 16;
export const GROUND_HALF_EXTENT_Z = 10;

/**
 * Interior walls straddle the room edge they sit on, 0.25m either side, so
 * two rooms sharing an edge produce two overlapping wall rects rather than
 * a seam. Overlapping colliders are harmless; a seam is a hole the child
 * walks through.
 */
export const WALL_THICKNESS = 0.5;

/** Wall pieces shorter than this are dropped as authoring noise rather than emitted as slivers. */
const MIN_WALL_LENGTH = 0.01;

/**
 * How far a wall-mounted prop (portrait, window, tapestry, hearth, the
 * secret door) sits proud of the inner wall face. Small enough to read as
 * mounted, large enough that the prop's own position is never inside a
 * collider - which is what lets the test assert every authored spot is on
 * walkable floor without special-casing the wall-mounted ones.
 */
const WALL_MOUNT_CLEARANCE = 0.05;

export type RoomSide = 'north' | 'south' | 'east' | 'west';

export interface RoomDefinition {
  id: string;
  /** Child-facing name, used by the HUD toast when the child walks in. */
  label: string;
  /** The room's walkable floor. Walls are generated on its edges. */
  floor: RectZone;
}

/**
 * The eight rooms of the storyboard's hub-and-spoke plan. Spokes open off
 * the Story Hall, so the child always returns through it and always passes
 * Keeper Quill; the east corridor is the only route to the tower, studio,
 * and library, which keeps the Great Library - and the secret door at its
 * far end - the deepest point in the castle.
 *
 * Rooms abut exactly (the entry hall's east edge and the story hall's west
 * edge are both x = -9), so a shared edge produces one archway gap that
 * both rooms' walls subtract.
 */
export const ROOMS: readonly RoomDefinition[] = [
  {
    id: 'entry-hall',
    label: 'the entry hall',
    floor: { id: 'entry-hall:floor', minX: -16, maxX: -9, minZ: -3, maxZ: 3 },
  },
  {
    id: 'story-hall',
    label: 'the story hall',
    floor: { id: 'story-hall:floor', minX: -9, maxX: 3, minZ: -6, maxZ: 6 },
  },
  {
    id: 'character-gallery',
    label: 'the Character Gallery',
    floor: { id: 'character-gallery:floor', minX: -8, maxX: -1, minZ: 6, maxZ: 10 },
  },
  {
    id: 'costume-room',
    label: 'the Costume Room',
    floor: { id: 'costume-room:floor', minX: -8, maxX: -1, minZ: -10, maxZ: -6 },
  },
  {
    id: 'east-corridor',
    label: 'the east corridor',
    floor: { id: 'east-corridor:floor', minX: 3, maxX: 5, minZ: -10, maxZ: 10 },
  },
  {
    id: 'setting-tower',
    label: 'the Setting Tower',
    floor: { id: 'setting-tower:floor', minX: 5, maxX: 10, minZ: 5, maxZ: 10 },
  },
  {
    id: 'illustration-studio',
    label: 'the Illustration Studio',
    floor: { id: 'illustration-studio:floor', minX: 5, maxX: 10, minZ: -1, maxZ: 3 },
  },
  {
    id: 'great-library',
    label: 'the Great Library',
    floor: { id: 'great-library:floor', minX: 5, maxX: 15, minZ: -10, maxZ: -2 },
  },
];

export interface ArchwayDefinition {
  id: string;
  /** The two room ids this gap connects. Asserted against `ROOMS` by the test. */
  between: readonly [string, string];
  /** The walkable gap itself, straddling the shared edge and subtracted from both rooms' walls. */
  gap: RectZone;
}

/**
 * Seven archways, each 2m wide - wide enough that a child dragging a look
 * control across a doorway does not clip its frame, and the one dimension
 * in this file that should not be narrowed for looks.
 */
export const ARCHWAYS: readonly ArchwayDefinition[] = [
  {
    id: 'arch-entry-hall',
    between: ['entry-hall', 'story-hall'],
    gap: { id: 'arch-entry-hall:gap', minX: -9.25, maxX: -8.75, minZ: -1, maxZ: 1 },
  },
  {
    id: 'arch-gallery',
    between: ['story-hall', 'character-gallery'],
    gap: { id: 'arch-gallery:gap', minX: -5.5, maxX: -3.5, minZ: 5.75, maxZ: 6.25 },
  },
  {
    id: 'arch-costume',
    between: ['story-hall', 'costume-room'],
    gap: { id: 'arch-costume:gap', minX: -5.5, maxX: -3.5, minZ: -6.25, maxZ: -5.75 },
  },
  {
    id: 'arch-corridor',
    between: ['story-hall', 'east-corridor'],
    gap: { id: 'arch-corridor:gap', minX: 2.75, maxX: 3.25, minZ: -1, maxZ: 1 },
  },
  {
    id: 'arch-tower',
    between: ['east-corridor', 'setting-tower'],
    gap: { id: 'arch-tower:gap', minX: 4.75, maxX: 5.25, minZ: 6.5, maxZ: 8.5 },
  },
  {
    id: 'arch-studio',
    between: ['east-corridor', 'illustration-studio'],
    gap: { id: 'arch-studio:gap', minX: 4.75, maxX: 5.25, minZ: 0, maxZ: 2 },
  },
  {
    id: 'arch-library',
    between: ['east-corridor', 'great-library'],
    gap: { id: 'arch-library:gap', minX: 4.75, maxX: 5.25, minZ: -7, maxZ: -5 },
  },
];

const ARCHWAY_GAPS: readonly RectZone[] = ARCHWAYS.map((archway) => archway.gap);

function rectsOverlap(a: RectZone, b: RectZone): boolean {
  return a.minX < b.maxX && b.minX < a.maxX && a.minZ < b.maxZ && b.minZ < a.maxZ;
}

/** The full-length wall rect for one room edge, extended at both ends so corners meet. */
function edgeRect(floor: RectZone, side: RoomSide): RectZone {
  const half = WALL_THICKNESS / 2;
  switch (side) {
    case 'north':
      return {
        id: '',
        minX: floor.minX - half,
        maxX: floor.maxX + half,
        minZ: floor.maxZ - half,
        maxZ: floor.maxZ + half,
      };
    case 'south':
      return {
        id: '',
        minX: floor.minX - half,
        maxX: floor.maxX + half,
        minZ: floor.minZ - half,
        maxZ: floor.minZ + half,
      };
    case 'east':
      return {
        id: '',
        minX: floor.maxX - half,
        maxX: floor.maxX + half,
        minZ: floor.minZ - half,
        maxZ: floor.maxZ + half,
      };
    case 'west':
      return {
        id: '',
        minX: floor.minX - half,
        maxX: floor.minX + half,
        minZ: floor.minZ - half,
        maxZ: floor.maxZ + half,
      };
  }
}

/** Cuts one wall rect down to `[from, to]` on its long axis, leaving the thin axis alone. */
function sliceWall(wall: RectZone, axis: 'x' | 'z', from: number, to: number): RectZone {
  return axis === 'x' ? { ...wall, minX: from, maxX: to } : { ...wall, minZ: from, maxZ: to };
}

/**
 * Removes every archway gap that actually overlaps this wall from it,
 * leaving the pieces either side. A gap is only subtracted when it overlaps
 * on *both* axes, so the gallery's doorway cannot punch a hole in the
 * costume room's wall just because the two share an x range.
 */
function subtractGaps(wall: RectZone, axis: 'x' | 'z', gaps: readonly RectZone[]): RectZone[] {
  const spans = gaps
    .filter((gap) => rectsOverlap(wall, gap))
    .map((gap) =>
      axis === 'x' ? { from: gap.minX, to: gap.maxX } : { from: gap.minZ, to: gap.maxZ },
    )
    .sort((a, b) => a.from - b.from);

  const wallFrom = axis === 'x' ? wall.minX : wall.minZ;
  const wallTo = axis === 'x' ? wall.maxX : wall.maxZ;

  const pieces: RectZone[] = [];
  let cursor = wallFrom;
  for (const span of spans) {
    if (span.from > cursor) {
      pieces.push(sliceWall(wall, axis, cursor, Math.min(span.from, wallTo)));
    }
    cursor = Math.max(cursor, span.to);
  }
  if (cursor < wallTo) {
    pieces.push(sliceWall(wall, axis, cursor, wallTo));
  }

  return pieces.filter(
    (piece) => (axis === 'x' ? piece.maxX - piece.minX : piece.maxZ - piece.minZ) > MIN_WALL_LENGTH,
  );
}

const ROOM_SIDES: readonly RoomSide[] = ['north', 'south', 'east', 'west'];

/**
 * Every wall collider in the castle, derived from `ROOMS` and `ARCHWAYS`.
 * Exported as a function as well as a constant so the test can rebuild it
 * from modified inputs (e.g. with an archway removed) and prove the flood
 * fill is actually sensitive to the gaps rather than passing trivially.
 */
export function buildWallSegments(
  rooms: readonly RoomDefinition[] = ROOMS,
  gaps: readonly RectZone[] = ARCHWAY_GAPS,
): readonly RectZone[] {
  const segments: RectZone[] = [];
  for (const room of rooms) {
    for (const side of ROOM_SIDES) {
      const axis = side === 'north' || side === 'south' ? 'x' : 'z';
      subtractGaps(edgeRect(room.floor, side), axis, gaps).forEach((piece, index) => {
        segments.push({ ...piece, id: `wall:${room.id}:${side}:${index}` });
      });
    }
  }
  return segments;
}

export const WALL_SEGMENTS: readonly RectZone[] = buildWallSegments();

/** Whether this point is inside any room's floor. Outside every room is outside the castle. */
export function isOnFloor(x: number, z: number): boolean {
  return ROOMS.some((room) => isInsideRect(x, z, room.floor));
}

/** Whether this point is inside a wall collider. */
export function isBlocked(x: number, z: number): boolean {
  return WALL_SEGMENTS.some((wall) => isInsideRect(x, z, wall));
}

/** Whether a child could stand here: on some room's floor, and not inside a wall. */
export function isWalkable(x: number, z: number): boolean {
  return isOnFloor(x, z) && !isBlocked(x, z);
}

/** A floor-standing entity: a prop, a character, or anything the child can walk around. */
export interface EntitySpot {
  entityId: string;
  x: number;
  z: number;
}

/** A wall-mounted entity. `y` is its center height; `x`/`z` sit proud of the inner wall face. */
export interface WallMountedSpot extends EntitySpot {
  y: number;
}

// --- The Story Hall (hub) ---------------------------------------------------

export const KEEPER_QUILL_ID = 'keeper-quill';

/**
 * Where Keeper Quill stands, facing the entry hall so the child walking in
 * from the west is looked at rather than looked away from. Quill is
 * stationary and never follows - the same call `storykeeperCastleDecor.ts`
 * already makes in the Phaser castle.
 *
 * SC-2/SC-3 owe Quill a collider of their own; nothing in this file gives
 * one, so today the child could walk through them.
 */
export const KEEPER_QUILL_SPOT: EntitySpot = { entityId: KEEPER_QUILL_ID, x: -4.5, z: 0 };

/** Quill's own lectern, holding the blank page of beat 2. */
export const QUILL_LECTERN_SPOT: EntitySpot = { entityId: 'quill-lectern', x: -3.4, z: 0 };

/** The hearth on the hub's south wall, and the mantel whose three carved words beat 5 reads against. */
export const HEARTH_SPOT: EntitySpot = {
  entityId: 'hall-hearth',
  x: 0,
  z: -6 + WALL_THICKNESS / 2 + WALL_MOUNT_CLEARANCE,
};
export const HEARTH_MANTEL_SPOT: WallMountedSpot = {
  entityId: 'hall-hearth-mantel',
  x: 0,
  y: 2.2,
  z: -6 + WALL_THICKNESS / 2 + WALL_MOUNT_CLEARANCE,
};

/**
 * The binding lectern of beat 6, with three sockets, and the table its
 * plates start on - **side by side**, both facing south into the room.
 *
 * SC-0 put the table 1.2m *behind* the lectern, and walking the room proved
 * that unworkable: from anywhere the child can stand and see the sockets,
 * the lectern is between them and the plates, so every single pickup meant
 * walking around the furniture and back. Beat 6 is three pickups. Beside
 * each other, the child stands once and turns their head - the plates on
 * their left, the sockets on their right, both about a metre away.
 */
export const BINDING_LECTERN_SPOT: EntitySpot = { entityId: 'binding-lectern', x: 1, z: 2 };
export const BINDING_TABLE_SPOT: EntitySpot = { entityId: 'binding-table', x: -1.4, z: 2 };

/**
 * The three sockets across the binding lectern's desk, left to right as the
 * child faces it, as offsets along the lectern's **own local x axis**.
 *
 * Local rather than world for the same reason nothing else in this file
 * carries a rotation: which way the lectern faces is presentation, and
 * `storykeeperCastleScene.ts` owns it (`facingIntoRoom`). Authored world
 * x/z here would silently rot the first time the lectern is turned.
 *
 * The same three numbers are read by `scripts/generate-world-assets.ts` to
 * cut the sockets into the model, so the recesses the child sees and the
 * places a plate lands are one authored fact rather than two that agree
 * today. 0.42m apart holds three 0.34m-wide `story-plate-*` models with a
 * finger's gap between them.
 */
export const BINDING_SOCKET_LOCAL_X: readonly number[] = [-0.42, 0, 0.42];

/**
 * The three story-beat plates, on the table they start on. Their entity ids
 * bind to `order-the-story`'s items (`castleChoiceBindings.ts`).
 *
 * **They lie in the adventure's own authored item order, which is not the
 * correct story order**, and that is load-bearing rather than incidental.
 * SC-0 laid them out problem, choice, ending - the answer - so a child who
 * seated them left to right without reading them scored a sequencing step
 * they had not done, while a child on the HUD list got the shuffled order
 * `theStorykeepersTale.ts` deliberately authors. Two routes to one step must
 * start from the same arrangement, and neither may be the answer.
 * `castleBindingLectern.test.ts` holds both halves of that.
 */
export const STORY_PLATE_SPOTS: readonly EntitySpot[] = [
  { entityId: 'story-plate-choice', x: -1.8, z: 2 },
  { entityId: 'story-plate-ending', x: -1.4, z: 2 },
  { entityId: 'story-plate-problem', x: -1, z: 2 },
];

/**
 * Beat 12's nook: cushions on the floor in the hub's south-west corner,
 * inside the `castle-tapestry-stair` zone and under the tapestry that
 * sways.
 *
 * They are the only thing that marks the corner, and they mark it the way
 * the storyboard wants it marked - by being a nice place to sit, found by a
 * child who wandered over. No HUD cue, no map pin, no quest entry. The
 * secret leads nowhere and rewards nothing beyond being found.
 */
export const TAPESTRY_NOOK_CUSHION_SPOTS: readonly EntitySpot[] = [
  { entityId: 'nook-cushion-a', x: -8.3, z: -5.4 },
  { entityId: 'nook-cushion-b', x: -7.75, z: -5.15 },
  { entityId: 'nook-cushion-c', x: -8.15, z: -4.75 },
];

/**
 * Three tapestries, and it must stay at least three. The one in the
 * south-west corner hides Phase 26's unmarked secret (beat 12); if it were
 * the castle's only tapestry it would be a signpost pointing at itself.
 * The other two hang in plain sight and hide nothing.
 */
export const TAPESTRY_SPOTS: readonly WallMountedSpot[] = [
  { entityId: 'castle-tapestry-stair', x: -8.7, y: 1.6, z: -5.2 },
  { entityId: 'hall-tapestry-north', x: -8.7, y: 1.6, z: 3.5 },
  { entityId: 'hall-tapestry-east', x: 2.7, y: 1.6, z: 4.2 },
];

// --- The Character Gallery (beat 3) ----------------------------------------

const GALLERY_WALL_Z = 10 - WALL_THICKNESS / 2 - WALL_MOUNT_CLEARANCE;

/**
 * The three hero portraits, on the gallery's north wall. Their entity ids
 * bind to `choose-hero`'s option ids - a portrait *is* the choice, which is
 * the whole thesis of the storyboard.
 */
export const GALLERY_PORTRAIT_SPOTS: readonly WallMountedSpot[] = [
  { entityId: 'gallery-portrait-puppy', x: -6.5, y: 1.5, z: GALLERY_WALL_Z },
  { entityId: 'gallery-portrait-dragon', x: -4.5, y: 1.5, z: GALLERY_WALL_Z },
  { entityId: 'gallery-portrait-fox', x: -2.5, y: 1.5, z: GALLERY_WALL_Z },
];

/**
 * Filler frames on the gallery's side walls, so the three hero portraits
 * are not the only pictures in a room the content has always described as
 * a wall of portraits. Decorative: never raycast-interactive, never bound.
 */
export const GALLERY_FILLER_FRAME_SPOTS: readonly WallMountedSpot[] = [
  {
    entityId: 'gallery-filler-west-a',
    x: -8 + WALL_THICKNESS / 2 + WALL_MOUNT_CLEARANCE,
    y: 1.5,
    z: 7,
  },
  {
    entityId: 'gallery-filler-west-b',
    x: -8 + WALL_THICKNESS / 2 + WALL_MOUNT_CLEARANCE,
    y: 1.5,
    z: 8.5,
  },
  {
    entityId: 'gallery-filler-east-a',
    x: -1 - WALL_THICKNESS / 2 - WALL_MOUNT_CLEARANCE,
    y: 1.5,
    z: 7,
  },
  {
    entityId: 'gallery-filler-east-b',
    x: -1 - WALL_THICKNESS / 2 - WALL_MOUNT_CLEARANCE,
    y: 1.5,
    z: 8.5,
  },
  { entityId: 'gallery-filler-north-a', x: -7.5, y: 1.2, z: GALLERY_WALL_Z },
  { entityId: 'gallery-filler-north-b', x: -1.5, y: 1.2, z: GALLERY_WALL_Z },
];

// --- The Setting Tower (beat 4) --------------------------------------------

/**
 * Three floor-to-ceiling arched windows in the tower's round lantern room.
 * Ground floor, deliberately: `firstPersonController.ts` moves on a flat
 * plane with no step height, so the tower is a room, not a climb
 * (`docs/STORYKEEPER_CASTLE_3D_ROADMAP.md`, "no vertical traversal").
 */
export const TOWER_WINDOW_SPOTS: readonly WallMountedSpot[] = [
  {
    entityId: 'tower-window-island',
    x: 7.5,
    y: 1.6,
    z: 10 - WALL_THICKNESS / 2 - WALL_MOUNT_CLEARANCE,
  },
  {
    entityId: 'tower-window-mountain',
    x: 10 - WALL_THICKNESS / 2 - WALL_MOUNT_CLEARANCE,
    y: 1.6,
    z: 7.5,
  },
  {
    entityId: 'tower-window-cave',
    x: 7.5,
    y: 1.6,
    z: 5 + WALL_THICKNESS / 2 + WALL_MOUNT_CLEARANCE,
  },
];

// --- The Illustration Studio (beat 7) --------------------------------------

export const STUDIO_EASEL_SPOT: EntitySpot = { entityId: 'studio-easel', x: 7.5, z: 1 };

// --- The Costume Room (flavour only) ---------------------------------------

export const COSTUME_RACK_SPOTS: readonly EntitySpot[] = [
  { entityId: 'costume-rack-a', x: -6.5, z: -8.5 },
  { entityId: 'costume-rack-b', x: -4.5, z: -8.5 },
  { entityId: 'costume-rack-c', x: -2.5, z: -8.5 },
];

// --- The Great Library (beats 8, 9, 10) ------------------------------------

const LIBRARY_NORTH_WALL_Z = -2 - WALL_THICKNESS / 2 - WALL_MOUNT_CLEARANCE;
const LIBRARY_SOUTH_WALL_Z = -10 + WALL_THICKNESS / 2 + WALL_MOUNT_CLEARANCE;

/**
 * The empty shelf slot beat 8 eventually fills. Placed on the north wall
 * immediately inside the library archway, so the child walks past it every
 * single visit *before* they have a story to put in it - otherwise the
 * payoff lands on a shelf they never noticed.
 */
export const LIBRARY_SHELF_SLOT_SPOT: WallMountedSpot = {
  entityId: 'library-shelf-slot',
  x: 7,
  y: 1.4,
  z: LIBRARY_NORTH_WALL_Z,
};

/**
 * How far a floor-standing prop's centre sits from the wall band it backs
 * onto: half the depth of `bookshelf` and `shelf-slot-empty` alike. The
 * value is what `LAST_BOOKSHELF_SPOT` below was already authored with, made
 * explicit so the eleven shelves added for SC-6 sit on the same line.
 */
const WALL_BACKED_DEPTH_OFFSET = 0.2;

const LIBRARY_NORTH_SHELF_Z = -2 - WALL_THICKNESS / 2 - WALL_BACKED_DEPTH_OFFSET;
const LIBRARY_SOUTH_SHELF_Z = -10 + WALL_THICKNESS / 2 + WALL_BACKED_DEPTH_OFFSET;
const LIBRARY_WEST_SHELF_X = 5 + WALL_THICKNESS / 2 + WALL_BACKED_DEPTH_OFFSET;
const LIBRARY_EAST_SHELF_X = 15 - WALL_THICKNESS / 2 - WALL_BACKED_DEPTH_OFFSET;

/** A bookshelf standing against a wall: which way its 1.8m run lies, and how much of it to use. */
export interface BookshelfPlacement extends EntitySpot {
  /** The axis the run lies along. `bookshelf` is authored 1.8m wide, 0.4m deep. */
  axis: 'x' | 'z';
  /** Metres of shelf. Under 1.8 scales the model down, for a short bay. */
  width: number;
}

/**
 * The Great Library's bookshelves, which SC-2 owed and never placed
 * (`docs/STORYKEEPER_CASTLE_3D_ROADMAP.md` A.3). SC-6 needs them for a
 * reason beyond furnishing a bare room: beat 8's payoff is a book arriving
 * in a slot the child has walked past and *noticed*, and a lone slot on an
 * empty wall is not something anyone notices. Flanked by shelves it reads
 * as what it is, a gap where a book should be.
 *
 * The runs deliberately leave the wall real estate SC-8 and SC-9 have
 * already claimed clear: a bay either side of the shelf slot, a bay at the
 * clue wall, the whole south-east stretch for the pattern lock, the nine
 * counting stars and the secret door, and the west wall's archway.
 */
export const LIBRARY_BOOKSHELF_SPOTS: readonly BookshelfPlacement[] = [
  // North wall. The short bay is what makes the shelf slot a gap rather
  // than the end of a run.
  { entityId: 'library-shelf-north-a', x: 5.95, z: LIBRARY_NORTH_SHELF_Z, axis: 'x', width: 1 },
  { entityId: 'library-shelf-north-b', x: 8.45, z: LIBRARY_NORTH_SHELF_Z, axis: 'x', width: 1.8 },
  { entityId: 'library-shelf-north-c', x: 11.4, z: LIBRARY_NORTH_SHELF_Z, axis: 'x', width: 1.8 },
  { entityId: 'library-shelf-north-d', x: 13.2, z: LIBRARY_NORTH_SHELF_Z, axis: 'x', width: 1.8 },

  // South wall, west half only: everything east of x = 9.5 belongs to the
  // pattern lock, the counting stars, and the secret door.
  { entityId: 'library-shelf-south-a', x: 6.2, z: LIBRARY_SOUTH_SHELF_Z, axis: 'x', width: 1.8 },
  { entityId: 'library-shelf-south-b', x: 8.1, z: LIBRARY_SOUTH_SHELF_Z, axis: 'x', width: 1.8 },

  // West wall, either side of the archway in from the corridor.
  { entityId: 'library-shelf-west-a', x: LIBRARY_WEST_SHELF_X, z: -3.8, axis: 'z', width: 1.8 },
  { entityId: 'library-shelf-west-b', x: LIBRARY_WEST_SHELF_X, z: -8.3, axis: 'z', width: 1.8 },

  // East wall, stopping clear of the south-east corner SC-9's last
  // bookshelf swings out of.
  { entityId: 'library-shelf-east-a', x: LIBRARY_EAST_SHELF_X, z: -3.4, axis: 'z', width: 1.8 },
  { entityId: 'library-shelf-east-b', x: LIBRARY_EAST_SHELF_X, z: -5.3, axis: 'z', width: 1.8 },
  { entityId: 'library-shelf-east-c', x: LIBRARY_EAST_SHELF_X, z: -7.2, axis: 'z', width: 1.8 },
];

export const LIBRARY_READING_TABLE_SPOTS: readonly EntitySpot[] = [
  { entityId: 'library-reading-table-a', x: 8, z: -5 },
  { entityId: 'library-reading-table-b', x: 11.5, z: -7 },
];

/** Beat 9's three clues, in three separate spots so finding them is three finds and not one. */
export const LIBRARY_CLUE_SPOTS: readonly EntitySpot[] = [
  { entityId: 'library-clue-diary', x: 8, z: -4.7 },
  { entityId: 'library-clue-map', x: 5.6, z: -6.2 },
  { entityId: 'library-clue-note', x: 12, z: -2.4 },
];

/** Where the three clues get pinned in order, once all three are found. */
export const LIBRARY_CLUE_WALL_SPOT: WallMountedSpot = {
  entityId: 'library-clue-wall',
  x: 10,
  y: 1.6,
  z: LIBRARY_NORTH_WALL_Z,
};

/** The last bookshelf, in the far south-east corner - the deepest point in the castle. */
export const LAST_BOOKSHELF_SPOT: EntitySpot = { entityId: 'last-bookshelf', x: 14, z: -9.55 };

export const SECRET_DOOR_SPOT: WallMountedSpot = {
  entityId: 'secret-door',
  x: 12.6,
  y: 1.2,
  z: LIBRARY_SOUTH_WALL_Z,
};

/**
 * Beat 9's nine carved stars, in two rows of five and four **above** the
 * door - the counting task. They are deliberately a clear 1.6m away from
 * the pattern-lock carvings below, because a child counting nine stars must
 * never be unsure whether the lock's three stars are part of the count
 * (`docs/STORYKEEPER_CASTLE_3D_ROADMAP.md` A.10, risk 3).
 */
export const COUNTING_STAR_SPOTS: readonly WallMountedSpot[] = [
  ...[11.6, 12.1, 12.6, 13.1, 13.6].map((x, index) => ({
    entityId: `counting-star-top-${index + 1}`,
    x,
    y: 2.5,
    z: LIBRARY_SOUTH_WALL_Z,
  })),
  ...[11.85, 12.35, 12.85, 13.35].map((x, index) => ({
    entityId: `counting-star-bottom-${index + 1}`,
    x,
    y: 2.15,
    z: LIBRARY_SOUTH_WALL_Z,
  })),
];

/**
 * Beat 10's pattern lock: star, moon, star, moon, star, and one carving
 * worn too smooth to read. A vertical column *beside* the door rather than
 * a ring around it, so it never mixes with the nine stars above.
 */
export const LOCK_CARVING_SPOTS: readonly WallMountedSpot[] = [
  { entityId: 'lock-carving-1-star', x: 10.2, y: 0.9, z: LIBRARY_SOUTH_WALL_Z },
  { entityId: 'lock-carving-2-moon', x: 10.2, y: 1.2, z: LIBRARY_SOUTH_WALL_Z },
  { entityId: 'lock-carving-3-star', x: 10.2, y: 1.5, z: LIBRARY_SOUTH_WALL_Z },
  { entityId: 'lock-carving-4-moon', x: 10.2, y: 1.8, z: LIBRARY_SOUTH_WALL_Z },
  { entityId: 'lock-carving-5-star', x: 10.2, y: 2.1, z: LIBRARY_SOUTH_WALL_Z },
  { entityId: 'lock-carving-worn', x: 10.2, y: 2.4, z: LIBRARY_SOUTH_WALL_Z },
];

export const LOCK_ROD_RACK_SPOT: EntitySpot = { entityId: 'lock-rod-rack', x: 10.2, z: -9.4 };

/**
 * The three rods of beat 10, shortest to longest. Their entity ids bind to
 * `order-the-keys`' items; the step grades ordering by length, so SC-1 owes
 * three models whose lengths read unambiguously at eye height.
 */
export const LOCK_ROD_SPOTS: readonly EntitySpot[] = [
  { entityId: 'lock-rod-silver', x: 9.85, z: -9.4 },
  { entityId: 'lock-rod-iron', x: 10.2, z: -9.4 },
  { entityId: 'lock-rod-brass', x: 10.55, z: -9.4 },
];

// --- The entry hall --------------------------------------------------------

export const CASTLE_DOORS_SPOT: WallMountedSpot = {
  entityId: 'castle-doors',
  x: -16 + WALL_THICKNESS / 2 + WALL_MOUNT_CLEARANCE,
  y: 1.5,
  z: 0,
};

// --- Trigger zones ---------------------------------------------------------

/**
 * Every `APPROACH` trigger volume, keyed by the zone id the world view will
 * emit as `PlayerEnteredZone`. Ids match the Phaser castle's existing
 * `WorldInteraction.zoneId` vocabulary (`worldObjects.ts`) wherever the same
 * thing exists in both, so the two renderers never disagree about what a
 * zone is called.
 */
export const ZONES: readonly RectZone[] = [
  // The entry hall. `castle-entrance` sits well clear of `castle-harbor-exit`
  // so arriving never immediately reads as leaving.
  { id: 'castle-harbor-exit', minX: -15.7, maxX: -14.8, minZ: -2, maxZ: 2 },
  { id: 'castle-entrance', minX: -13.5, maxX: -11, minZ: -1.5, maxZ: 1.5 },

  // The hub. Fires as the child crosses toward Quill from the entry archway,
  // rather than once they are already on top of them.
  { id: 'castle-story-hall', minX: -7, maxX: -5, minZ: -1.5, maxZ: 1.5 },
  // The standing strip south of the lectern and its table, where a child
  // can reach the plates and the sockets without moving their feet.
  { id: 'castle-binding-lectern', minX: -1.8, maxX: 1.6, minZ: 0.6, maxZ: 1.3 },
  { id: 'castle-tapestry-stair', minX: -8.6, maxX: -7.2, minZ: -5.9, maxZ: -4.4 },

  { id: 'castle-character-gallery', minX: -7, maxX: -2, minZ: 8, maxZ: 9.6 },
  { id: 'castle-costume-room', minX: -6, maxX: -3, minZ: -9, maxZ: -7 },

  // The tower: one zone for entering the room, then one per window. The
  // window zones are the `choose-setting` triggers - approach, not raycast,
  // because a window is a place you stand at.
  // The three window zones must never touch, at a corner or anywhere else:
  // overlapping them would let one step forward stand at two settings at
  // once, and the choice would come down to listener order.
  { id: 'castle-setting-tower', minX: 5.4, maxX: 6.2, minZ: 6.6, maxZ: 8.4 },
  { id: 'tower-window-island', minX: 6.3, maxX: 8.2, minZ: 8.4, maxZ: 9.6 },
  { id: 'tower-window-mountain', minX: 8.4, maxX: 9.6, minZ: 6.4, maxZ: 8.2 },
  { id: 'tower-window-cave', minX: 6.3, maxX: 8.2, minZ: 5.4, maxZ: 6.6 },

  { id: 'castle-illustration-studio', minX: 6.5, maxX: 8.5, minZ: 0, maxZ: 2 },
  { id: 'castle-great-library', minX: 5.5, maxX: 8, minZ: -7, maxZ: -5 },
  { id: 'castle-last-bookshelf', minX: 11.8, maxX: 13.4, minZ: -9.2, maxZ: -7.8 },
];

export function findZone(zoneId: string): RectZone | undefined {
  return ZONES.find((zone) => zone.id === zoneId);
}

// --- Entity id registry ----------------------------------------------------

/** Every floor-standing spot this region authors, in one list. */
export const FLOOR_SPOTS: readonly EntitySpot[] = [
  KEEPER_QUILL_SPOT,
  QUILL_LECTERN_SPOT,
  HEARTH_SPOT,
  BINDING_LECTERN_SPOT,
  BINDING_TABLE_SPOT,
  ...STORY_PLATE_SPOTS,
  ...TAPESTRY_NOOK_CUSHION_SPOTS,
  STUDIO_EASEL_SPOT,
  ...COSTUME_RACK_SPOTS,
  ...LIBRARY_BOOKSHELF_SPOTS,
  ...LIBRARY_READING_TABLE_SPOTS,
  ...LIBRARY_CLUE_SPOTS,
  LAST_BOOKSHELF_SPOT,
  LOCK_ROD_RACK_SPOT,
  ...LOCK_ROD_SPOTS,
];

/** Every wall-mounted spot this region authors, in one list. */
export const WALL_MOUNTED_SPOTS: readonly WallMountedSpot[] = [
  HEARTH_MANTEL_SPOT,
  ...TAPESTRY_SPOTS,
  ...GALLERY_PORTRAIT_SPOTS,
  ...GALLERY_FILLER_FRAME_SPOTS,
  ...TOWER_WINDOW_SPOTS,
  LIBRARY_SHELF_SLOT_SPOT,
  LIBRARY_CLUE_WALL_SPOT,
  SECRET_DOOR_SPOT,
  ...COUNTING_STAR_SPOTS,
  ...LOCK_CARVING_SPOTS,
  CASTLE_DOORS_SPOT,
];

/**
 * The stable semantic id of everything placed in this region (ADR-008:
 * durable domain state is keyed by these, never by a Three.js object UUID).
 * `castleChoiceBindings.test.ts` asserts every binding's `entityId` appears
 * here, so a renamed prop cannot silently orphan a learning step.
 */
export const ALL_ENTITY_IDS: readonly string[] = [
  ...FLOOR_SPOTS.map((spot) => spot.entityId),
  ...WALL_MOUNTED_SPOTS.map((spot) => spot.entityId),
];

export const STORYKEEPER_CASTLE_REGION_CHECKPOINTS = STORYKEEPER_CASTLE_CHECKPOINTS;
