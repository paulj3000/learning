import {
  AmbientLight,
  Box3,
  Color,
  DirectionalLight,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import {
  createInstancedMeshFromAsset,
  instantiateWithLod,
  type InstancePlacement,
} from './assets/assetLoader';

/**
 * The shared scene-construction module `welcomeHarborScene.ts` and
 * `pirateBuilderBayScene.ts` should have had from the start
 * (`docs/ROADMAP.md` Phase 34): the camera/renderer/lighting bootstrap,
 * shared movement constants, and the `RectZone` -> `Box3` conversion both
 * files duplicated verbatim, plus the kit-composition helpers
 * (`placeWallRun`, `placeRoof`, `placeFenceRun`, `placeFoliageCluster`)
 * that turn loaded kit pieces (`assets/manifest.ts`) into placed scene
 * objects - the "modular kits ... composable across regions" deliverable.
 */

export const APPROACH_RANGE_METERS = 2.5;
export const RAYCAST_RANGE_METERS = 4;
export const EYE_HEIGHT = 1.6;
export const WALL_HEIGHT = 3;

export interface RectZoneLike {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** Converts an authored region rect into a `Box3` collider/trigger volume. */
export function toBox3(zone: RectZoneLike, minY = -1, maxY = WALL_HEIGHT): Box3 {
  return new Box3(new Vector3(zone.minX, minY, zone.minZ), new Vector3(zone.maxX, maxY, zone.maxZ));
}

export interface SceneBootstrap {
  scene: Scene;
  camera: PerspectiveCamera;
  renderer: WebGLRenderer;
}

/**
 * The outdoor rig both Phase 32/33 regions were built against, kept as the
 * default so neither changes: bright ambient fill plus a strong overhead
 * sun.
 */
const DEFAULT_LIGHTING: Required<SceneLighting> = {
  ambientIntensity: 0.65,
  sunIntensity: 0.8,
  sunPosition: { x: 8, y: 14, z: 6 },
};

/**
 * Overrides for the bootstrap light rig. Indoor regions need a much darker
 * fill than an open plot does - at the outdoor defaults every room of a
 * castle reads equally lit, which flattens the architecture and makes
 * "the Great Library is the darkest point" impossible to author
 * (`docs/STORYKEEPER_CASTLE_3D_ROADMAP.md` SC-2). Omitted fields keep the
 * outdoor value.
 */
export interface SceneLighting {
  ambientIntensity?: number;
  sunIntensity?: number;
  sunPosition?: { x: number; y: number; z: number };
}

/** The camera + renderer + ambient/directional light rig both regions built identically, inline, until now. */
export function createSceneBootstrap(
  parent: HTMLDivElement,
  backgroundColor: number,
  lighting: SceneLighting = {},
): SceneBootstrap {
  const scene = new Scene();
  scene.background = new Color(backgroundColor);

  const camera = new PerspectiveCamera(70, parent.clientWidth / parent.clientHeight, 0.1, 150);
  camera.rotation.order = 'YXZ';

  const renderer = new WebGLRenderer({ antialias: true });
  renderer.setSize(parent.clientWidth, parent.clientHeight);
  parent.appendChild(renderer.domElement);

  const rig = { ...DEFAULT_LIGHTING, ...lighting };
  scene.add(new AmbientLight(0xffffff, rig.ambientIntensity));
  const sun = new DirectionalLight(0xffffff, rig.sunIntensity);
  sun.position.set(rig.sunPosition.x, rig.sunPosition.y, rig.sunPosition.z);
  scene.add(sun);

  return { scene, camera, renderer };
}

/**
 * Pure placement math for one straight run of a kit piece (wall/fence/path)
 * between two points, tiled by `segmentLength` - split out from
 * `placeKitRun` so callers that build one wall out of several runs (one per
 * building side) can concatenate placements first and instance them all in
 * a single `InstancedMesh` (one draw call), rather than one per side.
 */
export function runPlacements(
  from: { x: number; z: number },
  to: { x: number; z: number },
  segmentLength: number,
): InstancePlacement[] {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const length = Math.hypot(dx, dz);
  const segments = Math.max(1, Math.round(length / segmentLength));
  /*
    Yaw that lays the piece's *width* (its local X) along the run, so a run
    of panels reads as one continuous surface.

    This used to be `atan2(dx, dz)`, which points a piece's local +Z along
    the run instead - correct for something authored nose-first, but every
    kit piece that gets tiled this way is a panel authored width-first:
    `wall` and `wall-stone` are `buildPlanePrimitive(2, 3)` (2m across local
    X, normal +Z) and `fence` is `buildPlanePrimitive(1.2, 0.9)`. Under the
    old angle a north wall run along +X placed each 2m panel turned 90
    degrees across the run, so a wall rendered as a row of separated fins
    with 2m gaps between them rather than a wall. The same file's own
    hand-placed doors (`welcomeHarborScene.ts`, `rotationY` left at 0 on a
    north/south side) were already using this convention, which is what the
    walls disagreed with.

    `path` is a square ground tile, so its rotation is immaterial, and the
    bay's bridge deck overrides `rotationY` to 0 explicitly - those are the
    only other callers, so nothing else moves.
  */
  const angle = Math.atan2(dx, dz) - Math.PI / 2;

  return Array.from({ length: segments }, (_, index) => {
    const t = (index + 0.5) / segments;
    return { position: { x: from.x + dx * t, y: 0, z: from.z + dz * t }, rotationY: angle };
  });
}

/** Places one instanced run of a vertical kit piece (wall/fence/path) along a straight line between two points. */
export async function placeKitRun(
  scene: Scene,
  assetId: string,
  from: { x: number; z: number },
  to: { x: number; z: number },
  segmentLength: number,
): Promise<void> {
  const instanced = await createInstancedMeshFromAsset(
    assetId,
    runPlacements(from, to, segmentLength),
  );
  scene.add(instanced);
}

/** Places one instanced cluster of a kit piece (foliage, rocks) at explicit positions, with an optional per-position rotation. */
export async function placeKitCluster(
  scene: Scene,
  assetId: string,
  positions: readonly { x: number; z: number; rotationY?: number }[],
): Promise<void> {
  const placements: InstancePlacement[] = positions.map((position) => ({
    position: { x: position.x, y: 0, z: position.z },
    rotationY: position.rotationY,
  }));
  const instanced = await createInstancedMeshFromAsset(assetId, placements);
  scene.add(instanced);
}

/** Places a single LOD-aware kit piece (roadmap: "LOD variants") - used for foliage placed one at a time rather than instanced. */
export async function placeWithLod(
  scene: Scene,
  assetId: string,
  position: { x: number; y?: number; z: number },
  rotationY = 0,
): Promise<void> {
  const object = await instantiateWithLod(assetId);
  object.position.set(position.x, position.y ?? 0, position.z);
  object.rotation.y = rotationY;
  scene.add(object);
}
