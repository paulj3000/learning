import { Box3, Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { DEFAULT_BODY_HEIGHT, PLAYER_COLLISION_LIMITS } from '@lai/game-engine/movement';
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
 *   and a raised one (a hive in a tree) blocks only at its own height. Taller pieces are solid.
 * - A raised Solid box keeps its authored height and is never made jumpable by its elevation
 *   (GE-L16): the shared controller leaves the space under it open only when the gap is at least
 *   the avatar's collision height plus the margin (`@lai/game-engine/movement` `clearance.ts`), and
 *   otherwise blocks at every height. Ground-level Solid boxes start at `SOLID_MIN_Y` as before.
 * - Walkable and passable pieces have no footprint on purpose: ground, paths, planks, carpets,
 *   ferns, reeds, flowers, rope coils, cave mouths. So do large irregular models
 *   (the shipwreck), whose locations author their colliders by hand.
 * - A passage piece (`PASSAGE_OPENINGS`: the archway) keeps its opening open whatever box it is
 *   given (GE-L16 follow-up, Trello #247): the opening is carved out of every box, built-in,
 *   Automatic or staff-configured, so the jambs block, the space under the lintel is a walk-under
 *   passage, and the lintel is an overhead Solid (no jump carries the child over or into it).
 *   Its centre is kept clear of every other piece's box too.
 * - A piece an authored collider already covers is skipped: what an author wrote wins.
 * - A piece with a box over a checkpoint, a building entrance, a passage or a walkable piece (a
 *   path tile, a plank) is dropped, so no spawn point, doorway or trail is ever walled in. An
 *   overhead Solid box (raised at least `OVERHEAD_KEEP_CLEAR_HEIGHT` above the piece's base) walls
 *   nothing in, so it does not count.
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
  // The whole archway (`archway()` in scripts/generate-world-assets.ts); `PASSAGE_OPENINGS`
  // carves its opening out, leaving two jambs and the lintel.
  archway: { halfX: 1.3, halfZ: 0.3, height: 3 },
};

/**
 * A passage piece's opening in model space: the gap between `minX` and `maxX`, from the ground up
 * to `top`, through the piece's whole depth. Measured from the generator, like the footprints.
 */
export interface PassageOpening {
  minX: number;
  maxX: number;
  top: number;
}

export const PASSAGE_OPENINGS: Readonly<Record<string, PassageOpening>> = {
  // Jambs 0.3 m wide centred at x = +-1.15 and 2.6 m tall; the lintel runs from 2.6 to 3 m.
  archway: { minX: -1, maxX: 1, top: 2.6 },
};

/**
 * A Solid box whose underside is at least this far above its piece's base is overhead for every
 * permitted avatar set-up (`DEFAULT_BODY_HEIGHT` plus the largest `clearanceMargin`), so it never
 * walls in a kept-clear point.
 */
export const OVERHEAD_KEEP_CLEAR_HEIGHT =
  DEFAULT_BODY_HEIGHT + PLAYER_COLLISION_LIMITS.clearanceMargin.max;

/**
 * `box` with a passage's opening removed: what lies either side of it, and above it. A box clear
 * of the opening comes back unchanged; one inside it entirely is gone.
 */
export function carveOpening(box: ModelBox, opening: PassageOpening): ModelBox[] {
  if (box.maxX <= opening.minX || box.minX >= opening.maxX || box.minY >= opening.top) {
    return [box];
  }
  const out: ModelBox[] = [];
  if (box.minX < opening.minX) out.push({ ...box, maxX: opening.minX });
  if (box.maxX > opening.maxX) out.push({ ...box, minX: opening.maxX });
  if (box.maxY > opening.top) {
    out.push({
      ...box,
      minX: Math.max(box.minX, opening.minX),
      maxX: Math.min(box.maxX, opening.maxX),
      minY: opening.top,
    });
  }
  return out;
}

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
  return (
    ASSET_FOOTPRINTS[assetId] ??
    (kinds.get(assetId) === 'character' ? CHARACTER_FOOTPRINT : undefined)
  );
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
  if (profile)
    return profile.boxes.length ? { boxes: profile.boxes, behavior: profile.behavior } : null;
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
  // Required paths: the centre of every walkable piece and every passage stays clear, like a
  // checkpoint. A passage's own centre binds only the other pieces: its own parts are carved
  // around its opening already, and a passage too low to walk through must stay a wall.
  const keepClear: { x: number; z: number; owner?: string }[] = [
    ...options.keepClear,
    ...placements
      .filter(
        (placement) =>
          isWalkable(placement.assetId, options) || placement.assetId in PASSAGE_OPENINGS,
      )
      .map((placement) => ({
        x: placement.position.x,
        z: placement.position.z,
        ...(placement.assetId in PASSAGE_OPENINGS ? { owner: placement.id } : {}),
      })),
  ];
  const out: DerivedCollider[] = [];
  for (const placement of placements) {
    // A centre-anchored piece hangs on a wall at a measured height; it is not in the way.
    if (placement.anchor === 'CENTRE') continue;
    const collision = collisionOf(placement.assetId, options);
    if (!collision) continue;
    const { x, z } = placement.position;
    if (options.authored.some((box) => insideXZ(box, x, z))) continue;
    const opening = PASSAGE_OPENINGS[placement.assetId];
    const parts = collision.boxes.flatMap((model) => {
      // Jumpable by behaviour only, never by elevation (GE-L16), and decided on the whole part
      // before a passage opening is carved out of it: a carved lintel is not "short".
      const height = Math.max(
        ...placedBoxes(model, placement).map((placed) => placed.max.y - placed.min.y),
      );
      const jumpable =
        collision.behavior === 'JUMPABLE' ||
        (collision.behavior === 'AUTO' && height <= JUMPABLE_MAX_HEIGHT);
      return (opening ? carveOpening(model, opening) : [model])
        .flatMap((carved) => placedBoxes(carved, placement))
        .map((placed) => ({
          jumpable,
          box: {
            minX: placed.min.x,
            minY: placed.min.y,
            minZ: placed.min.z,
            maxX: placed.max.x,
            maxY: placed.max.y,
            maxZ: placed.max.z,
          },
        }));
    });
    // One kept-clear point inside any part drops the whole piece, never half a log. An overhead
    // Solid part walls nothing in.
    const walls = (part: (typeof parts)[number]) =>
      part.jumpable || part.box.minY - placement.position.y < OVERHEAD_KEEP_CLEAR_HEIGHT;
    if (
      parts.some(
        (part) =>
          walls(part) &&
          keepClear.some(
            (point) => point.owner !== placement.id && insideXZ(part.box, point.x, point.z),
          ),
      )
    )
      continue;
    parts.forEach(({ box, jumpable }, part) => {
      // A raised Solid keeps its height: the controller decides whether it is a walk-under
      // passage or a column. A ground-level one reaches below the ground, as before.
      const raised = box.minY > 0;
      out.push({
        id: parts.length === 1 ? `derived:${placement.id}` : `derived:${placement.id}:${part}`,
        box: jumpable || raised ? box : { ...box, minY: Math.min(box.minY, SOLID_MIN_Y) },
        ...(jumpable ? { jumpable: true } : {}),
      });
    });
  }
  return out;
}
