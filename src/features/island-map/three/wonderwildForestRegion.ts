import {
  WONDERWILD_FOREST_CHECKPOINTS,
  WONDERWILD_FOREST_REGION_ID,
} from '../../discovery/checkpoints';

/**
 * Pure content and geometry for Wonderwild Forest's first-person region
 * (`docs/WONDERWILD_FOREST_3D_ROADMAP.md` WF-0, building the plan in
 * `docs/WONDERWILD_FOREST_3D_STORYBOARD.md` section 3). Same split as
 * `welcomeHarborRegion.ts`/`pirateBuilderBayRegion.ts`/
 * `storykeeperCastleRegion.ts`: plain numbers, no `three` import, so this
 * stays unit-testable without a rendering context. `wonderwildForestScene.ts`
 * (WF-2) will be the only file that turns these numbers into `three` objects.
 *
 * **The castle's geometry model is inverted here, and that is the whole
 * design of this file.** A castle is rooms, so `storykeeperCastleRegion.ts`
 * authors floors and *derives walls* by subtracting doorway gaps from room
 * edges. A forest has no walls and no doorways. It has glades you can stand
 * in, trails between them, and trees everywhere else. So this file authors
 * the walkable set - `GLADES` plus `TRAILS` - and **derives the tree line as
 * its complement** (`buildTreeLineSegments`).
 *
 * Three things follow from that inversion, and each is why it is worth doing:
 *
 * - **There is no gap to leave open by accident.** A hand-listed tree line
 *   around eight irregular glades is two dozen rects that have to agree with
 *   each other; miss one and the child walks into the void. A complement
 *   cannot have a hole in it, and the test proves the cover is total.
 * - **No boundary walls are needed.** The complement runs to the ground
 *   extents, so the region encloses itself. `pirateBuilderBayRegion.ts` needs
 *   four `BOUNDARY_WALLS`; this one needs none.
 * - **It is far cheaper to collide against.** The complement of eight glades
 *   is roughly twenty wide boxes, against the castle's thirty-odd wall
 *   slivers, and `firstPersonController.ts` tests every collider every frame.
 *
 * **One thing is gated by geometry**, unlike the castle where nothing is: the
 * pond. `POND_WATER` is a collider inside the pond glade, for physical
 * realism only - no adventure is behind it, exactly as
 * `wonderwildForestTilemap.ts` already says of the Phaser forest's pond.
 *
 * Checkpoint *positions* are authored here; the checkpoint *id vocabulary and
 * persistence* live one layer down in `src/features/discovery/checkpoints.ts`,
 * per ADR-008's rule that World State must never depend on World Engine code.
 */

export const REGION_ID = WONDERWILD_FOREST_REGION_ID;

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

/** Strict overlap: two rects that merely share an edge do not overlap. */
export function rectsOverlap(a: RectZone, b: RectZone): boolean {
  return a.minX < b.maxX && b.minX < a.maxX && a.minZ < b.maxZ && b.minZ < a.maxZ;
}

/** 36m x 26m. Deliberately larger than the castle's 32x20: a forest should not read as a room. */
export const GROUND_HALF_EXTENT_X = 18;
export const GROUND_HALF_EXTENT_Z = 13;

/** Tree-line pieces thinner than this are dropped as authoring noise rather than emitted as slivers. */
const MIN_SEGMENT = 0.01;

export interface GladeDefinition {
  id: string;
  /** Child-facing name, used by the HUD toast when the child walks in. */
  label: string;
  /** The glade's walkable open ground. Tree line is generated around it. */
  ground: RectZone;
}

/**
 * The eight glades of the storyboard's plan. The Wonder Wall clearing is the
 * hub and every trail runs through it, so a child crossing the forest always
 * passes the stones - the same call the castle makes about the Story Hall and
 * Keeper Quill.
 *
 * Unlike the castle's rooms, no two glades touch. They are separated by real
 * tree line, and the only way between them is a trail.
 */
