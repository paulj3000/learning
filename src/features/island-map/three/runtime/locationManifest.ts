import type { WorldInteraction, WorldRequirement } from '../../worldObjects';
import type { AgeBandValue } from '../../../child-profile/constants';
import type { AdventureStepBinding } from './adventureStepBindings';

/**
 * The serializable contract a generic Three.js location runtime reads
 * (`docs/engine/01_TARGET_ARCHITECTURE.md`, `docs/engine/10_IMPLEMENTATION_PHASES.md`
 * Phase 1, ADR-025 in `docs/DECISIONS.md`). One manifest describes *what
 * exists in a region and where*; the runtime that will turn it into `three`
 * objects owns *how* (renderer lifecycle, controller, raycasts, disposal).
 *
 * Every type here is plain JSON: numbers, strings, booleans, arrays and
 * plain objects. No functions, no `three` objects, no React components, so a
 * manifest can later be stored as an Admin-authored draft and published
 * snapshot (`docs/engine/02_CONTENT_MODEL_STRATEGY.md` Stage B) without its
 * meaning changing. `validateLocationManifest.ts` asserts this at runtime.
 *
 * The shapes are lifted from what the existing `*Region.ts` modules already
 * author (`RectZone`, `BuildingDefinition`, entity spots, kit clusters and
 * runs) rather than invented, so migrating a region is moving its numbers,
 * not redesigning them. See `docs/platform/THREE_LOCATION_DUPLICATION_AUDIT.md`.
 *
 * Bindings to domain behaviour reuse `WorldInteraction` (`../../worldObjects.ts`)
 * unchanged: a manifest entity names an interaction id, and the interaction's
 * existing `WorldAction` (TALK_TO, DISCOVER, START_ADVENTURE, START_STORY,
 * NAVIGATE, SHOW_MESSAGE) hands off to the engine that owns the meaning.
 * `adventureBindings` (Phase 8) is the one step finer: a thing in the room
 * standing for an option of an adventure step the Adventure Engine still
 * owns. See `adventureStepBindings.ts`.
 */

export const LOCATION_MANIFEST_SCHEMA_VERSION = 1;

