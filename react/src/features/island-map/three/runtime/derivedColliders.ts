import { Box3, Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { areRequirementsMet, type WorldInteractionContext } from '../../worldObjects';
import type { InstancePlacement } from '../assets/assetLoader';
import type { AssetManifestEntry } from '../assets/manifest';
import { runPlacements } from '../sceneKit';
import type { CollisionBehavior, CollisionProfiles, ModelBox } from './collisionProfile';
import type { ModelAnchor, ScaleSpec, ThreeLocationManifest, Vec3 } from './locationManifest';

/**
 * Colliders derived from what a location draws (collision fix, 2026-11-14).
 *
 * A location's `colliders` are written by hand, separately from its scenery, props and NPCs,
 * so every barrel, rock, tree, log, post, stone and character nobody wrote a box for could be
 * walked through. This adds a box for each placed piece whose asset has a solid footprint in
 * `ASSET_FOOTPRINTS`, in every location, source-controlled or published from Django, with no
 * manifest change.
 *
 * - The box is the footprint under the same position, rotation and scale the renderer gives the
 *   model, so a lying barrel or a scaled-up boulder gets the shape it is drawn with. A long piece
 *   is cut into short boxes along its length, so a log lying at an angle blocks only where it lies.
 * - A piece no taller than `JUMPABLE_MAX_HEIGHT` is jumpable: the child can hop onto or over it,
 *   and a raised piece (a hive in a tree) blocks only at its own height. Taller pieces are solid.
 * - Walkable and passable pieces have no footprint on purpose: ground, paths, planks, carpets,
 *   ferns, reeds, flowers, rope coils, archways, cave mouths. So do large irregular models
 *   (the shipwreck), whose locations author their colliders by hand.
 * - A piece an authored collider already covers is skipped: what an author wrote wins.
 * - A piece with a box over a checkpoint, a building entrance or a walkable piece (a path tile,
 *   a plank) is dropped, so no spawn point, doorway or trail is ever walled in.
 * - A staff-configured profile (Asset Manager, `collisionProfile.ts`) replaces an asset's
 *   built-in footprint everywhere it is placed; assets without one keep the defaults below.
 * - Collectibles never block (they are picked up), and a prop with no `assetId` is drawn by an
 *   extension, which adds its own colliders.
 */

/** Model-space solid footprint at scale 1: the box the piece occupies, ground-pivoted. */
export interface AssetFootprint {
  halfX: number;
  halfZ: number;
  height: number;
  /** Footprint centre in model space, when the mesh is not centred on its pivot. */
  offsetX?: number;
  offsetZ?: number;
}

/**
 * Measured from the model files' bounding boxes (`public/models`). Trees and posts use their
 * trunk or post, not the canopy or sign board the child walks under.
 */
export const ASSET_FOOTPRINTS: Readonly<Record<string, AssetFootprint>> = {
  barrel: { halfX: 0.32, halfZ: 0.34, height: 0.9 },
  crate: { halfX: 0.4, halfZ: 0.4, height: 0.8 },
  rock: { halfX: 0.15, halfZ: 0.2, height: 0.31, offsetX: -0.01, offsetZ: -0.04 },
  'mooring-post': { halfX: 0.2, halfZ: 0.2, height: 1.6 },
  signpost: { halfX: 0.08, halfZ: 0.08, height: 1.2 },
  'foliage-tree': { halfX: 0.22, halfZ: 0.22, height: 2.6 },
  'foliage-tree-lod1': { halfX: 0.22, halfZ: 0.22, height: 2.6 },
  'foliage-bush': { halfX: 0.25, halfZ: 0.2, height: 0.32, offsetX: 0.01, offsetZ: -0.01 },
  'log-fallen': { halfX: 0.23, halfZ: 1.1, height: 0.45, offsetZ: 1.1 },
  'standing-stone': { halfX: 0.25, halfZ: 0.2, height: 1.4 },
  fence: { halfX: 0.6, halfZ: 0.08, height: 0.9 },
  toolbox: { halfX: 0.25, halfZ: 0.15, height: 0.3 },
  'treasure-chest': { halfX: 0.3, halfZ: 0.2, height: 0.42 },
  beehive: { halfX: 0.52, halfZ: 0.56, height: 0.94, offsetZ: 0.03 },
  'wonder-stone-bee': { halfX: 0.45, halfZ: 0.19, height: 1.5, offsetZ: 0.07 },
  'wonder-stone-bee-lit': { halfX: 0.45, halfZ: 0.19, height: 1.5, offsetZ: 0.07 },
  'wonder-stone-chrysalis': { halfX: 0.45, halfZ: 0.21, height: 1.5, offsetZ: 0.09 },
  'wonder-stone-seed': { halfX: 0.45, halfZ: 0.17, height: 1.5, offsetZ: 0.05 },
  'wonder-stone-sun': { halfX: 0.45, halfZ: 0.32, height: 1.5, offsetZ: 0.14 },
};

/** Any `character` asset without its own entry: a child-sized body. Arms are not a wall. */
export const CHARACTER_FOOTPRINT: AssetFootprint = { halfX: 0.3, halfZ: 0.3, height: 1.6 };

/** At or below this the child can hop onto or over a piece (the default jump reaches 1.2 m). */
export const JUMPABLE_MAX_HEIGHT = 1.2;

/** Matches `sceneLayout`'s ground-level solids, which are tested at y 0. */
const SOLID_MIN_Y = -1;

export interface DerivedCollider {
  id: string;
  box: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number };
  jumpable?: boolean;
}

