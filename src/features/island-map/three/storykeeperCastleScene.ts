import {
  AnimationMixer,
  Box3,
  BoxGeometry,
  Clock,
  LoopOnce,
  LoopRepeat,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PointLight,
  Raycaster,
  Vector2,
  Vector3,
  type AnimationAction,
  type AnimationClip,
} from 'three';
import { createInstancedMeshFromAsset, instantiateAsset, loadAsset } from './assets/assetLoader';
import {
  resolveSpawnCheckpoint,
  STORYKEEPER_CASTLE_CHECKPOINTS,
} from '../../discovery/checkpoints';
import type { ThreeEngineHandle } from './ThreeGameContainer';
import { FirstPersonController } from './firstPersonController';
import { attachPointerControls } from './pointerControls';
import { hasApproached, isInRange, isInsideZone } from './sandboxTriggers';
import {
  APPROACH_RANGE_METERS,
  createSceneBootstrap,
  EYE_HEIGHT,
  placeWithLod,
  RAYCAST_RANGE_METERS,
  runPlacements,
  toBox3,
  WALL_HEIGHT,
} from './sceneKit';
import {
  ARCHWAYS,
  BINDING_LECTERN_SPOT,
  BINDING_SOCKET_LOCAL_X,
  BINDING_TABLE_SPOT,
  CASTLE_DOORS_SPOT,
  GALLERY_FILLER_FRAME_SPOTS,
  HEARTH_MANTEL_SPOT,
  HEARTH_SPOT,
  GALLERY_PORTRAIT_SPOTS,
  KEEPER_QUILL_ID,
  KEEPER_QUILL_SPOT,
  LIBRARY_BOOKSHELF_SPOTS,
  LIBRARY_READING_TABLE_SPOTS,
  LIBRARY_SHELF_SLOT_SPOT,
  QUILL_LECTERN_SPOT,
  REGION_ID,
  ROOMS,
  STORY_PLATE_SPOTS,
  STUDIO_EASEL_SPOT,
  TOWER_WINDOW_SPOTS,
  WALL_SEGMENTS,
  WALL_THICKNESS,
  ZONES,
  type BookshelfPlacement,
  type EntitySpot,
  type RectZone,
  type RoomSide,
  type WallMountedSpot,
} from './storykeeperCastleRegion';
import {
  BINDING_LECTERN_ENTITY_ID,
  BINDING_SOCKET_COUNT,
  isStoryPlateEntity,
} from './castleBindingLectern';
import { EASEL_CANVASES, resolveEaselCanvas } from './castleEaselCanvas';
import type { WorldEngineEventBus } from './worldEngineEvents';

/** `ground-tile-stone` and `ceiling-tile` are both authored as 4x4 slabs, so both scale from the same number. */
const SLAB_SIZE_METERS = 4;
/** `wall-stone` is `buildPlanePrimitive(2, 3)`: 2m across, and exactly `WALL_HEIGHT` tall. */
const WALL_PANEL_WIDTH_METERS = 2;
/** Kept off the floor plane by a hair so the two coplanar surfaces cannot z-fight. */
const CARPET_LIFT_METERS = 0.02;

/**
 * How brightly each room is lit, and the whole reason this map is authored
 * rather than derived: SC-2 asks for the Great Library to read as the
 * darkest point in the castle and the hearth corner as the warmest, which
 * is a statement about story, not about geometry. The library is the
 * deepest room and the one holding the secret door, so it stays dim enough
 * that walking in feels like going somewhere.
 *
 * Presentation only, which is why it lives here and not in
 * `storykeeperCastleRegion.ts` - that file must stay free of anything the
 * renderer owns (and free of any `three` import).
 *
 * The library was authored at 1.4 and raised to 2.4 in SC-6, when it turned
 * out that "dimmest room in the castle" and "you cannot make out the
 * furniture" are not the same statement. It is by some way the largest room
 * here and gets the same single ceiling lamp as a two-metre corridor, so it
 * was reading as a black void rather than as a dark library. It is still
 * the lowest number in this map, which is the claim SC-2 actually makes.
 */
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

/**
 * Which model stands for which authored entity. Presentation only, and
 * explicit rather than derived by string surgery on the entity id: the
 * region names things after where they are ('gallery-portrait-fox') and the
 * asset pack names them after what they are ('portrait-fox'), and those two
 * vocabularies are allowed to diverge.
 *
 * Each pair is a **state variant**, not a runtime material swap, per
 * `docs/THREE_WORLD_ASSET_CONVENTIONS.md`: both models load up front and
 * choosing toggles which one is visible, so a choice costs no fetch.
 */
interface ChoiceVariantAssets {
  plain: string;
  lit: string;
}

const GALLERY_PORTRAIT_ASSETS: Readonly<Record<string, ChoiceVariantAssets>> = {
  'gallery-portrait-puppy': { plain: 'portrait-puppy', lit: 'portrait-puppy-lit' },
  'gallery-portrait-dragon': { plain: 'portrait-dragon', lit: 'portrait-dragon-lit' },
  'gallery-portrait-fox': { plain: 'portrait-fox', lit: 'portrait-fox-lit' },
};

const TOWER_WINDOW_ASSETS: Readonly<Record<string, ChoiceVariantAssets>> = {
  'tower-window-island': { plain: 'window-view-island', lit: 'window-view-island-lit' },
  'tower-window-mountain': { plain: 'window-view-mountain', lit: 'window-view-mountain-lit' },
  'tower-window-cave': { plain: 'window-view-cave', lit: 'window-view-cave-lit' },
};

/**
 * How far a window's backdrop sits behind its frame, so it reads as
 * "outside" rather than painted on.
 *
 * Must stay under the region's own `WALL_MOUNT_CLEARANCE` (0.05m), which is
 * the whole gap between an authored wall-mounted spot and the wall panel
 * drawn behind it. The first value tried here was 0.18m, which put every
 * backdrop *inside* the 0.5m-thick wall and therefore behind the panel:
 * three windows opened onto blank stone, with nothing in the console to say
 * so. A window frame does not cut a hole in the wall, so anything beyond
 * the wall plane is simply not there.
 */
const WINDOW_VIEW_DEPTH_METERS = 0.02;

/** Warm firelight at the hub's hearth: the castle's brightest, warmest corner. */
const HEARTH_LIGHT_COLOR = 0xff9c3a;
/** Cool daylight spilling in through the castle doors on the west wall. */
const DOORWAY_LIGHT_COLOR = 0xdfeaff;

/** The centre line of one wall segment, running along its long axis. */
function wallCentreLine(wall: RectZone): {
  from: { x: number; z: number };
  to: { x: number; z: number };
} {
  const centreX = (wall.minX + wall.maxX) / 2;
  const centreZ = (wall.minZ + wall.maxZ) / 2;
  return wall.maxX - wall.minX >= wall.maxZ - wall.minZ
    ? { from: { x: wall.minX, z: centreZ }, to: { x: wall.maxX, z: centreZ } }
    : { from: { x: centreX, z: wall.minZ }, to: { x: centreX, z: wall.maxZ } };
}