/** A point on the ground plane, in world x/z meters. */
export interface GroundPoint {
  x: number;
  z: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * A rectangular footprint or trigger volume on the ground plane. The same
 * shape every `*Region.ts` already declares locally, so their constants are
 * assignable to it without conversion.
 */
export interface RectZone {
  id: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export type WallSide = 'north' | 'south' | 'east' | 'west';

/**
 * The walkable rectangle. The runtime derives the four boundary colliders
 * from it (every current region hand-writes the same four `BOUNDARY_WALLS`).
 */
export interface BoundsSpec {
  halfExtentX: number;
  halfExtentZ: number;
  wallThickness: number;
}

/** Mirrors `sceneKit.ts`'s `SceneLighting`; omitted fields keep the outdoor default rig. */
export interface LightingSpec {
  ambientIntensity?: number;
  sunIntensity?: number;
  sunPosition?: Vec3;
}

/**
 * One state-dependent override of the environment, merged field by field
 * over the base. The first variant whose requirements hold wins, so order is
 * most specific first.
 *
 * This is how a region *looks* different once a child has changed it: a
 * harbour whose sky lifts and whose light comes up when its lighthouse
 * turns again. The alternative was a scene that reads world state itself,
 * which is what every per-region scene used to do.
 */
export interface EnvironmentVariant {
  requirements?: readonly WorldRequirement[];
  backgroundColor?: number;
  lighting?: LightingSpec;
}

export interface EnvironmentSpec {
  /** Sky/clear colour as a 24-bit RGB integer (e.g. `0x8fc7e6`). */
  backgroundColor: number;
  lighting?: LightingSpec;
  /** Overrides for a changed world; first match wins. */
  variants?: readonly EnvironmentVariant[];
}

/**
 * Which authored checkpoints this location spawns at and saves.
 *
 * Checkpoint ids, labels and positions stay owned by the World State layer
 * (`src/features/discovery/checkpoints.ts`, ADR-008), so the manifest
 * references them by id rather than restating coordinates. `ids` must list
 * exactly that region's authored checkpoints, in authored order, because
 * `resolveSpawnCheckpoint` falls back to the first one.
 */
export interface CheckpointSpec {
  ids: readonly string[];
  /** Half the side of the square trigger volume around each checkpoint, in meters. */
  triggerHalfSize: number;
}

/** A solid, invisible collider. Visible geometry that should block movement declares its own collider instead. */
export interface ColliderSpec {
  /** `rect.id` is how an extension removes this collider (e.g. a bridge once it is mended). */
  rect: RectZone;
  minY?: number;
  maxY?: number;
  /** Present only while these hold, evaluated when the scene is built. Absent means always. */
  requirements?: readonly WorldRequirement[];
}

/**
 * An open-sided kit building: one wall run per listed side, the missing side
 * is the doorway (real geometry, not a locked door). The shape Welcome
 * Harbor's `BUILDINGS`, Clockwork Harbor's `LIGHTHOUSE` and Dragon's
 * Sanctuary's `Building` already share.
 */
export interface BuildingSpec {
  id: string;
  /** Child-facing name, e.g. "the lookout tower". */
  label: string;
  x: number;
  z: number;
  halfWidth: number;
  halfDepth: number;
  height: number;
  wallSides: readonly WallSide[];
  /** Fires `PlayerEnteredZone` with `interiorZone.id` once the child is inside. */
  interiorZone: RectZone;
  /** Child-facing toast shown on entering, readable aloud. */
  enterMessage?: string;
  wallAssetId: string;
  roofAssetId?: string;
  doorAssetId?: string;
}

/** How a tiled grid meets the edges of its area; see `TILED_GROUND`. */
export type TileCoverage = 'INSIDE' | 'COVER';

/** Per-axis scale; an omitted axis is 1. */
export interface ScaleSpec {
  x?: number;
  y?: number;
  z?: number;
}

/** One instance of a kit piece within a cluster. */
export interface ClusterPosition {
  x: number;
  z: number;
  y?: number;
  rotationY?: number;
  scale?: ScaleSpec;
}

/**
 * Fields every scenery kind shares. `id` is also how an extension finds the
 * item's root object (`WorldExtensionContext.sceneryRoot`), for a mechanic
 * that moves water or hides a broken bridge.
 */
interface SceneryBase {
  id: string;
  /** Present only while these hold, evaluated when the scene is built. Absent means always. */
  requirements?: readonly WorldRequirement[];
}

/** Decorative scene content with no domain meaning. Never raycast-interactive. */
export type ScenerySpec = SceneryBase &
  (
    | /** A square grid of a ground-tile kit piece covering `area`. */
      {
        kind: 'TILED_GROUND';
        assetId: string;
        area: RectZone;
        tileSize: number;
        /** Height of the grid, for a ceiling as well as a floor. Defaults to 0. */
        y?: number;
        /**
         * How the grid meets the edges of `area`:
         *
         * - `INSIDE` (the default): tiles sit wholly inside it, and a partial
         *   last row or column is dropped. Right for a floor inside walls.
         * - `COVER`: the grid is centred and rounded up, so it covers the
         *   whole area and spills slightly past it. Right for open ground and
         *   for trails, where a bare strip at the far edge would show.
         */
        coverage?: TileCoverage;
      } /** A flat colour plane (water, sand) lying on `area` at height `y`. */
    | {
        kind: 'FLAT_PLANE';
        color: number;
        area: RectZone;
        y: number;
      } /** A solid colour box over `area` from `minY` to `maxY` (a water channel, a quay wall). */
    | {
        kind: 'BOX';
        color: number;
        area: RectZone;
        minY: number;
        maxY: number;
      } /** One instanced draw call of a kit piece at many positions. */
    | {
        kind: 'CLUSTER';
        assetId: string;
        positions: readonly ClusterPosition[];
      } /** Individually placed, LOD-aware copies of one piece (e.g. trees with a low-detail variant). */
    | {
        kind: 'LOD_PLACEMENTS';
        assetId: string;
        positions: readonly ClusterPosition[];
      } /** One model placed once, with a full rotation (a shipwreck, a fallen plank). */
    | {
        kind: 'MODEL';
        assetId: string;
        position: Vec3;
        rotation?: Vec3;
        scale?: ScaleSpec;
        /**
         * A clip to loop forever once the model loads, for decoration that
         * breathes (a companion perched on a stone). Scenery is never
         * interactive, so this is the only animation it can have.
         */
        idleClip?: string;
      } /**
     * Many copies of one kit piece scattered deterministically through the
     * part of the region the child *cannot* walk on: a tree line, a scree
     * field, a reed bed. Authoring the positions by hand is what a derived
     * boundary is meant to avoid, so the runtime samples `area` on a
     * `spacing` grid, jitters each candidate inside its cell from `seed`,
     * and keeps only those where neither the candidate nor a point
     * `clearance` metres away on either axis is somewhere the child could
     * stand. One instanced draw call, and the same forest on every load.
     */
    | {
        kind: 'SCATTER';
        assetId: string;
        area: RectZone;
        spacing: number;
        /** Any integer. The same seed always yields the same scatter. */
        seed: number;
        /** How far from walkable ground a piece must sit, in meters. */
        clearance: number;
      } /** A straight run of a vertical kit piece (fence, wall, path) tiled between two points. */
    | {
        kind: 'RUN';
        assetId: string;
        from: GroundPoint;
        to: GroundPoint;
        segmentLength: number;
      }
  );

export type ScenerySpecKind = ScenerySpec['kind'];

/** Where the existing NPC System's character stands. Dialogue stays in `src/features/npc/`. */
export interface NpcPlacementSpec {
  /** Semantic entity id the scene emits in `NpcApproached`/`ObjectInteracted`. */
  entityId: string;
  /** An existing `NpcDefinition.id`. */
  npcId: string;
  assetId: string;
  position: GroundPoint;
  yaw?: number;
  /** Child-facing crosshair label, e.g. "Pip". */
  label: string;
  /** Clip to loop once the model loads. Must be one the asset authors. */
  idleClip?: string;
  /** Colour of the stand-in box shown until the model resolves. */
  placeholderColor: number;
  /** The `WorldInteraction` a tap/interact on this NPC triggers. */
  interactionId?: string;
}

/**
 * An object the child can look at and interact with (a toolbox, a treasure
 * chest). Interacting emits `ObjectInteracted` with `entityId`; what that
 * means comes from its `WorldInteraction`.
 */
export interface PropSpec {
  entityId: string;
  /**
   * Height above the floor, for something mounted on a wall (a portrait, a
   * window, a carving) rather than standing on the ground. Defaults to 0.
   */
  elevation?: number;
  /**
   * Absent means an extension draws this one: the runtime still creates its
   * root group, raycasts it and interacts with it, and the extension puts
   * geometry inside through `WorldExtensionContext.entityRoot`. That is how
   * placeholder machinery stays out of the manifest without giving up the
   * generic focus, label and interaction handling.
   */
  assetId?: string;
  position: GroundPoint;
  rotationY?: number;
  /** Child-facing crosshair label. */
  label: string;
  interactionId: string;
  /** A clip played once, held on its last frame, the first time the child interacts (a chest lid opening). */
  interactClip?: string;
  /**
   * Present only while these hold, evaluated when the scene is built. Absent
   * means always. Two props sharing one `interactionId` with opposite
   * requirements is how a thing changes with the world (a dark cave and a
   * lit one), the same shape scenery already uses.
   */
  requirements?: readonly WorldRequirement[];
}

/**
 * The durable fact some world action records, as data rather than as a call
 * site (Phase 8). The write path is unchanged: the view hands this to
 * `recordWorldChangeOnce`, which is idempotent, with provenance
 * `exploration:<entityId>` - the convention `recordDiscovery` set with
 * `discovery:<id>`, since nothing here came from an adventure session and
 * inventing a session id would make the column lie.
 */
export interface WorldChangeBinding {
  /** `WorldChange.changeType`, e.g. `COLLECTIBLE_FOUND`. */
  changeType: string;
  /** `WorldChange.changeKey`: the key the island's own content already uses. */
  changeKey: string;
  /** Defaults to the manifest's `locationSlug`. Set it only for a region that is not a location. */
  locationSlug?: string;
}

/** A pick-up-able object: interacting emits `CollectiblePickedUp` and removes it from the scene. */
export interface CollectibleSpec {
  entityId: string;
  /** Absent means an extension draws it, as on `PropSpec`. */
  assetId?: string;
  position: GroundPoint;
  /** Height above the ground, for something resting on a roof line or a railing. Defaults to 0. */
  elevation?: number;
  label: string;
  idleClip?: string;
  /**
   * Present only while these hold, evaluated when the scene is built.
   * Absent means always - which, for a collectible that records a world
   * change, would mean it comes back on the next visit, so validation
   * requires the matching `WORLD_CHANGE_ABSENT` requirement.
   */
  requirements?: readonly WorldRequirement[];
  /** Child-facing toast shown on picking it up, readable aloud. */
  pickUpMessage?: string;
  /** What picking it up durably changes about the island, if anything. */
  worldChange?: WorldChangeBinding;
}

/** A trigger rectangle that emits `PlayerEnteredZone` with `rect.id`. */
export interface ZoneSpec {
  rect: RectZone;
  /** Child-facing toast shown on entering, readable aloud. */
  enterMessage?: string;
}

/**
 * One placed light. Indoors, a region needs more than a sun: a doorway that
 * glows, a hearth corner that is the warmest place in the castle, a library
 * that is its darkest. The outdoor rig (`environment.lighting`) cannot say
 * any of that, and a scene that placed its own lights would be the renderer
 * owning content again.
 */
export interface LightSpec {
  id: string;
  kind: 'POINT';
  position: Vec3;
  /** 24-bit RGB. */
  color: number;
  intensity: number;
  /** Where the light falls to nothing. 0 means never (three's default). */
  distance?: number;
  decay?: number;
  /** Present only while these hold, evaluated when the scene is built. */
  requirements?: readonly WorldRequirement[];
}

/** Purely decorative movement. Never interactive, never emits a domain event. */
export interface AmbientSpec {
  kind: 'SPLINE_LOOP';
  id: string;
  /** Control points of a closed Catmull-Rom loop. At least three. */
  path: readonly Vec3[];
  loopsPerSecond: number;
  appearance: { primitive: 'CONE'; color: number } | { assetId: string };
}

/** Any JSON value. Used for extension configuration, which only its extension interprets. */
export type JsonValue =
  string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue };

/**
 * A registered bespoke mechanic (castle seating puzzle, tide trial, ...).
 * The generic runtime looks `extensionId` up in a registry; it never
 * branches on a location slug. Ordinary locations declare none.
 */
export interface ExtensionBinding {
  extensionId: string;
  config: { readonly [key: string]: JsonValue };
}

/** One line of state-dependent copy above the stage; the first match is shown. */
export interface StatusLine {
  requirements?: readonly WorldRequirement[];
  text: string;
}

/** Child-facing screen copy around the canvas. All readable aloud and localizable. */
export interface LocationCopy {
  loading: string;
  instructions: string;
  /**
   * What this place is like right now, in one sentence: "The lighthouse is
   * dark. The Harbor Master is waiting on the dock." The first line whose
   * requirements hold is shown, so a region can tell a child what they
   * changed without a scene reading world state.
   */
  statusLines?: readonly StatusLine[];
  /**
   * Closing notes inside "Things to do here" - how many gears are hidden, or
   * where to look for a rune. Unlike `statusLines`, **every** note whose
   * requirements hold is shown, so a region authors them to be mutually
   * exclusive wherever two would contradict each other.
   */
  thingsToDoNotes?: readonly StatusLine[];
  /**
   * What the region says when the session's time is up (`CalmStop`). A
   * region that authors it gets the island's calm stopping point staged
   * where the child is standing; one that does not is unchanged. Nothing
   * closes and nothing is taken away either way (pillar 7).
   */
  calmStop?: string;
  /** Shown when the child's progress could not be read, instead of failing silently. */
  progressUnavailable?: string;
  /**
   * Toasts about the child's own place in the region. `{checkpoint}` is
   * replaced with the authored checkpoint label, so the copy stays the
   * region's and the labels stay the World State layer's.
   */
  checkpointToasts?: {
    /** On crossing one, e.g. "You found {checkpoint}." */
    found?: string;
    /** On arriving back at a saved one, e.g. "You are back at {checkpoint}." */
    returning?: string;
  };
  /**
   * The non-graphical way out (roadmap section 42: walking in 3D is never
   * the only way to use a screen). `to` follows `WorldAction` NAVIGATE's
   * convention: a path relative to `/island/:childId/`, `''` for the hub.
   */
  altNav: { label: string; to: string };
}

export interface ThreeLocationManifest {
  schemaVersion: typeof LOCATION_MANIFEST_SCHEMA_VERSION;
  /**
   * Stable key: the same id `RegionCheckpoint.regionId` uses. Not always an
   * `IslandLocation` slug, since Welcome Harbor is the hub rather than a
   * location.
   */
  regionId: string;
  /** The `IslandLocation.slug` this region renders, when it is one. */
  locationSlug?: string;
  worldSlug: string;
  /** Child-facing name. */
  title: string;
  /** Bumped by a content designer when this manifest's content changes. */
  version: number;