export const GLADES: readonly GladeDefinition[] = [
  {
    id: 'harbor-path',
    label: 'the path into the forest',
    // Stops short of the ground extent so the derived tree line can close
    // behind it: a glade that runs to the boundary leaves the child standing
    // on the edge of the world with nothing rendered beyond them.
    ground: { id: 'harbor-path:ground', minX: -17.5, maxX: -15, minZ: -3, maxZ: 3 },
  },
  {
    id: 'wonder-wall-clearing',
    label: 'the Wonder Wall',
    ground: { id: 'wonder-wall-clearing:ground', minX: -6, maxX: 6, minZ: -5, maxZ: 5 },
  },
  {
    id: 'hive-clearing',
    label: 'the hive clearing',
    ground: { id: 'hive-clearing:ground', minX: 9, maxX: 17, minZ: -4, maxZ: 4 },
  },
  {
    id: 'pond-glade',
    label: 'the pond',
    ground: { id: 'pond-glade:ground', minX: 4, maxX: 15, minZ: 6, maxZ: 12 },
  },
  {
    id: 'leaf-hollow',
    label: 'the leaf hollow',
    ground: { id: 'leaf-hollow:ground', minX: -16, maxX: -7, minZ: 5, maxZ: 12 },
  },
  {
    id: 'fern-bank',
    label: 'the fern bank',
    ground: { id: 'fern-bank:ground', minX: -16, maxX: -7, minZ: -12, maxZ: -5 },
  },
  {
    id: 'cave-mouth-glade',
    label: 'the cave mouth',
    ground: { id: 'cave-mouth-glade:ground', minX: 7, maxX: 16, minZ: -12, maxZ: -6 },
  },
  {
    id: 'night-clearing',
    label: 'the night clearing',
    ground: { id: 'night-clearing:ground', minX: -4, maxX: 5, minZ: -12, maxZ: -7 },
  },
];

/**
 * How worn a trail reads, which is this region's only wayfinding.
 *
 * - `main` - the way in and out. Always drawn.
 * - `worn` - the bee's trail. Storyboard beat 2: it is "worn wide and
 *   obvious", and it is the only reason a child leaving the Wonder Wall
 *   knows which way the hive is. No arrow, no waypoint marker, no forced
 *   camera move.
 * - `faint` - a question whose adventure is not built yet, or a place with
 *   only flavour at the end of it. Drawn, but barely.
 * - `none` - **walkable ground with nothing drawn on it at all.** This
 *   exists for exactly one connection, the fern bank, and it is what keeps
 *   beat 11's secret honest: a trail leading to the glowing moss would be a
 *   signpost pointing at the thing the storyboard insists nothing points at.
 *   The child gets there by wandering off the trail, so there has to be
 *   somewhere to wander that is not a trail.
 */
export type TrailWear = 'main' | 'worn' | 'faint' | 'none';

export interface TrailDefinition {
  id: string;
  /** The two glade ids this trail joins. Asserted to be real, distinct, and actually touched. */
  connects: readonly [string, string];
  wear: TrailWear;
  /**
   * The trail's own walkable rects. More than one for an L-shaped run. Each
   * end deliberately overlaps its glade by a metre or so rather than meeting
   * it on a line: two closed rects sharing an edge technically connect, but
   * a connection one grid sample wide is a connection waiting to be broken
   * by a rounding change.
   */
  rects: readonly RectZone[];
}

export const TRAILS: readonly TrailDefinition[] = [
  {
    id: 'harbor-path-to-hub',
    connects: ['harbor-path', 'wonder-wall-clearing'],
    wear: 'main',
    rects: [{ id: 'trail:harbor-path-to-hub:0', minX: -16, maxX: -5, minZ: -1, maxZ: 1 }],
  },
  {
    // Beat 2's wayfinding. Wider than every other trail on purpose.
    id: 'hub-to-hive-clearing',
    connects: ['wonder-wall-clearing', 'hive-clearing'],
    wear: 'worn',
    rects: [{ id: 'trail:hub-to-hive-clearing:0', minX: 5, maxX: 10, minZ: -1.5, maxZ: 1.5 }],
  },
  {
    id: 'hub-to-pond',
    connects: ['wonder-wall-clearing', 'pond-glade'],
    wear: 'faint',
    rects: [{ id: 'trail:hub-to-pond:0', minX: 4, maxX: 6, minZ: 4, maxZ: 7 }],
  },
  {
    id: 'hub-to-leaf-hollow',
    connects: ['wonder-wall-clearing', 'leaf-hollow'],
    wear: 'faint',
    rects: [
      { id: 'trail:hub-to-leaf-hollow:0', minX: -6, maxX: -4, minZ: 3, maxZ: 9 },
      { id: 'trail:hub-to-leaf-hollow:1', minX: -8, maxX: -4, minZ: 7, maxZ: 9 },
    ],
  },
  {
    id: 'hub-to-night-clearing',
    connects: ['wonder-wall-clearing', 'night-clearing'],
    wear: 'faint',
    rects: [{ id: 'trail:hub-to-night-clearing:0', minX: -1.5, maxX: 0.5, minZ: -8, maxZ: -4 }],
  },
  {
    id: 'hub-to-cave-mouth',
    connects: ['wonder-wall-clearing', 'cave-mouth-glade'],
    wear: 'faint',
    rects: [
      { id: 'trail:hub-to-cave-mouth:0', minX: 4, maxX: 6, minZ: -9, maxZ: -4 },
      { id: 'trail:hub-to-cave-mouth:1', minX: 4, maxX: 8, minZ: -9, maxZ: -7 },
    ],
  },
  {
    // `none`: open forest floor, never drawn as a path. See `TrailWear`.
    id: 'hub-to-fern-bank',
    connects: ['wonder-wall-clearing', 'fern-bank'],
    wear: 'none',
    rects: [
      { id: 'trail:hub-to-fern-bank:0', minX: -6, maxX: -4, minZ: -9, maxZ: -3 },
      { id: 'trail:hub-to-fern-bank:1', minX: -8, maxX: -4, minZ: -9, maxZ: -7 },
    ],
  },
];