type AssetKinds = ReadonlyMap<string, AssetManifestEntry['kind']>;

export function footprintFor(assetId: string, kinds: AssetKinds): AssetFootprint | undefined {
  return ASSET_FOOTPRINTS[assetId] ?? (kinds.get(assetId) === 'character' ? CHARACTER_FOOTPRINT : undefined);
}

interface Placement {
  id: string;
  assetId: string;
  position: Vec3;
  rotation?: Vec3;
  scale?: ScaleSpec;
  anchor?: ModelAnchor;
}

const matrix = new Matrix4();
const quaternion = new Quaternion();
const euler = new Euler();
const scaleVector = new Vector3();
const positionVector = new Vector3();

/** A built-in footprint as one model-space box, standing on the pivot. */
export function footprintBox(footprint: AssetFootprint): ModelBox {
  const cx = footprint.offsetX ?? 0;
  const cz = footprint.offsetZ ?? 0;
  return {
    minX: cx - footprint.halfX,
    minY: 0,
    minZ: cz - footprint.halfZ,
    maxX: cx + footprint.halfX,
    maxY: footprint.height,
    maxZ: cz + footprint.halfZ,
  };
}

/**
 * A model-space box under the piece's transform, as world axis-aligned boxes. A long box (a log,
 * a fence panel) turned off the axes would get one world box covering a lot of empty air, so it
 * is cut along its length into pieces about as long as it is wide, and each piece is boxed.
 */
function placedBoxes(model: ModelBox, placement: Placement): Box3[] {
  const rotation = placement.rotation ?? { x: 0, y: 0, z: 0 };
  quaternion.setFromEuler(euler.set(rotation.x, rotation.y, rotation.z));
  scaleVector.set(placement.scale?.x ?? 1, placement.scale?.y ?? 1, placement.scale?.z ?? 1);
  positionVector.set(placement.position.x, placement.position.y, placement.position.z);
  matrix.compose(positionVector, quaternion, scaleVector);
  const sizeX = model.maxX - model.minX;
  const sizeZ = model.maxZ - model.minZ;
  const alongX = sizeX >= sizeZ;
  const long = alongX ? sizeX : sizeZ;
  const short = Math.max(alongX ? sizeZ : sizeX, 0.1);
  const pieces = Math.max(1, Math.min(64, Math.ceil(long / (2 * short))));
  const boxes: Box3[] = [];
  for (let i = 0; i < pieces; i += 1) {
    const box = new Box3(
      new Vector3(model.minX, model.minY, model.minZ),
      new Vector3(model.maxX, model.maxY, model.maxZ),
    );
    if (alongX) {
      box.min.x = model.minX + (sizeX * i) / pieces;
      box.max.x = model.minX + (sizeX * (i + 1)) / pieces;
    } else {
      box.min.z = model.minZ + (sizeZ * i) / pieces;
      box.max.z = model.minZ + (sizeZ * (i + 1)) / pieces;
    }
    boxes.push(box.applyMatrix4(matrix));
  }
  return boxes;
}

