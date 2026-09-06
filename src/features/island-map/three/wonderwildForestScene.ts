import {
  AnimationMixer,
  Box3,
  Clock,
  DoubleSide,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Raycaster,
  Vector2,
  Vector3,
} from 'three';
import { instantiateAsset, loadAsset } from './assets/assetLoader';
import type { InstancePlacement } from './assets/assetLoader';
import { resolveSpawnCheckpoint, WONDERWILD_FOREST_CHECKPOINTS } from '../../discovery/checkpoints';
import type { ThreeEngineHandle } from './ThreeGameContainer';
import { FirstPersonController } from './firstPersonController';
import { attachPointerControls } from './pointerControls';
import { isInsideZone } from './sandboxTriggers';
import {
  createSceneBootstrap,
  EYE_HEIGHT,
  placeKitCluster,
  RAYCAST_RANGE_METERS,
  toBox3,
} from './sceneKit';
import {
  BEEHIVE_SPOT,
  BUTTERFLY_SPOT,
  CAVE_MOUTH_SPOT,
  CHATTY_PERCH_SPOT,
  COLLIDERS,
  FLOWER_PATCH_SPOT,
  GLOW_MOSS_SPOT,
  GROUND_HALF_EXTENT_X,
  GROUND_HALF_EXTENT_Z,
  HIVE_TRUNK_SPOT,
  isWalkable,
  LEAF_PILE_SPOT,
  NIGHT_STONE_SPOTS,
  POND_FROG_SPOT,
  POND_WATER,
  REGION_ID,
  TRAILS,
  TREE_LINE_SEGMENTS,
  WONDER_STONE_SPOTS,
  ZONES,
  type RectZone,
} from './wonderwildForestRegion';
import type { WorldEngineEventBus } from './worldEngineEvents';

export interface WonderwildForestEngine extends ThreeEngineHandle {
  /** Raycasts from the camera center and fires the matching event, if anything interactive is in range. */
  interact(): void;
}

export interface WonderwildForestEngineOptions {
  /** The child's last saved checkpoint id (`ChildWorldState.lastCheckpointId`), if any. */
  startCheckpointId?: string;
  /** Whether `WorldChange.changeKey === 'WAGGLE_DANCE_DISCOVERED'` is already recorded for this child. */
  waggleDanceDiscovered: boolean;
  /** Whether `SAVE_THE_BUTTERFLY_GARDEN_COMPLETE` is recorded - the cross-location visitor. */
  butterflyGardenComplete: boolean;
  /** Whether the child owns the jar of glowing moss, which is what lights the cave. */
  hasGlowingMossJar: boolean;
}

// --- pure placement helpers (unit tested) -----------------------------------

/**
 * Covers one rect with a grid of `tileSize` placements, centred so the run
 * reads as continuous rather than clipped at one edge. Used for the moss
 * floor and for the trodden trails.
 */
export function tilePlacements(rect: RectZone, tileSize: number): InstancePlacement[] {
  const cols = Math.max(1, Math.ceil((rect.maxX - rect.minX) / tileSize));
  const rows = Math.max(1, Math.ceil((rect.maxZ - rect.minZ) / tileSize));
  const originX = (rect.minX + rect.maxX) / 2 - ((cols - 1) * tileSize) / 2;
  const originZ = (rect.minZ + rect.maxZ) / 2 - ((rows - 1) * tileSize) / 2;

  const placements: InstancePlacement[] = [];
  for (let col = 0; col < cols; col += 1) {
    for (let row = 0; row < rows; row += 1) {
      placements.push({
        position: { x: originX + col * tileSize, y: 0, z: originZ + row * tileSize },
      });
    }
  }
  return placements;
}

/** A tiny deterministic PRNG, so the forest looks the same on every load and in every screenshot. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/**
 * Scatters `spacing`-apart points through a set of rects, deterministically,
 * skipping anything that lands on walkable ground.
 *
 * **The skip is the point.** The tree line is derived as the complement of
 * the walkable set, so a point inside a segment is off-trail by construction
 * - but a tree has a trunk, and one placed hard against a segment edge
 * overhangs the trail beside it. `margin` insets the scatter, and the caller
 * passes `isWalkable` so the invariant is checked against the same predicate
 * the controller collides with rather than against a second copy of it.
 */