/** Every walkable rect in the forest: the glades, plus the trails between them. */
export const OPEN_GROUND: readonly RectZone[] = [
  ...GLADES.map((glade) => glade.ground),
  ...TRAILS.flatMap((trail) => trail.rects),
];

/**
 * The pond itself, inside the pond glade. The forest's one collider that is
 * not a tree, and the only thing in the region gated by geometry - for
 * physical realism, never to lock an adventure behind it.
 */
export const POND_WATER: RectZone = {
  id: 'pond-water',
  minX: 6,
  maxX: 13,
  minZ: 7.5,
  maxZ: 11.5,
};

/**
 * The tree line, derived as the exact complement of `OPEN_GROUND` within the
 * ground extents by a column sweep: cut the region into vertical strips at
 * every glade and trail x-boundary, and in each strip emit the z-intervals no
 * open rect covers.
 *
 * Exported as a function as well as a constant so the test can rebuild it
 * from modified inputs (a trail removed, say) and prove the flood fill is
 * actually sensitive to the trails rather than passing trivially - the same
 * reason `buildWallSegments` is a function in the castle.
 */
export function buildTreeLineSegments(
  openGround: readonly RectZone[] = OPEN_GROUND,
  halfX: number = GROUND_HALF_EXTENT_X,
  halfZ: number = GROUND_HALF_EXTENT_Z,
): readonly RectZone[] {
  const cuts = new Set<number>([-halfX, halfX]);
  for (const rect of openGround) {
    if (rect.minX > -halfX && rect.minX < halfX) cuts.add(rect.minX);
    if (rect.maxX > -halfX && rect.maxX < halfX) cuts.add(rect.maxX);
  }
  const bounds = [...cuts].sort((a, b) => a - b);

  const segments: RectZone[] = [];
  const push = (minX: number, maxX: number, minZ: number, maxZ: number): void => {
    if (maxX - minX <= MIN_SEGMENT || maxZ - minZ <= MIN_SEGMENT) return;
    segments.push({ id: `tree-line:${segments.length}`, minX, maxX, minZ, maxZ });
  };

  for (let i = 0; i < bounds.length - 1; i += 1) {
    const stripMinX = bounds[i];
    const stripMaxX = bounds[i + 1];
    if (stripMaxX - stripMinX <= MIN_SEGMENT) continue;

    // Only rects spanning the whole strip count: a rect that merely clips it
    // would have produced a cut of its own, so this is exact rather than
    // approximate.
    const spans = openGround
      .filter((rect) => rect.minX <= stripMinX && rect.maxX >= stripMaxX)
      .map((rect) => ({ from: Math.max(rect.minZ, -halfZ), to: Math.min(rect.maxZ, halfZ) }))
      .filter((span) => span.to > span.from)
      .sort((a, b) => a.from - b.from);

    let cursor = -halfZ;
    for (const span of spans) {
      if (span.from > cursor) push(stripMinX, stripMaxX, cursor, span.from);
      cursor = Math.max(cursor, span.to);
    }
    if (cursor < halfZ) push(stripMinX, stripMaxX, cursor, halfZ);
  }

  return segments;
}

export const TREE_LINE_SEGMENTS: readonly RectZone[] = buildTreeLineSegments();

/** Every collider the controller gets: the tree line, plus the pond. */
export const COLLIDERS: readonly RectZone[] = [...TREE_LINE_SEGMENTS, POND_WATER];

/** Whether this point is on a glade or a trail. Outside every one is inside the trees. */
export function isOnOpenGround(x: number, z: number): boolean {
  return OPEN_GROUND.some((rect) => isInsideRect(x, z, rect));
}