/**
 * Which way is "into the room" for a wall on this side. Wall colliders
 * straddle the room edge 0.25m either side, so a shared edge produces two
 * overlapping colliders; drawing both rooms' panels on the *centre* line
 * would put two coplanar surfaces in the same place and make them shimmer.
 * Each room instead draws its own panel on its own inner face, which is
 * both correct (a shared wall does have two faces) and gives the wall a
 * readable 0.5m thickness in the archway openings.
 */
const INWARD_OFFSET: Readonly<Record<RoomSide, { x: number; z: number }>> = {
  north: { x: 0, z: -1 },
  south: { x: 0, z: 1 },
  east: { x: -1, z: 0 },
  west: { x: 1, z: 0 },
};

/**
 * Panel placements covering one wall segment exactly. `runPlacements` tiles
 * whole segments, which would overhang a wall whose length is not a
 * multiple of the panel width - and an overhang here is not cosmetic, it
 * would grow across an archway gap and brick up a doorway. Scaling each
 * panel to the exact quotient keeps every run flush inside its own segment.
 */
export function wallPanelPlacements(wall: RectZone) {
  const side = wall.id.split(':')[2] as RoomSide;
  const offset = INWARD_OFFSET[side] ?? { x: 0, z: 0 };
  const inset = WALL_THICKNESS / 2;
  const line = wallCentreLine(wall);
  const from = { x: line.from.x + offset.x * inset, z: line.from.z + offset.z * inset };
  const to = { x: line.to.x + offset.x * inset, z: line.to.z + offset.z * inset };

  const length = Math.hypot(to.x - from.x, to.z - from.z);
  const segments = Math.max(1, Math.round(length / WALL_PANEL_WIDTH_METERS));
  const panelWidth = length / segments;

  return runPlacements(from, to, WALL_PANEL_WIDTH_METERS).map((placement) => ({
    ...placement,
    scale: { x: panelWidth / WALL_PANEL_WIDTH_METERS },
  }));
}

/**
 * An archway spans its gap's long axis, so it takes the same yaw a wall
 * panel on that axis would. Exported, with `wallPanelPlacements`, only so
 * `storykeeperCastleScene.test.ts` can hold the one invariant that would
 * otherwise fail silently: a panel that creeps across a gap bricks up a
 * doorway visually while the collider still lets the child through, which
 * reads to a child as a wall they are not allowed to walk into.
 */
export function archwayRotationY(gap: RectZone): number {
  return gap.maxX - gap.minX >= gap.maxZ - gap.minZ ? 0 : -Math.PI / 2;
}

/**
 * The clips SC-3 drives on Keeper Quill, and the only ones any caller may
 * name. All three are authored in `npc-quill` (SC-1) and declared in
 * `assets/manifest.ts`.
 */
/**
 * The yaw that turns a wall-mounted prop to face into its room. Derived
 * from which of the room's four edges the prop is nearest rather than
 * authored per spot, so moving a portrait along its wall in
 * `storykeeperCastleRegion.ts` cannot leave it facing into the stonework.
 */
function facingIntoRoom(spot: { x: number; z: number }, floor: RectZone): number {
  const toNorth = floor.maxZ - spot.z;
  const toSouth = spot.z - floor.minZ;
  const toEast = floor.maxX - spot.x;
  const toWest = spot.x - floor.minX;
  const nearest = Math.min(toNorth, toSouth, toEast, toWest);
  if (nearest === toNorth) return Math.PI;
  if (nearest === toSouth) return 0;
  if (nearest === toEast) return -Math.PI / 2;
  return Math.PI / 2;
}

/**
 * The yaw that turns something at `from` to look at `to`, in the same
 * forward convention `firstPersonController.ts` uses: forward is
 * `(sin(yaw), cos(yaw))`. Exported for the test, because "Quill points at
 * the mantel" is a claim about a number that no rendering test can check
 * and a wrong sign would silently have him gesture at a wall.
 */
export function yawTowards(from: { x: number; z: number }, to: { x: number; z: number }): number {
  return Math.atan2(to.x - from.x, to.z - from.z);
}

/**
 * Where the three plates land on the binding lectern, in world x/z.
 *
 * `BINDING_SOCKET_LOCAL_X` is authored in the lectern's own frame (SC-0's
 * file owns the offsets; the same three numbers cut the sockets into the
 * model in `scripts/generate-world-assets.ts`), so this is the one place
 * that turns them by the lectern's facing. Exported and tested: a sign
 * error here seats plate one where plate three should go, and the child
 * would be reading their own answer back in the wrong order with nothing
 * anywhere reporting a fault.
 */
export function bindingSocketPositions(
  spot: { x: number; z: number },
  yaw: number,
): { x: number; z: number }[] {
  return BINDING_SOCKET_LOCAL_X.map((offsetX) => ({
    x: spot.x + offsetX * Math.cos(yaw),
    z: spot.z - offsetX * Math.sin(yaw),
  }));
}

export type QuillClipName = 'Idle' | 'Talk' | 'Point' | 'ReactConcerned' | 'Celebrate';

/**
 * What Quill turns to look at while a clip plays. Beat 2 points through the
 * north archway toward the Character Gallery; beat 5 points at the hearth
 * mantel across the hub. Everything else looks back at the child.
 */
export type QuillFacing = 'entry' | 'gallery' | 'hearth';

/** Quill faces the entry hall, so a child walking in from the west is looked at rather than away from. */
const QUILL_FACING_ENTRY_YAW = -Math.PI / 2;
/**
 * ...and turns to face the north archway to point through it. Beat 2's
 * gesture is the castle's only wayfinding, so it has to be legible: an arm
 * raised while still facing the child says "somewhere", whereas turning to
 * look where the arm goes says "there".
 */
const QUILL_FACING_GALLERY_YAW = 0;
/**
 * Beat 5's direction: across the hub at the hearth mantel. Derived rather
 * than authored, so moving either the hearth or Quill in
 * `storykeeperCastleRegion.ts` keeps the gesture pointing at the thing.
 */
const QUILL_FACING_HEARTH_YAW = yawTowards(KEEPER_QUILL_SPOT, HEARTH_MANTEL_SPOT);

const QUILL_FACING_YAW: Readonly<Record<QuillFacing, number>> = {
  entry: QUILL_FACING_ENTRY_YAW,
  gallery: QUILL_FACING_GALLERY_YAW,
  hearth: QUILL_FACING_HEARTH_YAW,
};

/** Half-extents of the colliders standing Quill and his lectern up as solid objects. */
const QUILL_COLLIDER_HALF_METERS = 0.45;
const LECTERN_COLLIDER_HALF_METERS = 0.35;