export function scatterPlacements(
  segments: readonly RectZone[],
  spacing: number,
  seed: number,
  walkable: (x: number, z: number) => boolean,
  margin = 0.6,
): InstancePlacement[] {
  const random = seededRandom(seed);
  const placements: InstancePlacement[] = [];

  for (const segment of segments) {
    const minX = segment.minX + margin;
    const maxX = segment.maxX - margin;
    const minZ = segment.minZ + margin;
    const maxZ = segment.maxZ - margin;
    if (maxX <= minX || maxZ <= minZ) continue;

    const cols = Math.max(1, Math.round((maxX - minX) / spacing));
    const rows = Math.max(1, Math.round((maxZ - minZ) / spacing));
    for (let col = 0; col < cols; col += 1) {
      for (let row = 0; row < rows; row += 1) {
        // Jitter inside the cell so the tree line does not read as a grid.
        const x = minX + ((col + 0.15 + random() * 0.7) / cols) * (maxX - minX);
        const z = minZ + ((row + 0.15 + random() * 0.7) / rows) * (maxZ - minZ);
        if (walkable(x, z)) continue;
        placements.push({ position: { x, y: 0, z }, rotationY: random() * Math.PI * 2 });
      }
    }
  }
  return placements;
}

/** The trails a child can see, which is every trail except the fern bank's deliberate non-path. */
export function drawnTrailRects(): RectZone[] {
  return TRAILS.filter((trail) => trail.wear !== 'none').flatMap((trail) => [...trail.rects]);
}

// --- the engine -------------------------------------------------------------

const GROUND_TILE_SIZE = 4;
const PATH_TILE_SIZE = 1.5;

/**
 * Wonderwild Forest's first-person region (`docs/WONDERWILD_FOREST_3D_ROADMAP.md`
 * WF-2), built from WF-0's numbers and WF-1's kit.
 *
 * Rendering glue, like every other `three/*Scene.ts` and every Phaser
 * `scenes/*.ts`: not unit tested as a whole, since it needs a real WebGL/DOM
 * context. The geometry and ids it reads (`wonderwildForestRegion.ts`,
 * `discovery/checkpoints.ts`) and the asset pipeline it calls into
 * (`assets/*.ts`, `sceneKit.ts`) are tested independently, and the two pure
 * placement helpers above are tested directly.
 *
 * **Colliders are `COLLIDERS` and nothing else**, so the trees the child sees
 * and the trees that stop them are the same authored data. The tree line is
 * derived as the complement of the walkable set (WF-0), which is also why
 * this region needs no boundary walls of its own the way the bay does: the
 * complement runs to the ground extents and closes the forest in.
 *
 * **This region is interactive from its first phase**, unlike the castle's
 * SC-2 which deliberately shipped an empty shell. The reason is WF-2's own
 * default-route decision: from here the 3D forest is what a Pathfinder or
 * Explorer gets when they open Wonderwild Forest, and promoting a route that
 * offers less than the card route it replaces would be a regression dressed
 * as progress. The eight flavour interactions the Phaser forest already
 * authors (`WONDERWILD_FOREST_INTERACTIONS`) are therefore wired here, to the
 * same ids, in the same before/after pairs. The Wonder Wall itself stays
 * scenery until WF-3, which is the phase that owns that step.
 */