/** Whether this point is inside the tree line or the pond. */
export function isBlocked(x: number, z: number): boolean {
  return COLLIDERS.some((collider) => isInsideRect(x, z, collider));
}

/** Whether a child could stand here: on open ground, and not in the trees or the water. */
export function isWalkable(x: number, z: number): boolean {
  return isOnOpenGround(x, z) && !isBlocked(x, z);
}

// --- Entity spots ----------------------------------------------------------

/** A prop, a character, or anything else the child can walk around or aim at. */
export interface EntitySpot {
  entityId: string;
  x: number;
  z: number;
}

/**
 * Beat 2's four carved stones, in a shallow arc across the north of the hub.
 * The outer two sit slightly further south so the arc curves toward a child
 * standing in the clearing rather than away from them.
 *
 * Order is authored, not incidental: it is the order
 * `wonderWallQuestions.ts` declares, so the stones read left to right in the
 * same order the HUD card lists them and a child using both routes is never
 * asked to re-map one onto the other.
 */
export const WONDER_STONE_SPOTS: readonly EntitySpot[] = [
  { entityId: 'wonder-stone-bee', x: -4.5, z: 3.8 },
  { entityId: 'wonder-stone-seed', x: -1.5, z: 4.2 },
  { entityId: 'wonder-stone-sun', x: 1.5, z: 4.2 },
  { entityId: 'wonder-stone-chrysalis', x: 4.5, z: 3.8 },
];

/**
 * Chatty, on the low uncarved stone at the centre of the arc. Flavour and a
 * narration anchor, so the `NARRATIVE` steps this adventure is mostly made of
 * come from a place rather than from nowhere. Not an NPC, no conversation,
 * and it never follows the child (storyboard section 9).
 */
export const CHATTY_PERCH_SPOT: EntitySpot = { entityId: 'wonderwild-chatty', x: 0, z: 4.4 };

/** The hive on its trunk, at the east end of the hive clearing. Beat 3, and the way in to beat 4. */
export const BEEHIVE_SPOT: EntitySpot = { entityId: 'wonderwild-beehive', x: 14.5, z: 0 };
export const HIVE_TRUNK_SPOT: EntitySpot = { entityId: 'wonderwild-hive-trunk', x: 15.4, z: 0 };

/**
 * Beat 10's payoff, and the reason it is authored in WF-0 rather than left to
 * the phase that swaps it: the bare patch has to be somewhere the child walks
 * past on the way to the hive and *notices*. SC-6 learned this the expensive
 * way - the castle's empty shelf slot was specified for SC-2, was not built
 * until SC-6 needed it, and by then it had to be furnished around after the
 * fact. So this spot sits beside the worn trail, not behind the hive.
 */
export const FLOWER_PATCH_SPOT: EntitySpot = {
  entityId: 'wonderwild-flower-patch',
  x: 10.5,
  z: 2.2,
};

/**
 * The frog sits on the bank rather than out on the water. Its flavour line
 * says "from a lily pad", and the lily pads are scenery on the pond; a spot
 * inside `POND_WATER` would be inside a collider, which is both unreachable
 * and unassertable.
 */
export const POND_FROG_SPOT: EntitySpot = { entityId: 'wonderwild-pond-frog', x: 7.5, z: 7.1 };

export const LEAF_PILE_SPOT: EntitySpot = { entityId: 'wonderwild-leaf-pile', x: -11, z: 8.5 };

/** Beat 11's unmarked secret. Deliberately far from every drawn trail - see `TrailWear`. */
export const GLOW_MOSS_SPOT: EntitySpot = { entityId: 'wonderwild-glow-moss', x: -12, z: -9 };

/** Beat 12. Gated on the jar by the discovery's own requirements, never by geometry. */
export const CAVE_MOUTH_SPOT: EntitySpot = { entityId: 'wonderwild-cave-mouth', x: 11.5, z: -11 };

/** The night clearing's ring of plain, uncarved stones. Flavour, and the one glade with no beat. */
export const NIGHT_STONE_SPOTS: readonly EntitySpot[] = [
  { entityId: 'night-stone-1', x: 0.5, z: -8.2 },
  { entityId: 'night-stone-2', x: 2.4, z: -9.1 },
  { entityId: 'night-stone-3', x: 1.7, z: -10.7 },
  { entityId: 'night-stone-4', x: -0.7, z: -10.7 },
  { entityId: 'night-stone-5', x: -1.4, z: -9.1 },
];

/**
 * The visiting butterfly, drawn only once `SAVE_THE_BUTTERFLY_GARDEN_COMPLETE`
 * is recorded elsewhere on the island - the cross-location state read
 * `wonderwildForestDecor.ts` already authors, carried over unchanged.
 */