function fromInstance(id: string, assetId: string, instance: InstancePlacement): Placement {
  return {
    id,
    assetId,
    position: instance.position,
    rotation: { x: 0, y: instance.rotationY ?? 0, z: 0 },
    ...(instance.scale ? { scale: instance.scale } : {}),
  };
}

function placementsOf(
  manifest: ThreeLocationManifest,
  context: WorldInteractionContext,
): Placement[] {
  const out: Placement[] = [];
  for (const item of manifest.scenery) {
    if (!areRequirementsMet(item.requirements, context)) continue;
    switch (item.kind) {
      case 'MODEL':
        out.push({
          id: item.id,
          assetId: item.assetId,
          position: item.position,
          ...(item.rotation ? { rotation: item.rotation } : {}),
          ...(item.scale ? { scale: item.scale } : {}),
          ...(item.anchor ? { anchor: item.anchor } : {}),
        });
        break;
      case 'CLUSTER':
      case 'LOD_PLACEMENTS':
        item.positions.forEach((position, index) =>
          out.push(
            fromInstance(`${item.id}#${index}`, item.assetId, {
              position: { x: position.x, y: position.y ?? 0, z: position.z },
              ...(position.rotationY !== undefined ? { rotationY: position.rotationY } : {}),
              ...(position.scale ? { scale: position.scale } : {}),
            }),
          ),
        );
        break;
      case 'RUN':
        runPlacements(item.from, item.to, item.segmentLength).forEach((instance, index) =>
          out.push(fromInstance(`${item.id}#${index}`, item.assetId, instance)),
        );
        break;
      default:
        // Ground, planes and boxes are surfaces; SCATTER sits off the walkable area by design.
        break;
    }
  }
  for (const prop of manifest.props) {
    if (prop.assetId === undefined || !areRequirementsMet(prop.requirements, context)) continue;
    out.push({
      id: prop.entityId,
      assetId: prop.assetId,
      position: { x: prop.position.x, y: prop.elevation ?? 0, z: prop.position.z },
      rotation: { x: 0, y: prop.rotationY ?? 0, z: 0 },
      ...(prop.anchor ? { anchor: prop.anchor } : {}),
    });
  }
  for (const npc of manifest.npcs) {
    out.push({
      id: npc.entityId,
      assetId: npc.assetId,
      position: { x: npc.position.x, y: 0, z: npc.position.z },
      rotation: { x: 0, y: npc.yaw ?? 0, z: 0 },
    });
  }
  return out;
}

export interface DeriveOptions {
  /** Asset kinds, so any `character` gets a body without its own entry. */
  assetKinds: AssetKinds;
  /** The authored colliders: a piece whose centre one already covers is left to it. */
  authored: readonly DerivedCollider['box'][];
  /** Points that must stay clear (checkpoints, entrances): a piece with a box over one is dropped. */
  keepClear: readonly { x: number; z: number }[];
  /**
   * Staff-configured profiles by asset id (Asset Manager). A profile replaces the built-in
   * footprint for every placement of that asset; one with no boxes means "never blocks".
   */
  profiles?: CollisionProfiles;
}

function insideXZ(box: DerivedCollider['box'], x: number, z: number): boolean {
  return x >= box.minX && x <= box.maxX && z >= box.minZ && z <= box.maxZ;
}