export function createWonderwildForestEngine(
  parent: HTMLDivElement,
  bus: WorldEngineEventBus,
  options: WonderwildForestEngineOptions,
): WonderwildForestEngine {
  // A canopy, not an open plot: dimmer fill than the bay's default and a
  // lower sun, so the glades read brighter than the tree line between them.
  const { scene, camera, renderer } = createSceneBootstrap(parent, 0x9ecfe0, {
    ambientIntensity: 0.55,
    sunIntensity: 0.85,
    sunPosition: { x: 6, y: 16, z: -4 },
  });

  const waterMaterial = new MeshStandardMaterial({ color: 0x2f6f9e, side: DoubleSide });
  const water = new Mesh(
    new PlaneGeometry(POND_WATER.maxX - POND_WATER.minX, POND_WATER.maxZ - POND_WATER.minZ),
    waterMaterial,
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(
    (POND_WATER.minX + POND_WATER.maxX) / 2,
    -0.05,
    (POND_WATER.minZ + POND_WATER.maxZ) / 2,
  );
  scene.add(water);

  const colliders: Box3[] = COLLIDERS.map((collider) =>
    collider.id === POND_WATER.id ? toBox3(collider, -1, 2) : toBox3(collider, -1, 6),
  );
  const controller = new FirstPersonController({ colliders });

  const spawn = resolveSpawnCheckpoint(REGION_ID, options.startCheckpointId);
  controller.position.set(spawn.x, 0, spawn.z);
  controller.yaw = spawn.yaw;

  let beehiveMesh: Object3D | null = null;
  let frogMesh: Object3D | null = null;
  let leafPileMesh: Object3D | null = null;
  let caveMesh: Object3D | null = null;
  let butterflyMesh: Object3D | null = null;
  let nightStoneMesh: Object3D | null = null;
  let glowMossMesh: Object3D | null = null;
  const mixers: AnimationMixer[] = [];

  async function place(assetId: string, x: number, z: number, rotationY = 0): Promise<Object3D> {
    const object = await instantiateAsset(assetId);
    object.position.set(x, 0, z);
    object.rotation.y = rotationY;
    scene.add(object);
    return object;
  }

  async function buildWorld(): Promise<void> {
    // The forest floor, as one instanced run covering the whole region.
    await placeKitCluster(
      scene,
      'ground-tile-moss',
      tilePlacements(
        {
          id: 'ground',
          minX: -GROUND_HALF_EXTENT_X,
          maxX: GROUND_HALF_EXTENT_X,
          minZ: -GROUND_HALF_EXTENT_Z,
          maxZ: GROUND_HALF_EXTENT_Z,
        },
        GROUND_TILE_SIZE,
      ).map((placement) => ({ x: placement.position.x, z: placement.position.z })),
    );

    // The trails. The fern bank's connection is `none` and is deliberately
    // not drawn - beat 11's secret has to be found off the path.
    await placeKitCluster(
      scene,
      'path-forest',
      drawnTrailRects()
        .flatMap((rect) => tilePlacements(rect, PATH_TILE_SIZE))
        .map((placement) => ({ x: placement.position.x, z: placement.position.z })),
    );

    // The tree line, scattered through the derived complement.
    const trees = scatterPlacements(TREE_LINE_SEGMENTS, 3.4, 1337, isWalkable, 0.8);
    await placeKitCluster(
      scene,
      'foliage-tree',
      trees.map((p) => ({ x: p.position.x, z: p.position.z, rotationY: p.rotationY })),
    );
    const bushes = scatterPlacements(TREE_LINE_SEGMENTS, 5.5, 90210, isWalkable, 1.2);
    await placeKitCluster(
      scene,
      'foliage-bush',
      bushes.map((p) => ({ x: p.position.x, z: p.position.z, rotationY: p.rotationY })),
    );
    const ferns = scatterPlacements(TREE_LINE_SEGMENTS, 4.2, 5150, isWalkable, 1);
    await placeKitCluster(
      scene,
      'fern',
      ferns.map((p) => ({ x: p.position.x, z: p.position.z, rotationY: p.rotationY })),
    );

    // Ferns inside the fern bank too, so beat 11's moss has something to hide
    // under rather than sitting on open ground like a lamp on a lawn.
    await placeKitCluster(scene, 'fern', [
      { x: GLOW_MOSS_SPOT.x - 1.1, z: GLOW_MOSS_SPOT.z + 0.5 },
      { x: GLOW_MOSS_SPOT.x + 1.2, z: GLOW_MOSS_SPOT.z - 0.4 },
      { x: GLOW_MOSS_SPOT.x + 0.3, z: GLOW_MOSS_SPOT.z + 1.3 },
      { x: GLOW_MOSS_SPOT.x - 0.6, z: GLOW_MOSS_SPOT.z - 1.2 },
      { x: GLOW_MOSS_SPOT.x + 2.4, z: GLOW_MOSS_SPOT.z + 1.8 },
      { x: GLOW_MOSS_SPOT.x - 2.6, z: GLOW_MOSS_SPOT.z - 2 },
    ]);

    // The pond: reeds around the shore, lily pads on the water.
    await placeKitCluster(scene, 'reed', [
      { x: 5.4, z: 7.2 },
      { x: 6.2, z: 6.6 },
      { x: 13.6, z: 7.4 },
      { x: 14.2, z: 9.1 },
      { x: 5.2, z: 10.4 },
      { x: 13.9, z: 11.2 },
      { x: 7.1, z: 6.4 },
      { x: 11.8, z: 6.5 },
    ]);
    await placeKitCluster(scene, 'lily-pad', [
      { x: 8.2, z: 9.1 },
      { x: 10.4, z: 8.3 },
      { x: 9.1, z: 10.4 },
      { x: 11.6, z: 10.1 },
      { x: 7.4, z: 8.2 },
    ]);

    // Flavour scattered through the glades.
    await placeKitCluster(scene, 'mushroom-cluster', [
      { x: -10.5, z: 6.4 },
      { x: -9.2, z: 10.6 },
      { x: -13.4, z: -6.2 },
      { x: 9.8, z: -8.4 },
      { x: -3.2, z: -9.6 },
      { x: 12.4, z: 2.8 },
    ]);
    await placeKitCluster(scene, 'log-fallen', [
      { x: -12.5, z: 9.6, rotationY: 0.4 },
      { x: 3.2, z: -2.6, rotationY: 1.9 },
      { x: 10.8, z: -3.1, rotationY: 0.8 },
      { x: -9.6, z: -10.4, rotationY: 2.6 },
    ]);

    // The night clearing's ring, instanced as one draw call.
    await placeKitCluster(
      scene,
      'standing-stone',
      NIGHT_STONE_SPOTS.map((spot, index) => ({ x: spot.x, z: spot.z, rotationY: index * 0.7 })),
    );
    // ...and one cloned copy as the raycast target, since an InstancedMesh
    // cannot name which instance was hit.
    nightStoneMesh = await place('standing-stone', NIGHT_STONE_SPOTS[0].x, NIGHT_STONE_SPOTS[0].z);
    nightStoneMesh.visible = false;

    // The Wonder Wall. Scenery in this phase: WF-3 owns `wonder-wall`.
    for (const [index, spot] of WONDER_STONE_SPOTS.entries()) {
      const assetId = [
        options.waggleDanceDiscovered ? 'wonder-stone-bee-lit' : 'wonder-stone-bee',
        'wonder-stone-seed',
        'wonder-stone-sun',
        'wonder-stone-chrysalis',
      ][index];
      await place(assetId, spot.x, spot.z, Math.PI);
    }
    // Chatty on the low centre stone: the narration anchor for a step list
    // that is mostly `NARRATIVE`. Not an NPC, no conversation, never follows.
    const chattyGltf = await loadAsset('companion-chatty');
    const chatty = chattyGltf.scene.clone(true);
    chatty.position.set(CHATTY_PERCH_SPOT.x, 0.55, CHATTY_PERCH_SPOT.z);
    chatty.rotation.y = Math.PI;
    scene.add(chatty);
    const chattyIdle = chattyGltf.animations.find((clip) => clip.name === 'Idle');
    if (chattyIdle) {
      const mixer = new AnimationMixer(chatty);
      mixer.clipAction(chattyIdle).play();
      mixers.push(mixer);
    }
    // The stone Chatty sits on, so they are perched rather than hovering.
    await placeKitCluster(scene, 'standing-stone', [
      { x: CHATTY_PERCH_SPOT.x, z: CHATTY_PERCH_SPOT.z },
    ]);

    // The hive clearing: the hive on its trunk, and the bare patch beside the
    // worn trail that beat 10 fills with flowers.
    await place('foliage-tree', HIVE_TRUNK_SPOT.x, HIVE_TRUNK_SPOT.z);
    beehiveMesh = await place('beehive', BEEHIVE_SPOT.x, BEEHIVE_SPOT.z, Math.PI / 2);
    await place(
      options.waggleDanceDiscovered ? 'flower-patch-bloomed' : 'flower-patch-bare',
      FLOWER_PATCH_SPOT.x,
      FLOWER_PATCH_SPOT.z,
    );

    frogMesh = await place('frog', POND_FROG_SPOT.x, POND_FROG_SPOT.z, Math.PI);
    leafPileMesh = await place('leaf-pile', LEAF_PILE_SPOT.x, LEAF_PILE_SPOT.z);
    caveMesh = await place(
      options.hasGlowingMossJar ? 'cave-mouth-lit' : 'cave-mouth',
      CAVE_MOUTH_SPOT.x,
      CAVE_MOUTH_SPOT.z,
    );
    glowMossMesh = await place('glow-moss', GLOW_MOSS_SPOT.x, GLOW_MOSS_SPOT.z);

    if (options.butterflyGardenComplete) {
      butterflyMesh = await place('butterfly', BUTTERFLY_SPOT.x, BUTTERFLY_SPOT.z);
    }

    // The way back to Welcome Harbor, visible from inside.
    await place('signpost', -16.9, 0, Math.PI / 2);
  }

  void buildWorld();

  const raycastTargets: readonly { entityId: string; mesh: () => Object3D | null }[] = [
    { entityId: 'wonderwild-beehive-peek', mesh: () => beehiveMesh },
    { entityId: 'wonderwild-pond-frog', mesh: () => frogMesh },
    { entityId: 'wonderwild-leaf-pile', mesh: () => leafPileMesh },
    { entityId: 'wonderwild-cave', mesh: () => caveMesh },
    { entityId: 'wonderwild-night-clearing', mesh: () => nightStoneMesh },
    { entityId: 'wonderwild-butterfly', mesh: () => butterflyMesh },
    { entityId: 'wonderwild-glow-moss', mesh: () => glowMossMesh },
  ];

  const raycaster = new Raycaster();
  raycaster.far = RAYCAST_RANGE_METERS;

  function raycastFocus(): string | null {
    raycaster.setFromCamera(new Vector2(0, 0), camera);
    let closestId: string | null = null;
    let closestDistance = Infinity;
    for (const target of raycastTargets) {
      const mesh = target.mesh();
      if (!mesh || !mesh.visible) continue;
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
    bus.emit('ObjectInteracted', { entityId: focused, interactionId: focused });
  }
  const pointerControls = attachPointerControls(renderer, controller, { onInteract: interact });

  const approachZones = ZONES.map((zone) => ({
    id: zone.id,
    zone: toBox3(zone, -1, 3),
    wasInside: false,
  }));
  const checkpointZones = WONDERWILD_FOREST_CHECKPOINTS.map((checkpoint) => ({
    id: checkpoint.id,
    zone: new Box3(
      new Vector3(checkpoint.x - 1.2, -1, checkpoint.z - 1.2),
      new Vector3(checkpoint.x + 1.2, 3, checkpoint.z + 1.2),
    ),
    wasInside: false,
  }));

  let wasFocused: string | null = null;
  const clock = new Clock();

  function frame(): void {
    const delta = Math.min(clock.getDelta(), 0.1);
    pointerControls.update(delta);

    camera.position.set(controller.position.x, EYE_HEIGHT, controller.position.z);
    camera.rotation.y = controller.yaw + Math.PI;
    camera.rotation.x = controller.pitch;

    for (const mixer of mixers) mixer.update(delta);

    const focusedNow = raycastFocus();
    if (focusedNow !== wasFocused) {
      bus.emit('InteractableFocused', { entityId: focusedNow });
    }
    wasFocused = focusedNow;

    for (const approach of approachZones) {
      const insideNow = isInsideZone(controller.position, approach.zone);
      if (insideNow && !approach.wasInside) {
        bus.emit('PlayerEnteredZone', { zoneId: approach.id });
      }
      approach.wasInside = insideNow;
    }
    for (const checkpoint of checkpointZones) {
      const insideNow = isInsideZone(controller.position, checkpoint.zone);
      if (insideNow && !checkpoint.wasInside) {
        bus.emit('PlayerEnteredZone', { zoneId: checkpoint.id });
      }
      checkpoint.wasInside = insideNow;
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

  return { dispose, interact };
}