export const BUTTERFLY_SPOT: EntitySpot = { entityId: 'wonderwild-butterfly', x: 5, z: 8 };

// --- Zones -----------------------------------------------------------------

/**
 * Every `APPROACH` trigger volume, keyed by the zone id the world view will
 * emit as `PlayerEnteredZone`. Ids match the Phaser forest's existing
 * `WorldInteraction.zoneId` vocabulary (`worldObjects.ts`) wherever the same
 * thing exists in both, so the two renderers never disagree about what a zone
 * is called.
 *
 * The four stone zones are the notable addition. Beat 2 is a raycast beat for
 * the bands that can aim, but the storyboard's age-band table gives Sprouts
 * `APPROACH` only, so each stone is *also* a place you can stand. They must
 * never touch: overlapping them would let one step forward stand at two
 * questions at once and the choice would come down to listener order, which
 * is the exact defect SC-0 found in the castle's three tower windows.
 */
export const ZONES: readonly RectZone[] = [
  // The way in, and the way out. Kept well apart so arriving never immediately
  // reads as leaving.
  { id: 'wonderwild-harbor-exit', minX: -17.2, maxX: -16.2, minZ: -2, maxZ: 2 },
  { id: 'wonderwild-harbor-path', minX: -15.5, maxX: -14, minZ: -1, maxZ: 1 },

  // The hub. Fires as the child crosses toward the stones.
  { id: 'wonderwild-wonder-wall', minX: -2, maxX: 2, minZ: 0, maxZ: 2 },
  { id: 'wonder-stone-bee', minX: -5.2, maxX: -3.8, minZ: 2.2, maxZ: 3.2 },
  { id: 'wonder-stone-seed', minX: -2.2, maxX: -0.8, minZ: 2.6, maxZ: 3.6 },
  { id: 'wonder-stone-sun', minX: 0.8, maxX: 2.2, minZ: 2.6, maxZ: 3.6 },
  { id: 'wonder-stone-chrysalis', minX: 3.8, maxX: 5.2, minZ: 2.2, maxZ: 3.2 },

  { id: 'wonderwild-hive-clearing', minX: 12, maxX: 14, minZ: -1, maxZ: 1 },

  // Clear of `POND_WATER` on purpose: a zone you cannot stand in never fires.
  { id: 'wonderwild-pond', minX: 7, maxX: 10, minZ: 6.2, maxZ: 7.2 },

  { id: 'wonderwild-leaf-pile', minX: -12, maxX: -10, minZ: 7.5, maxZ: 9.5 },
  { id: 'wonderwild-night-clearing', minX: -1, maxX: 2, minZ: -10.5, maxZ: -8.5 },
  { id: 'wonderwild-glow-moss', minX: -13, maxX: -11, minZ: -10, maxZ: -8 },
  { id: 'wonderwild-cave', minX: 10, maxX: 13, minZ: -11.5, maxZ: -9.5 },
];

export function findZone(zoneId: string): RectZone | undefined {
  return ZONES.find((zone) => zone.id === zoneId);
}

/** The zone ids that are `wonder-wall` triggers, in the stones' authored order. */
export const WONDER_STONE_ZONE_IDS: readonly string[] = WONDER_STONE_SPOTS.map(
  (spot) => spot.entityId,
);

// --- Entity id registry ----------------------------------------------------

/** Every spot this region authors, in one list. */
export const ALL_SPOTS: readonly EntitySpot[] = [
  ...WONDER_STONE_SPOTS,
  CHATTY_PERCH_SPOT,
  BEEHIVE_SPOT,
  HIVE_TRUNK_SPOT,
  FLOWER_PATCH_SPOT,
  POND_FROG_SPOT,
  LEAF_PILE_SPOT,
  GLOW_MOSS_SPOT,
  CAVE_MOUTH_SPOT,
  ...NIGHT_STONE_SPOTS,
  BUTTERFLY_SPOT,
];

/**
 * The stable semantic id of everything placed in this region (ADR-008:
 * durable domain state is keyed by these, never by a Three.js object UUID).
 * `wonderWallBindings.test.ts` asserts every binding's `entityId` appears
 * here, so a renamed stone cannot silently orphan a learning step.
 */
export const ALL_ENTITY_IDS: readonly string[] = ALL_SPOTS.map((spot) => spot.entityId);

export const WONDERWILD_FOREST_REGION_CHECKPOINTS = WONDERWILD_FOREST_CHECKPOINTS;