/** Paths and planks the child walks along: their tiles stay clear of every derived box. */
export const DEFAULT_WALKABLE_ASSETS: ReadonlySet<string> = new Set([
  'path',
  'path-forest',
  'bridge-plank',
  'bridge-plank-repaired',
  'carpet',
]);

/** What a placement of `assetId` blocks with: model boxes and how, or null for nothing. */
function collisionOf(
  assetId: string,
  options: DeriveOptions,
): { boxes: readonly ModelBox[]; behavior: CollisionBehavior | 'AUTO' } | null {
  const profile = options.profiles?.get(assetId);
  if (profile) return profile.boxes.length ? { boxes: profile.boxes, behavior: profile.behavior } : null;
  const footprint = footprintFor(assetId, options.assetKinds);
  return footprint ? { boxes: [footprintBox(footprint)], behavior: 'AUTO' } : null;
}

function isWalkable(assetId: string, options: DeriveOptions): boolean {
  const profile = options.profiles?.get(assetId);
  return profile ? profile.behavior === 'WALKABLE' : DEFAULT_WALKABLE_ASSETS.has(assetId);
}

/** Each open side of a building (no wall there) is an entrance: its middle and a step outside. */
export function buildingEntrances(manifest: ThreeLocationManifest): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  const sides = [
    ['north', 0, -1],
    ['south', 0, 1],
    ['east', 1, 0],
    ['west', -1, 0],
  ] as const;
  for (const building of manifest.buildings) {
    for (const [side, dx, dz] of sides) {
      if (building.wallSides.includes(side)) continue;
      const edgeX = building.x + dx * building.halfWidth;
      const edgeZ = building.z + dz * building.halfDepth;
      out.push({ x: edgeX, z: edgeZ }, { x: edgeX + dx, z: edgeZ + dz });
    }
  }
  return out;
}

export function derivedColliders(
  manifest: ThreeLocationManifest,
  context: WorldInteractionContext,
  options: DeriveOptions,
): DerivedCollider[] {
  const placements = placementsOf(manifest, context);
  // Required paths: the centre of every walkable piece stays clear, like a checkpoint.
  const keepClear = [
    ...options.keepClear,
    ...placements
      .filter((placement) => isWalkable(placement.assetId, options))
      .map((placement) => ({ x: placement.position.x, z: placement.position.z })),
  ];
  const out: DerivedCollider[] = [];
  for (const placement of placements) {
    // A centre-anchored piece hangs on a wall at a measured height; it is not in the way.
    if (placement.anchor === 'CENTRE') continue;
    const collision = collisionOf(placement.assetId, options);
    if (!collision) continue;
    const { x, z } = placement.position;
    if (options.authored.some((box) => insideXZ(box, x, z))) continue;
    const boxes = collision.boxes
      .flatMap((model) => placedBoxes(model, placement))
      .map((placed) => ({
        minX: placed.min.x,
        minY: placed.min.y,
        minZ: placed.min.z,
        maxX: placed.max.x,
        maxY: placed.max.y,
        maxZ: placed.max.z,
      }));
    // One kept-clear point inside any part drops the whole piece, never half a log.
    if (boxes.some((box) => keepClear.some((point) => insideXZ(box, point.x, point.z)))) continue;
    boxes.forEach((box, part) => {
      // A raised box has to keep its height to block (only jumpable boxes do), whatever it is.
      const jumpable =
        box.minY > 0 ||
        collision.behavior === 'JUMPABLE' ||
        (collision.behavior === 'AUTO' && box.maxY - box.minY <= JUMPABLE_MAX_HEIGHT);
      out.push({
        id: boxes.length === 1 ? `derived:${placement.id}` : `derived:${placement.id}:${part}`,
        box: jumpable ? box : { ...box, minY: Math.min(box.minY, SOLID_MIN_Y) },
        ...(jumpable ? { jumpable: true } : {}),
      });
    });
  }
  return out;
}
