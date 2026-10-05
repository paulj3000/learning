import type { WorldInteraction } from '../../worldObjects';

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

export interface EnvironmentSpec {
  /** Sky/clear colour as a 24-bit RGB integer (e.g. `0x8fc7e6`). */
  backgroundColor: number;
  lighting?: LightingSpec;
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
  rect: RectZone;
  minY?: number;
  maxY?: number;
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

/** One instance of a kit piece within a cluster. */
export interface ClusterPosition {
  x: number;
  z: number;
  y?: number;
  rotationY?: number;
}

/** Decorative scene content with no domain meaning. Never raycast-interactive. */
export type ScenerySpec =
  /** A square grid of a ground-tile kit piece covering `area`. */
  | { kind: 'TILED_GROUND'; id: string; assetId: string; area: RectZone; tileSize: number }
  /** A flat colour plane (water, sand) lying on `area` at height `y`. */
  | { kind: 'FLAT_PLANE'; id: string; color: number; area: RectZone; y: number }
  /** One instanced draw call of a kit piece at many positions. */
  | { kind: 'CLUSTER'; id: string; assetId: string; positions: readonly ClusterPosition[] }
  /** Individually placed, LOD-aware copies of one piece (e.g. trees with a low-detail variant). */
  | { kind: 'LOD_PLACEMENTS'; id: string; assetId: string; positions: readonly ClusterPosition[] }
  /** A straight run of a vertical kit piece (fence, wall, path) tiled between two points. */
  | {
      kind: 'RUN';
      id: string;
      assetId: string;
      from: GroundPoint;
      to: GroundPoint;
      segmentLength: number;
    };

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

/** A pick-up-able object: interacting emits `CollectiblePickedUp` and removes it from the scene. */
export interface CollectibleSpec {
  entityId: string;
  assetId: string;
  position: GroundPoint;
  label: string;
  idleClip?: string;
}

/** A trigger rectangle that emits `PlayerEnteredZone` with `rect.id`. */
export interface ZoneSpec {
  rect: RectZone;
  /** Child-facing toast shown on entering, readable aloud. */
  enterMessage?: string;
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

/** Child-facing screen copy around the canvas. All readable aloud and localizable. */
export interface LocationCopy {
  loading: string;
  instructions: string;
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
  collectibles: readonly CollectibleSpec[];
  zones: readonly ZoneSpec[];
  ambient: readonly AmbientSpec[];
  /** Reuses the existing interaction vocabulary verbatim; see `worldObjects.ts`. */
  interactions: readonly WorldInteraction[];
  extensions: readonly ExtensionBinding[];
  copy: LocationCopy;
}