/**
 * The binding lectern faces the room, so its 1.3m desk runs across whatever
 * axis that leaves; the table is placed unturned, with its 1.4m top along x
 * where `STORY_PLATE_SPOTS` spreads the plates. Half-extents rather than a
 * measured `Box3` because colliders are handed to `FirstPersonController`
 * at construction, before any asset has loaded.
 */
const BINDING_LECTERN_HALF = { width: 0.68, depth: 0.26, height: 1.1 };
const BINDING_TABLE_HALF = { width: 0.72, depth: 0.35, height: 0.85 };
const EASEL_HALF = { width: 0.45, depth: 0.35, height: 1.6 };

/** `bookshelf` is authored 1.8m wide and 0.4m deep, and every shelf run scales from that. */
const BOOKSHELF_WIDTH_METERS = 1.8;
const BOOKSHELF_DEPTH_METERS = 0.4;
const BOOKSHELF_HEIGHT_METERS = 2.4;
/** `reading-table`, from `tableWithLegs(1.4, 0.8, 0.72, ...)`. */
const READING_TABLE_HALF = { width: 0.7, depth: 0.4, height: 0.8 };

/**
 * The carpet runner, in two pieces. The first is laid from the doors to
 * Keeper Quill and is always there; the second carries on through the hub
 * and appears only once the child's story is on the shelf (beat 8), so the
 * castle reads as having opened up rather than as having been decorated.
 */
const CARPET_RUN_TO_QUILL = { from: { x: -14.5, z: 0 }, to: { x: -5, z: 0 } };
const CARPET_RUN_THROUGH_HUB = { from: { x: -5, z: 0 }, to: { x: 2, z: 0 } };
const CARPET_TILE_METERS = 1.5;

/** How far in front of the eyes a picked-up plate is carried, and how far below them. */
const CARRY_FORWARD_METERS = 0.55;
const CARRY_DROP_METERS = 0.5;

export interface StorykeeperCastleEngine extends ThreeEngineHandle {
  /** Raycasts from the camera center and fires the matching event, if anything interactive is in range. */
  interact(): void;
  /**
   * Lights the chosen hero portrait and dims the other two, or clears the
   * gallery when passed `null`. Safe to call before the assets have loaded:
   * the choice is remembered and applied when they arrive, which is what
   * lets a returning child's portrait already be lit on the first frame.
   */
  showChosenHero(entityId: string | null): void;
  /** The Setting Tower's equivalent: brightens the chosen view, shutters the other two. */
  showChosenSetting(entityId: string | null): void;
  /**
   * Plays one authored clip on Keeper Quill, turning him to face `facing`
   * while it runs. `Talk` and `Idle` loop; `Point` and `ReactConcerned`
   * play once and *hold* at their end, per SC-1's note that the gesture is
   * wayfinding the child needs still there when they look up from the HUD.
   * A no-op until the asset has loaded, which is why nothing about the
   * conversation depends on it.
   */
  playQuillClip(clip: QuillClipName, facing?: QuillFacing): void;
  /**
   * Lifts every story plate back onto the table and empties the sockets.
   *
   * Called when `order-the-story` opens (so the step always starts from a
   * clean table, whatever the child was playing with beforehand) and when
   * the engine grades a seated order wrong. Beat 6 is explicit that a wrong
   * order costs nothing: no plate is destroyed, none is hidden, and the
   * child picks up again from where they started.
   */
  resetBindingPlates(): void;
  /**
   * Paints the Illustration Studio easel with the picture for this pair of
   * choices (`castleEaselCanvas.ts`), or blanks it when passed a pair that
   * is not yet complete. Safe to call before the assets have loaded, the
   * same as `showChosenHero`: the choice is remembered and applied on
   * arrival, which is what lets a resumed session find the page already
   * painted on the first frame.
   */
  showEaselPainting(heroOptionId: string | null, settingOptionId: string | null): void;
  /**
   * Beat 8, the world change. Puts the castle into its told-a-story state:
   * the bound book on the Great Library's shelf, the hearth lit, and the
   * carpet running on through the hub.
   *
   * The engine takes the same call at construction (`storyTold`) and from
   * the room when the `WORLD_CHANGE` step lands, so a child who finishes
   * the tale watches it happen and one who comes back tomorrow simply finds
   * it done - the same read-once-at-construction shape
   * `pirateBuilderBayRegion.ts` documents for the repaired bridge, and not
   * an animation replayed on every visit.
   */
  showStoryTold(told: boolean): void;
}

export interface StorykeeperCastleEngineOptions {
  /** The child's last saved checkpoint id (`ChildWorldState.lastCheckpointId`), if any. */
  startCheckpointId?: string;
  /** The hero portrait this child has already chosen in an open session, if any. */
  chosenHeroEntityId?: string | null;
  /** The tower window this child has already stood at in an open session, if any. */
  chosenSettingEntityId?: string | null;
  /** The hero option id this child has already chosen, if the easel is already earned. */
  paintedHeroOptionId?: string | null;
  /** The setting option id, likewise. Both are needed before the easel paints anything. */
  paintedSettingOptionId?: string | null;
  /** Whether this child has already earned `FIRST_STORY_TOLD`, read from their world changes. */
  storyTold?: boolean;
}

/**
 * Storykeeper Castle's first-person region
 * (`docs/STORYKEEPER_CASTLE_3D_ROADMAP.md` SC-2, "The walkable shell"):
 * the castle as architecture, built from SC-0's authored floor plan
 * (`storykeeperCastleRegion.ts`) out of SC-1's kit (`assets/manifest.ts`)
 * through `sceneKit.ts`'s shared helpers.
 *
 * SC-3 put Keeper Quill at his lectern in the hub, SC-4 hung the three hero
 * portraits and opened the three tower windows, and SC-5 furnished the two
 * rooms where the story is *made*: the binding lectern with its three
 * sockets and three plates (beat 6), and the Illustration Studio easel
 * (beat 7).
 *
 * Beat 6 is the first interaction in this region that is a puzzle rather
 * than a message. The scene owns all of it - which plate is in the child's
 * hands, which sockets are filled, where a lifted plate goes back to - and
 * owns no part of whether the arrangement is right: seating the third plate
 * emits `BuildActionRequested` carrying the order and stops there.
 * `castleBindingLectern.ts` turns that into an option-id answer and the
 * `ORDERING` step grades it, exactly as it grades the HUD list.
 *
 * It is also the first *indoor* region, and that drives two things nothing
 * outdoors needed. Rooms are walls with holes in them, so wall colliders
 * come from SC-0's derived `WALL_SEGMENTS` rather than a hand-listed
 * boundary; and the sky is no longer the ceiling, so every room gets a
 * `ceiling-tile` slab overhead and the light rig is dimmed hard
 * (`createSceneBootstrap`'s `lighting` override) so that individual rooms
 * can differ from one another at all.
 *
 * Rendering glue, like every existing `scenes/*.ts` Phaser scene and both
 * sibling Three.js regions: not unit tested here, since it needs a real
 * WebGL/DOM context. The geometry and ids it reads
 * (`storykeeperCastleRegion.ts`, `discovery/checkpoints.ts`) and the asset
 * pipeline it calls into (`assets/*.ts`, `sceneKit.ts`) are tested
 * independently.
 */