  bounds: BoundsSpec;
  environment: EnvironmentSpec;
  checkpoints: CheckpointSpec;
  colliders: readonly ColliderSpec[];
  buildings: readonly BuildingSpec[];
  scenery: readonly ScenerySpec[];
  npcs: readonly NpcPlacementSpec[];
  props: readonly PropSpec[];
  collectibles: readonly CollectibleSpec[];
  zones: readonly ZoneSpec[];
  /** Placed lights, for a region the sun does not reach. */
  lights?: readonly LightSpec[];
  ambient: readonly AmbientSpec[];
  /** Reuses the existing interaction vocabulary verbatim; see `worldObjects.ts`. */
  interactions: readonly WorldInteraction[];
  /**
   * Age bands that get no crosshair label in this region. A region where
   * nothing needs aiming - every choice is somewhere you stand - would
   * otherwise show a three-year-old a reticle implying a control they do not
   * have (`docs/STORYKEEPER_CASTLE_3D_ROADMAP.md` SC-10).
   */
  noReticleBands?: readonly AgeBandValue[];
  /**
   * Which things in this region stand for which options of which adventure
   * steps (Phase 8, `adventureStepBindings.ts`). Empty for a region whose
   * learning all happens on HUD cards; the Adventure Engine still owns every
   * transition and every judgement of correctness.
   */
  adventureBindings: readonly AdventureStepBinding[];
  extensions: readonly ExtensionBinding[];
  copy: LocationCopy;
}