export function createStorykeeperCastleEngine(
  parent: HTMLDivElement,
  bus: WorldEngineEventBus,
  options: StorykeeperCastleEngineOptions = {},
): StorykeeperCastleEngine {
  // A dark stone background rather than a sky: indoors it is only ever seen
  // through the doorway gap, and a bright sky there would read as a hole.
  const { scene, camera, renderer } = createSceneBootstrap(parent, 0x14171d, {
    ambientIntensity: 0.3,
    sunIntensity: 0.25,
    sunPosition: { x: -14, y: 12, z: 2 },
  });

  /*
    Wall colliders, plus the two things standing on the floor of the hub.
    SC-0 flagged Quill's missing collider explicitly ("SC-2/SC-3 owe Quill a
    collider of their own; nothing in this file gives one, so today the
    child could walk through them"), and walking through the person you are
    about to talk to undoes the whole point of him being a place.
  */
  const standingCollider = (spot: { x: number; z: number }, half: number, height: number) =>
    new Box3(
      new Vector3(spot.x - half, 0, spot.z - half),
      new Vector3(spot.x + half, height, spot.z + half),
    );

  /**
   * A rectangular prop's collider, with its footprint turned by `yaw`. Every
   * yaw in this region is a right angle, so turning a footprint is a swap
   * rather than a rotation.
   */
  const propCollider = (
    spot: { x: number; z: number },
    half: { width: number; depth: number; height: number },
    yaw: number,
  ) => {
    const turned = Math.abs(Math.sin(yaw)) > 0.5;
    const halfX = turned ? half.depth : half.width;
    const halfZ = turned ? half.width : half.depth;
    return new Box3(
      new Vector3(spot.x - halfX, 0, spot.z - halfZ),
      new Vector3(spot.x + halfX, half.height, spot.z + halfZ),
    );
  };

  /*
    Both face south, toward the child rather than toward the room. The child
    arrives from the entry hall in the west and reads the workstation from
    in front of it, so `facingIntoRoom` - which would turn the lectern west
    to face the nearest wall - is the wrong rule for a piece of furniture
    with a working side. Facing south also lays the lectern's three sockets
    and the table's three plates out left to right across the child's view,
    which is the arrangement the ordering card shows.
  */
  const bindingLecternYaw = Math.PI;
  const bindingTableYaw = 0;
  /*
    An easel is looked at from the front, and the only way into the studio
    is the archway on its west wall - so it faces the doorway rather than
    whichever wall `facingIntoRoom` finds nearest (which is a tie here
    anyway, the easel sitting dead centre of a 5x4 room).
  */
  const easelYaw = -Math.PI / 2;

  const colliders: Box3[] = [
    ...WALL_SEGMENTS.map((wall) => toBox3(wall, 0, WALL_HEIGHT)),
    standingCollider(KEEPER_QUILL_SPOT, QUILL_COLLIDER_HALF_METERS, 2),
    standingCollider(QUILL_LECTERN_SPOT, LECTERN_COLLIDER_HALF_METERS, 1.2),
    propCollider(BINDING_LECTERN_SPOT, BINDING_LECTERN_HALF, bindingLecternYaw),
    propCollider(BINDING_TABLE_SPOT, BINDING_TABLE_HALF, bindingTableYaw),
    propCollider(STUDIO_EASEL_SPOT, EASEL_HALF, easelYaw),
    /*
      A bookshelf is 2.4m of solid wood standing 0.4m proud of the wall it
      backs onto, well clear of that wall's own collider - so without these
      the child walks through the library's furniture.
    */
    ...LIBRARY_BOOKSHELF_SPOTS.map((shelf) =>
      propCollider(
        shelf,
        {
          width: shelf.width / 2,
          depth: BOOKSHELF_DEPTH_METERS / 2,
          height: BOOKSHELF_HEIGHT_METERS,
        },
        shelf.axis === 'x' ? 0 : Math.PI / 2,
      ),
    ),
    ...LIBRARY_READING_TABLE_SPOTS.map((spot) => propCollider(spot, READING_TABLE_HALF, 0)),
  ];
  const controller = new FirstPersonController({ colliders });

  const spawn = resolveSpawnCheckpoint(REGION_ID, options.startCheckpointId);
  controller.position.set(spawn.x, 0, spawn.z);
  controller.yaw = spawn.yaw;

  // Interior lighting. One lamp per room at ceiling height, plus the two
  // named in SC-2: daylight through the west doors, and the hearth.
  for (const room of ROOMS) {
    const light = new PointLight(0xffffff, ROOM_LIGHT_INTENSITY[room.id] ?? 3, 0, 1.6);
    light.position.set(
      (room.floor.minX + room.floor.maxX) / 2,
      WALL_HEIGHT - 0.4,
      (room.floor.minZ + room.floor.maxZ) / 2,
    );
    scene.add(light);
  }

  const doorwayLight = new PointLight(DOORWAY_LIGHT_COLOR, 6, 0, 1.8);
  doorwayLight.position.set(CASTLE_DOORS_SPOT.x + 1.2, 2, CASTLE_DOORS_SPOT.z);
  scene.add(doorwayLight);

  const hearthLight = new PointLight(HEARTH_LIGHT_COLOR, 9, 0, 1.7);
  hearthLight.position.set(0, 1.2, -5.2);
  scene.add(hearthLight);

  /*
    Quill as a placeholder box until the real asset resolves, the same
    pattern both sibling regions use for Pip: the child sees someone
    standing there from the first frame rather than a person who pops into
    existence a beat later.
  */
  const quillPlaceholder = new Mesh(
    new BoxGeometry(0.4, 1.6, 0.3),
    new MeshStandardMaterial({ color: 0x4a5b8c }),
  );
  quillPlaceholder.position.set(KEEPER_QUILL_SPOT.x, 0, KEEPER_QUILL_SPOT.z);
  quillPlaceholder.rotation.y = QUILL_FACING_ENTRY_YAW;
  scene.add(quillPlaceholder);

  let quillMesh: Object3D = quillPlaceholder;
  let quillMixer: AnimationMixer | null = null;
  let quillClips = new Map<QuillClipName, AnimationClip>();
  let quillAction: AnimationAction | null = null;

  /** The clips that play once and hold, rather than looping. */
  const HELD_CLIPS: readonly QuillClipName[] = ['Point', 'ReactConcerned', 'Celebrate'];

  function playQuillClip(clip: QuillClipName, facing?: QuillFacing): void {
    const mixer = quillMixer;
    const authored = quillClips.get(clip);
    if (!mixer || !authored) return;

    const next = mixer.clipAction(authored);
    if (quillAction && quillAction !== next) {
      quillAction.fadeOut(0.2);
    }
    next.reset();
    const held = HELD_CLIPS.includes(clip);
    if (held) {
      next.setLoop(LoopOnce, 1);
      next.clampWhenFinished = true;
    } else {
      next.setLoop(LoopRepeat, Infinity);
      next.clampWhenFinished = false;
    }
    /*
      Where he looks. `Point` defaults to the gallery archway (beat 2's
      wayfinding, unchanged from SC-3); everything else defaults to the
      hall, which is also what turns him back after a held gesture - without
      it a child returning for a second conversation is talked to by someone
      still facing away from them.
    */
    quillMesh.rotation.y = QUILL_FACING_YAW[facing ?? (clip === 'Point' ? 'gallery' : 'entry')];
    next.fadeIn(0.2).play();
    quillAction = next;
  }

  /*
    Beats 3 and 4. Both variants of every portrait and every window view are
    loaded and added to the scene; choosing only flips which one is visible.
    The chosen ids are held here rather than read back from the meshes, so a
    choice made before the assets finish loading still lands.
  */
  const portraitVariants = new Map<string, { plain: Object3D; lit: Object3D }>();
  const windowVariants = new Map<string, { plain: Object3D; lit: Object3D }>();
  let chosenHeroEntityId: string | null = options.chosenHeroEntityId ?? null;
  let chosenSettingEntityId: string | null = options.chosenSettingEntityId ?? null;

  function applyVariants(
    variants: Map<string, { plain: Object3D; lit: Object3D }>,
    chosen: string | null,
  ): void {
    for (const [entityId, variant] of variants) {
      const isChosen = entityId === chosen;
      variant.lit.visible = isChosen;
      variant.plain.visible = !isChosen;
    }
  }

  function showChosenHero(entityId: string | null): void {
    chosenHeroEntityId = entityId;
    applyVariants(portraitVariants, chosenHeroEntityId);
  }

  function showChosenSetting(entityId: string | null): void {
    chosenSettingEntityId = entityId;
    applyVariants(windowVariants, chosenSettingEntityId);
  }

  /*
    Beat 6, the binding lectern. The scene owns where the plates *are*; it
    owns no part of whether the order is right. Seating the last plate emits
    the arrangement and stops - `castleBindingLectern.ts` turns it into an
    answer and the ORDERING step grades it.
  */
  interface StoryPlate {
    entityId: string;
    object: Object3D;
    /** Where it lies on the table, and where `resetBindingPlates` puts it back. */
    home: EntitySpot;
  }

  const storyPlates: StoryPlate[] = [];
  const socketPositions = bindingSocketPositions(BINDING_LECTERN_SPOT, bindingLecternYaw);
  /** Measured off the loaded lectern rather than authored, so a regenerated model cannot leave plates floating. */
  let socketHeight = 1.07;
  let carriedPlateId: string | null = null;
  const seatedPlateIds: string[] = [];

  function findPlate(entityId: string): StoryPlate | undefined {
    return storyPlates.find((plate) => plate.entityId === entityId);
  }

  /** Lays one plate flat on the table where it started. */
  function restPlateAtHome(plate: StoryPlate): void {
    plate.object.position.set(plate.home.x, BINDING_TABLE_HALF.height - 0.03, plate.home.z);
    plate.object.rotation.y = 0;
  }

  /** Seats the plates currently in the sockets, filling from socket one with no gaps. */
  function restSeatedPlates(): void {
    seatedPlateIds.forEach((entityId, index) => {
      const plate = findPlate(entityId);
      const socket = socketPositions[index];
      if (!plate || !socket) return;
      plate.object.position.set(socket.x, socketHeight, socket.z);
      plate.object.rotation.y = bindingLecternYaw;
    });
  }

  function resetBindingPlates(): void {
    carriedPlateId = null;
    seatedPlateIds.length = 0;
    for (const plate of storyPlates) {
      restPlateAtHome(plate);
    }
  }

  function pickUpPlate(entityId: string): void {
    const seatedAt = seatedPlateIds.indexOf(entityId);
    if (seatedAt >= 0) {
      seatedPlateIds.splice(seatedAt, 1);
      restSeatedPlates();
    }
    carriedPlateId = entityId;
    bus.emit('CollectiblePickedUp', { entityId });
  }

  function seatCarriedPlate(): void {
    const entityId = carriedPlateId;
    if (!entityId || seatedPlateIds.length >= BINDING_SOCKET_COUNT) return;
    seatedPlateIds.push(entityId);
    carriedPlateId = null;
    restSeatedPlates();
    if (seatedPlateIds.length === BINDING_SOCKET_COUNT) {
      bus.emit('BuildActionRequested', {
        entityId: BINDING_LECTERN_ENTITY_ID,
        order: [...seatedPlateIds],
      });
    }
  }

  /*
    Beat 7, the easel. All six canvas layers load up front and choosing
    flips which two are visible - the same state-variant convention the
    portraits and windows already use, so the picture costs no fetch at the
    moment the child finishes their story.
  */
  /** The lectern itself, once loaded: the raycast target a carried plate is seated on. */
  let bindingLecternMesh: Object3D | null = null;

  const easelGroup = new Object3D();
  easelGroup.position.set(STUDIO_EASEL_SPOT.x, 0, STUDIO_EASEL_SPOT.z);
  easelGroup.rotation.y = easelYaw;
  scene.add(easelGroup);
  const canvasLayers = new Map<string, Object3D>();
  let paintedHeroOptionId: string | null = options.paintedHeroOptionId ?? null;
  let paintedSettingOptionId: string | null = options.paintedSettingOptionId ?? null;

  /** Where the backdrop's own bottom-centre sits on the easel's page, in the easel's local frame. */
  const EASEL_PAGE_ORIGIN = { y: 0.91, z: 0.07 };

  /**
   * How far a canvas layer is squashed along its own depth axis.
   *
   * The pack's canvas pieces are built from the same primitives as
   * everything else, so a mountain peak is a 30cm-radius cone and a hero's
   * head is a cone too - and a cone standing 30cm out of a page is a
   * sculpture, not a picture. Looked at on the easel they read exactly like
   * that: the peak's base rim projects below the backdrop and the whole
   * thing catches the light in three dimensions.
   *
   * Squashing each layer to a couple of millimetres deep turns every one of
   * them into the flat-colour silhouette the storyboard asks for, without
   * re-authoring six shared assets - and it keeps the composition strictly
   * inside the page, since nothing can lean out of it any more.
   */
  const CANVAS_FLATTEN = 0.02;

  function applyEaselPainting(): void {
    const painting = resolveEaselCanvas(paintedHeroOptionId, paintedSettingOptionId);
    for (const [assetId, layer] of canvasLayers) {
      layer.visible =
        painting !== undefined &&
        (assetId === painting.heroAssetId || assetId === painting.settingAssetId);
    }
    if (!painting) return;
    const hero = canvasLayers.get(painting.heroAssetId);
    if (hero) {
      hero.position.set(
        painting.heroOffset.x,
        EASEL_PAGE_ORIGIN.y + painting.heroOffset.y,
        EASEL_PAGE_ORIGIN.z + 0.02,
      );
      hero.scale.set(painting.heroScale, painting.heroScale, CANVAS_FLATTEN);
    }
  }

  function showEaselPainting(heroOptionId: string | null, settingOptionId: string | null): void {
    paintedHeroOptionId = heroOptionId;
    paintedSettingOptionId = settingOptionId;
    applyEaselPainting();
  }

  /*
    Beat 8, the world change. Three state variants and one extra length of
    carpet, all loaded up front and toggled by visibility - the
    `bridge-plank`/`bridge-plank-repaired` precedent
    (`docs/THREE_WORLD_ASSET_CONVENTIONS.md`), so the change costs no fetch
    at the moment it happens and a returning child's castle is already
    changed on the first frame.

    Deliberately *not* carried over from the Phaser castle: its floor
    recolour. The promised consequence is that the child's story has a home
    on a shelf, so the shelf is the consequence; a differently coloured
    floor is a mood change dressed up as one.
  */
  let storyTold = options.storyTold ?? false;
  const toldVariants: { told: Object3D; untold: Object3D }[] = [];

  function applyStoryTold(): void {
    for (const variant of toldVariants) {
      variant.told.visible = storyTold;
      variant.untold.visible = !storyTold;
    }
  }

  function showStoryTold(told: boolean): void {
    storyTold = told;
    applyStoryTold();
  }

  /**
   * Places a wall-mounted prop. Every asset in the pack is ground-pivoted,
   * including the wall-mounted ones (SC-1 made that a single convention on
   * purpose), while `WallMountedSpot.y` is a *centre* height - so the model
   * has to be dropped by half its own measured height. Measuring it beats
   * a table of authored heights that would silently rot the first time an
   * asset is regenerated at a different size.
   */
  async function placeWallMounted(
    assetId: string,
    spot: WallMountedSpot,
    yaw: number,
    options: { outwardOffset?: number; standsOnFloor?: boolean } = {},
  ): Promise<Object3D> {
    const asset = await loadAsset(assetId);
    const object = asset.scene.clone(true);
    const size = new Box3().setFromObject(object).getSize(new Vector3());
    const outwardOffset = options.outwardOffset ?? 0;
    object.rotation.y = yaw;
    /*
      `standsOnFloor` is the Setting Tower's exception. Its windows are
      floor-to-ceiling by design (storyboard beat 4), and `window-frame` is
      2.7m tall, so centring it on the authored 1.6m spot leaves the whole
      window hanging 25cm clear of the floor. The authored `y` still places
      everything that is genuinely mounted on a wall.
    */
    object.position.set(
      spot.x - Math.sin(yaw) * outwardOffset,
      options.standsOnFloor ? 0 : spot.y - size.y / 2,
      spot.z - Math.cos(yaw) * outwardOffset,
    );
    scene.add(object);
    return object;
  }

  async function loadWorldContent(): Promise<void> {
    // Floors and ceilings: one slab per room, scaled to that room's exact
    // footprint, so a room's floor never spills outside its own walls the
    // way a fixed tile grid would at these non-multiple-of-4 sizes.
    const slabPlacements = (y: number) =>
      ROOMS.map((room) => ({
        position: {
          x: (room.floor.minX + room.floor.maxX) / 2,
          y,
          z: (room.floor.minZ + room.floor.maxZ) / 2,
        },
        scale: {
          x: (room.floor.maxX - room.floor.minX) / SLAB_SIZE_METERS,
          z: (room.floor.maxZ - room.floor.minZ) / SLAB_SIZE_METERS,
        },
      }));

    const wallPlacements = WALL_SEGMENTS.flatMap(wallPanelPlacements);

    const [floors, ceilings, walls] = await Promise.all([
      createInstancedMeshFromAsset('ground-tile-stone', slabPlacements(0)),
      createInstancedMeshFromAsset('ceiling-tile', slabPlacements(WALL_HEIGHT)),
      createInstancedMeshFromAsset('wall-stone', wallPlacements),
    ]);
    scene.add(floors, ceilings, walls);

    // Seven archways, placed individually: `archway` is multi-part (a
    // one-mesh archway cannot have a hole in it), and
    // `createInstancedMeshFromAsset` would silently keep only its first
    // jamb - the trap SC-1 documented on this exact asset.
    await Promise.all(
      ARCHWAYS.map((archway) =>
        placeWithLod(
          scene,
          'archway',
          {
            x: (archway.gap.minX + archway.gap.maxX) / 2,
            z: (archway.gap.minZ + archway.gap.maxZ) / 2,
          },
          archwayRotationY(archway.gap),
        ),
      ),
    );

    /*
      A carpet from the doors to Keeper Quill's lectern. The only wayfinding
      in the castle, and deliberately the kind that cannot be wrong: it
      points at the hub every route passes through anyway.

      Beat 8 extends it on through the hub, so the second run is built the
      same way and simply hidden until the story is told.
    */
    const carpetRun = (run: { from: { x: number; z: number }; to: { x: number; z: number } }) =>
      createInstancedMeshFromAsset(
        'carpet',
        runPlacements(run.from, run.to, CARPET_TILE_METERS).map((placement) => ({
          ...placement,
          position: { ...placement.position, y: CARPET_LIFT_METERS },
        })),
      );

    const [carpet, carpetExtension] = await Promise.all([
      carpetRun(CARPET_RUN_TO_QUILL),
      carpetRun(CARPET_RUN_THROUGH_HUB),
    ]);
    scene.add(carpet, carpetExtension);
    /*
      An extension with no "before" state: an empty Object3D stands in for
      the untold half of the pair, so `applyStoryTold` can treat it exactly
      like the two real state variants rather than special-casing it.
    */
    toldVariants.push({ told: carpetExtension, untold: new Object3D() });

    // The doors themselves, so the way out is a thing you can see from
    // inside rather than an invisible trigger on a blank wall.
    await placeWithLod(
      scene,
      'door',
      { x: CASTLE_DOORS_SPOT.x, z: CASTLE_DOORS_SPOT.z },
      -Math.PI / 2,
    );

    /*
      The hearth, in both states. SC-2 lit this corner as the warmest in the
      castle and left nothing under the light, so the fireplace itself was
      placed then; beat 8 lights it, which is the second half of the pair
      SC-1 authored (`hearth` / `hearth-lit`).
    */
    const [hearth, hearthLit] = await Promise.all([
      instantiateAsset('hearth'),
      instantiateAsset('hearth-lit'),
    ]);
    for (const model of [hearth, hearthLit]) {
      model.position.set(HEARTH_SPOT.x, 0, HEARTH_SPOT.z);
      scene.add(model);
    }
    toldVariants.push({ told: hearthLit, untold: hearth });

    // Beat 2: Quill's lectern, with the blank page the story fills.
    await placeWithLod(scene, 'lectern', QUILL_LECTERN_SPOT, QUILL_FACING_ENTRY_YAW);

    await loadBindingLectern();
    await loadEasel();
    await loadGreatLibrary();
    applyStoryTold();

    // Keeper Quill: swap the placeholder box for the real, animated asset.
    const quill = await loadAsset('npc-quill');
    const quillScene = quill.scene.clone(true);
    quillScene.position.set(KEEPER_QUILL_SPOT.x, 0, KEEPER_QUILL_SPOT.z);
    quillScene.rotation.y = QUILL_FACING_ENTRY_YAW;
    quillScene.name = 'Keeper Quill';
    scene.add(quillScene);
    quillPlaceholder.visible = false;
    quillMesh = quillScene;

    quillMixer = new AnimationMixer(quillScene);
    quillClips = new Map(
      (['Idle', 'Talk', 'Point', 'ReactConcerned', 'Celebrate'] as const).flatMap((name) => {
        const clip = quill.animations.find((candidate) => candidate.name === name);
        return clip ? [[name, clip] as const] : [];
      }),
    );
    playQuillClip('Idle');

    await loadChoiceRooms();
  }

  /**
   * Beat 6: the binding lectern, its table, and the three plates. The
   * lectern's own height is measured rather than authored - a seated plate
   * has to sit *in* the socket, and a regenerated model with a taller
   * pillar would otherwise leave three plates hovering above it with
   * nothing to report the fault.
   */
  async function loadBindingLectern(): Promise<void> {
    const lectern = await instantiateAsset('binding-lectern');
    lectern.position.set(BINDING_LECTERN_SPOT.x, 0, BINDING_LECTERN_SPOT.z);
    lectern.rotation.y = bindingLecternYaw;
    lectern.name = 'Binding lectern';
    scene.add(lectern);
    socketHeight = new Box3().setFromObject(lectern).max.y;
    bindingLecternMesh = lectern;

    await placeWithLod(scene, 'binding-table', BINDING_TABLE_SPOT, bindingTableYaw);

    for (const spot of STORY_PLATE_SPOTS) {
      const object = await instantiateAsset(spot.entityId);
      object.name = spot.entityId;
      scene.add(object);
      storyPlates.push({ entityId: spot.entityId, object, home: spot });
    }
    /*
      Lay them out through the same call the wrong-order path uses, so
      "where a plate rests" has exactly one implementation. A session
      resumed mid-step starts from a clean table, which is also what the
      HUD ordering list starts from.
    */
    resetBindingPlates();
  }

  /**
   * The Great Library, and beat 8's shelf slot (SC-6).
   *
   * The shelves are the debt SC-2 left: it built the room and furnished
   * none of it. They are not decoration here - beat 8's payoff is a book
   * arriving in a slot the child has already walked past and noticed, and a
   * lone slot on a bare wall is not something anyone notices. Flanked by
   * shelves, with a deliberate short bay beside it, it reads as a gap where
   * a book should be.
   *
   * Every shelf is one draw call: `bookshelf` is authored single-mesh
   * precisely so a wall of them can be instanced, and the per-shelf `width`
   * rides in as an x scale.
   */
  async function loadGreatLibrary(): Promise<void> {
    const library = ROOMS.find((room) => room.id === 'great-library');
    if (!library) return;

    const shelfPlacement = (shelf: BookshelfPlacement) => ({
      position: { x: shelf.x, y: 0, z: shelf.z },
      // A shelf on a side wall is the same model turned a quarter turn.
      rotationY: shelf.axis === 'x' ? 0 : -Math.PI / 2,
      scale: { x: shelf.width / BOOKSHELF_WIDTH_METERS },
    });

    const shelves = await createInstancedMeshFromAsset(
      'bookshelf',
      LIBRARY_BOOKSHELF_SPOTS.map(shelfPlacement),
    );
    scene.add(shelves);

    for (const spot of LIBRARY_READING_TABLE_SPOTS) {
      await placeWithLod(scene, 'reading-table', spot, 0);
    }

    // Beat 8's slot: empty on every visit until the tale is told.
    const yaw = facingIntoRoom(LIBRARY_SHELF_SLOT_SPOT, library.floor);
    const [empty, shelved] = await Promise.all([
      placeWallMounted('shelf-slot-empty', LIBRARY_SHELF_SLOT_SPOT, yaw),
      placeWallMounted('story-book-shelved', LIBRARY_SHELF_SLOT_SPOT, yaw),
    ]);
    toldVariants.push({ told: shelved, untold: empty });
  }

  /** Beat 7: the easel, and all six canvas layers, hidden until a story earns one. */
  async function loadEasel(): Promise<void> {
    await placeWithLod(scene, 'easel', STUDIO_EASEL_SPOT, easelYaw);

    const layerIds = new Set(
      EASEL_CANVASES.flatMap((entry) => [entry.settingAssetId, entry.heroAssetId]),
    );
    for (const assetId of layerIds) {
      const layer = await instantiateAsset(assetId);
      layer.position.set(0, EASEL_PAGE_ORIGIN.y, EASEL_PAGE_ORIGIN.z);
      layer.scale.z = CANVAS_FLATTEN;
      layer.visible = false;
      easelGroup.add(layer);
      canvasLayers.set(assetId, layer);
    }
    applyEaselPainting();
  }

  /**
   * Beats 3 and 4: the Character Gallery and the Setting Tower. Split out
   * from `loadWorldContent` because these two rooms are the phase - the
   * first place where answering a learning step means going somewhere.
   */
  async function loadChoiceRooms(): Promise<void> {
    const gallery = ROOMS.find((room) => room.id === 'character-gallery');
    const tower = ROOMS.find((room) => room.id === 'setting-tower');
    if (!gallery || !tower) return;

    // The three hero portraits, both states each, hung on the north wall.
    for (const spot of GALLERY_PORTRAIT_SPOTS) {
      const assets = GALLERY_PORTRAIT_ASSETS[spot.entityId];
      if (!assets) continue;
      const yaw = facingIntoRoom(spot, gallery.floor);
      const [plain, lit] = await Promise.all([
        placeWallMounted(assets.plain, spot, yaw),
        placeWallMounted(assets.lit, spot, yaw),
      ]);
      portraitVariants.set(spot.entityId, { plain, lit });
    }
    applyVariants(portraitVariants, chosenHeroEntityId);

    /*
      The filler frames. Decorative and never interactive, but not
      optional: without them the three portraits that *are* the choice are
      the only pictures in a room the content has called a wall of
      portraits since Phase 14, which would make the choice look like the
      whole room rather than three things in it.
    */
    for (const spot of GALLERY_FILLER_FRAME_SPOTS) {
      await placeWallMounted('portrait-frame', spot, facingIntoRoom(spot, gallery.floor));
    }

    // The three tower windows: a frame, and a backdrop sitting beyond it.
    for (const spot of TOWER_WINDOW_SPOTS) {
      const assets = TOWER_WINDOW_ASSETS[spot.entityId];
      if (!assets) continue;
      const yaw = facingIntoRoom(spot, tower.floor);
      const [, plain, lit] = await Promise.all([
        placeWallMounted('window-frame', spot, yaw, { standsOnFloor: true }),
        placeWallMounted(assets.plain, spot, yaw, {
          outwardOffset: WINDOW_VIEW_DEPTH_METERS,
          standsOnFloor: true,
        }),
        placeWallMounted(assets.lit, spot, yaw, {
          outwardOffset: WINDOW_VIEW_DEPTH_METERS,
          standsOnFloor: true,
        }),
      ]);
      windowVariants.set(spot.entityId, { plain, lit });
    }
    applyVariants(windowVariants, chosenSettingEntityId);
  }

  void loadWorldContent();

  /*
    Quill is the only raycast target in the castle. Kept as a list anyway,
    matching `pirateBuilderBayScene.ts`, because SC-4 adds three portraits
    to it and SC-5 onward keep adding - a one-off special case for him now
    would only be unpicked then.
  */
  const raycastTargets: readonly { entityId: string; mesh: () => Object3D | null }[] = [
    { entityId: KEEPER_QUILL_ID, mesh: () => quillMesh },
    /*
      Beat 3 aims at whichever portrait state is currently showing, so a
      chosen (lit) portrait stays interactive rather than becoming a hole
      in the wall the reticle passes straight through.
    */
    ...GALLERY_PORTRAIT_SPOTS.map((spot) => ({
      entityId: spot.entityId,
      mesh: () => {
        const variant = portraitVariants.get(spot.entityId);
        if (!variant) return null;
        return variant.lit.visible ? variant.lit : variant.plain;
      },
    })),
    /*
      Beat 6. A carried plate is excluded from its own raycast: it hangs
      15cm off the end of the camera, so leaving it in would make it the
      nearest hit every frame and the child could never aim at anything
      else, the lectern included.
    */
    ...STORY_PLATE_SPOTS.map((spot) => ({
      entityId: spot.entityId,
      mesh: () =>
        carriedPlateId === spot.entityId ? null : (findPlate(spot.entityId)?.object ?? null),
    })),
    { entityId: BINDING_LECTERN_ENTITY_ID, mesh: () => bindingLecternMesh },
  ];

  const raycaster = new Raycaster();
  raycaster.far = RAYCAST_RANGE_METERS;

  function raycastFocus(): string | null {
    raycaster.setFromCamera(new Vector2(0, 0), camera);
    let closestId: string | null = null;
    let closestDistance = Infinity;
    for (const target of raycastTargets) {
      const mesh = target.mesh();
      if (!mesh) continue;
      const hits = raycaster.intersectObject(mesh, true);
      if (hits.length > 0 && hits[0].distance < closestDistance) {
        closestDistance = hits[0].distance;
        closestId = target.entityId;
      }
    }
    return closestId;
  }

  function interact(): void {
    const focused = raycastFocus();
    if (!focused) return;

    /*
      Beat 6 is the one interaction in the castle that is not "tell the
      domain something happened" - picking a plate up and putting it down
      are moves inside a physical puzzle, and only the completed
      arrangement is worth an event. One plate at a time, and a plate
      already in a socket can be lifted back out, so a child who seats them
      in the wrong order can fix it without submitting first.
    */
    if (isStoryPlateEntity(focused)) {
      if (carriedPlateId) return;
      pickUpPlate(focused);
      return;
    }
    if (focused === BINDING_LECTERN_ENTITY_ID) {
      if (carriedPlateId) seatCarriedPlate();
      return;
    }

    bus.emit('ObjectInteracted', { entityId: focused, interactionId: `${focused}:interact` });
  }

  const pointerControls = attachPointerControls(renderer, controller, { onInteract: interact });

  const approachZones = ZONES.map((zone) => ({
    id: zone.id,
    box: toBox3(zone, -1, 3),
    wasInside: false,
  }));
  const checkpointZones = STORYKEEPER_CASTLE_CHECKPOINTS.map((checkpoint) => ({
    id: checkpoint.id,
    box: new Box3(
      new Vector3(checkpoint.x - 1.2, -1, checkpoint.z - 1.2),
      new Vector3(checkpoint.x + 1.2, 3, checkpoint.z + 1.2),
    ),
    wasInside: false,
  }));

  const quillPosition = new Vector3(KEEPER_QUILL_SPOT.x, 0, KEEPER_QUILL_SPOT.z);
  let wasNearQuill = false;
  let wasFocused: string | null = null;
  const clock = new Clock();

  function frame(): void {
    const delta = Math.min(clock.getDelta(), 0.1);

    pointerControls.update(delta);

    camera.position.set(controller.position.x, EYE_HEIGHT, controller.position.z);
    camera.rotation.y = controller.yaw + Math.PI;
    camera.rotation.x = controller.pitch;

    quillMixer?.update(delta);

    // A carried plate rides in front of the eyes, held level like a tray.
    const carried = carriedPlateId ? findPlate(carriedPlateId) : undefined;
    if (carried) {
      carried.object.position.set(
        controller.position.x + Math.sin(controller.yaw) * CARRY_FORWARD_METERS,
        EYE_HEIGHT - CARRY_DROP_METERS,
        controller.position.z + Math.cos(controller.yaw) * CARRY_FORWARD_METERS,
      );
      carried.object.rotation.y = controller.yaw;
    }

    // Beat 2. `NpcApproached` fires on the crossing, not every frame inside
    // the radius, so `recordCharacterMet` is written once per approach.
    const nearQuillNow = isInRange(controller.position, quillPosition, APPROACH_RANGE_METERS);
    if (hasApproached(controller.position, quillPosition, APPROACH_RANGE_METERS, wasNearQuill)) {
      bus.emit('NpcApproached', { entityId: KEEPER_QUILL_ID });
    }
    wasNearQuill = nearQuillNow;

    const focusedNow = raycastFocus();
    if (focusedNow !== wasFocused) {
      bus.emit('InteractableFocused', { entityId: focusedNow });
    }
    wasFocused = focusedNow;

    for (const zone of [...approachZones, ...checkpointZones]) {
      const insideNow = isInsideZone(controller.position, zone.box);
      if (insideNow && !zone.wasInside) {
        bus.emit('PlayerEnteredZone', { zoneId: zone.id });
      }
      zone.wasInside = insideNow;
    }

    renderer.render(scene, camera);
    animationFrameId = requestAnimationFrame(frame);
  }

  let animationFrameId = requestAnimationFrame(frame);

  function dispose(): void {
    cancelAnimationFrame(animationFrameId);
    pointerControls.dispose();
    renderer.dispose();
    parent.removeChild(renderer.domElement);
  }

  return {
    dispose,
    interact,
    playQuillClip,
    resetBindingPlates,
    showChosenHero,
    showChosenSetting,
    showEaselPainting,
    showStoryTold,
  };
}
