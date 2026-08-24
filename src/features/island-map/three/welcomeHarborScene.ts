import {
  AnimationMixer,
  Box3,
  BoxGeometry,
  CatmullRomCurve3,
  Clock,
  ConeGeometry,
  DoubleSide,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Raycaster,
  Vector2,
  Vector3,
} from 'three';
import { createInstancedMeshFromAsset, loadAsset } from './assets/assetLoader';
import { resolveSpawnCheckpoint } from '../../discovery/checkpoints';
import type { ThreeEngineHandle } from './ThreeGameContainer';
import { FirstPersonController } from './firstPersonController';
import { attachPointerControls } from './pointerControls';
import { hasApproached, isInRange, isInsideZone } from './sandboxTriggers';
import {
  APPROACH_RANGE_METERS,
  createSceneBootstrap,
  EYE_HEIGHT,
  placeKitCluster,
  placeWithLod,
  RAYCAST_RANGE_METERS,
  runPlacements,
  toBox3,
  WALL_HEIGHT,
} from './sceneKit';
import {
  AMBIENT_GULL_PATH,
  BOUNDARY_WALLS,
  BUILDINGS,
  COLLECTIBLE_ID,
  COLLECTIBLE_SPOT,
  FENCE_RUN,
  FOLIAGE_BUSHES,
  FOLIAGE_TREES,
  GROUND_HALF_EXTENT,
  NPC_ID,
  NPC_SPOT,
  REGION_ID,
  SCENERY_CLUSTER,
  WELCOME_HARBOR_REGION_CHECKPOINTS,
} from './welcomeHarborRegion';
import type { WorldEngineEventBus } from './worldEngineEvents';

/** One wall segment collider for a building side, sized from its footprint and which side is missing (the doorway). */
function buildingWallColliders(building: (typeof BUILDINGS)[number]): Box3[] {
  const { x, z, halfWidth, halfDepth, height } = building;
  const thickness = 0.2;
  const colliders: Box3[] = [];
  for (const side of building.wallSides) {
    if (side === 'north') {
      colliders.push(
        new Box3(
          new Vector3(x - halfWidth, 0, z - halfDepth - thickness),
          new Vector3(x + halfWidth, height, z - halfDepth + thickness),
        ),
      );
    } else if (side === 'south') {
      colliders.push(
        new Box3(
          new Vector3(x - halfWidth, 0, z + halfDepth - thickness),
          new Vector3(x + halfWidth, height, z + halfDepth + thickness),
        ),
      );
    } else if (side === 'east') {
      colliders.push(
        new Box3(
          new Vector3(x + halfWidth - thickness, 0, z - halfDepth),
          new Vector3(x + halfWidth + thickness, height, z + halfDepth),
        ),
      );
    } else {
      colliders.push(
        new Box3(
          new Vector3(x - halfWidth - thickness, 0, z - halfDepth),
          new Vector3(x - halfWidth + thickness, height, z + halfDepth),
        ),
      );
    }
  }
  return colliders;
}

/** The two ground corners of one building wall side, for tiling `wall` kit-piece panels along it. */
function wallSideRun(
  building: (typeof BUILDINGS)[number],
  side: 'north' | 'south' | 'east' | 'west',
): { from: { x: number; z: number }; to: { x: number; z: number } } {
  const { x, z, halfWidth, halfDepth } = building;
  switch (side) {
    case 'north':
      return { from: { x: x - halfWidth, z: z - halfDepth }, to: { x: x + halfWidth, z: z - halfDepth } };
    case 'south':
      return { from: { x: x - halfWidth, z: z + halfDepth }, to: { x: x + halfWidth, z: z + halfDepth } };
    case 'east':
      return { from: { x: x + halfWidth, z: z - halfDepth }, to: { x: x + halfWidth, z: z + halfDepth } };
    case 'west':
      return { from: { x: x - halfWidth, z: z - halfDepth }, to: { x: x - halfWidth, z: z + halfDepth } };
  }
}

const WALL_PANEL_WIDTH_METERS = 2;

export interface WelcomeHarborEngine extends ThreeEngineHandle {
  /** Raycasts from the camera center and fires the matching event, if anything interactive is in range. */
  interact(): void;
}

export interface WelcomeHarborEngineOptions {
  /** The child's last saved checkpoint id (`ChildWorldState.lastCheckpointId`), if any. */
  startCheckpointId?: string;
}

/**
 * Welcome Harbor's Phase 32 first-person region (`docs/ROADMAP.md` Phase
 * 32), re-pointed at real Phase 34 assets (`assets/manifest.ts`) instead of
 * inline primitive geometry: kit-piece walls/roofs/doors compose the two
 * buildings, `sceneKit.ts` owns the camera/renderer/lighting bootstrap both
 * this file and `pirateBuilderBayScene.ts` used to duplicate, and Pip loads
 * through the real `assetLoader.ts` fetch path instead of the retired
 * `placeholderNpcGltf.ts` in-memory parse. See
 * `docs/THREE_WORLD_ASSET_CONVENTIONS.md` for the pivot/scale/animation
 * conventions every placement below relies on.
 *
 * Rendering glue, like every existing `scenes/*.ts` Phaser scene: not unit
 * tested here, since it needs a real WebGL/DOM context. The geometry and
 * ids it reads (`welcomeHarborRegion.ts`, `discovery/checkpoints.ts`) and
 * the asset pipeline it calls into (`assets/*.ts`, `sceneKit.ts`) are
 * tested independently.
 */
export function createWelcomeHarborEngine(
  parent: HTMLDivElement,
  bus: WorldEngineEventBus,
  options: WelcomeHarborEngineOptions = {},
): WelcomeHarborEngine {
  const { scene, camera, renderer } = createSceneBootstrap(parent, 0x8fc7e6);

  // Boundary + building wall colliders, one Box3 per wall segment. Each
  // building's missing side (its `wallSides` omission) has no collider, so
  // it is a real doorway the child walks through, not a solid box with a
  // decal on it.
  const colliders: Box3[] = [...BOUNDARY_WALLS.map((wall) => toBox3(wall))];
  for (const building of BUILDINGS) {
    colliders.push(...buildingWallColliders(building));
  }

  const controller = new FirstPersonController({ colliders });

  const spawn = resolveSpawnCheckpoint(REGION_ID, options.startCheckpointId);
  controller.position.set(spawn.x, 0, spawn.z);
  controller.yaw = spawn.yaw;

  // Pip, shown as a placeholder box until the real `npc-pip` asset resolves
  // (a real network fetch now, unlike the retired in-memory placeholder).
  const npcPlaceholder = new Mesh(
    new BoxGeometry(0.4, 0.6, 0.2),
    new MeshStandardMaterial({ color: 0x2f8f4e }),
  );
  npcPlaceholder.position.set(NPC_SPOT.x, 0, NPC_SPOT.z);
  scene.add(npcPlaceholder);

  let npcMixer: AnimationMixer | null = null;
  let npcMesh: Object3D = npcPlaceholder;
  let collectibleMesh: Object3D | null = null;
  const collectibleMixers: AnimationMixer[] = [];

  async function loadWorldContent(): Promise<void> {
    // Terrain kit: a 6x6 grid of ground-tile.gltf covers the 24x24 walkable
    // ground exactly (GROUND_HALF_EXTENT=12), proving the kit-tiling
    // approach the old single big PlaneGeometry never needed to.
    const tileSize = 4;
    const tilesPerSide = (GROUND_HALF_EXTENT * 2) / tileSize;
    const groundTiles = Array.from({ length: tilesPerSide * tilesPerSide }, (_, index) => {
      const ix = index % tilesPerSide;
      const iz = Math.floor(index / tilesPerSide);
      return {
        x: -GROUND_HALF_EXTENT + tileSize / 2 + ix * tileSize,
        z: -GROUND_HALF_EXTENT + tileSize / 2 + iz * tileSize,
      };
    });

    // Building kit: every wall panel across both buildings tiled and
    // instanced together (one draw call), one roof and one door per
    // building (each scaled to that building's own footprint). `wall.gltf`
    // is authored at `WALL_HEIGHT` (3m); each panel's y-scale stretches it
    // to that building's actual height so the roof (placed at
    // `building.height`) sits flush on top instead of floating over a gap
    // for a taller building or sinking into a shorter one.
    const wallRuns = BUILDINGS.flatMap((building) => {
      const heightScale = building.height / WALL_HEIGHT;
      return building.wallSides.flatMap((side) => {
        const run = wallSideRun(building, side);
        return runPlacements(run.from, run.to, WALL_PANEL_WIDTH_METERS).map((placement) => ({
          ...placement,
          scale: { y: heightScale },
        }));
      });
    });
    const roofPlacements = BUILDINGS.map((building) => {
      const radius = Math.max(building.halfWidth, building.halfDepth) * 1.3;
      return {
        position: { x: building.x, y: building.height, z: building.z },
        rotationY: Math.PI / 4,
        scale: { x: radius / 1.5, y: 1, z: radius / 1.5 },
      };
    });
    const doorPlacements = BUILDINGS.flatMap((building) => {
      const missingSide = (['north', 'south', 'east', 'west'] as const).find(
        (side) => !building.wallSides.includes(side),
      );
      if (!missingSide) return [];
      const run = wallSideRun(building, missingSide);
      return [{ position: { x: (run.from.x + run.to.x) / 2, y: 0, z: (run.from.z + run.to.z) / 2 } }];
    });

    const [groundInstanced, wallInstanced, roofInstanced, doorInstanced] = await Promise.all([
      createInstancedMeshFromAsset('ground-tile', groundTiles.map((position) => ({ position: { x: position.x, y: 0, z: position.z } }))),
      createInstancedMeshFromAsset('wall', wallRuns),
      createInstancedMeshFromAsset('roof', roofPlacements),
      createInstancedMeshFromAsset('door', doorPlacements),
    ]);
    scene.add(groundInstanced, wallInstanced, roofInstanced, doorInstanced);

    // Water at the region's south edge, where the ambient gull loops -
    // still a flat color plane (not a kit deliverable), unchanged.
    const water = new Mesh(
      new PlaneGeometry(GROUND_HALF_EXTENT * 2, 8),
      new MeshStandardMaterial({ color: 0x2f6f9e, side: DoubleSide }),
    );
    water.rotation.x = -Math.PI / 2;
    water.position.set(0, -0.05, GROUND_HALF_EXTENT - 4);
    scene.add(water);

    // Instanced crate cluster, now sourced from the `rock` terrain-kit
    // piece instead of an inline BoxGeometry.
    await placeKitCluster(
      scene,
      'rock',
      SCENERY_CLUSTER.map((position, index) => ({ x: position.x, z: position.z, rotationY: index * 0.6 })),
    );

    // Foliage kit: trees individually placed (LOD-aware), bushes instanced.
    await Promise.all(FOLIAGE_TREES.map((tree) => placeWithLod(scene, 'foliage-tree', tree)));
    await placeKitCluster(scene, 'foliage-bush', FOLIAGE_BUSHES);

    // A decorative fence run - no collider, purely visual.
    const fenceInstanced = await createInstancedMeshFromAsset('fence', runPlacements(FENCE_RUN.from, FENCE_RUN.to, 1.2));
    scene.add(fenceInstanced);

    // The one collectible (roadmap: "one collectible"), wired to the same
    // `CollectiblePickedUp` event the Phase 31 sandbox established.
    const collectible = await loadAsset('collectible-gem');
    const collectibleScene = collectible.scene.clone(true);
    collectibleScene.position.set(COLLECTIBLE_SPOT.x, 0, COLLECTIBLE_SPOT.z);
    scene.add(collectibleScene);
    collectibleMesh = collectibleScene;
    const idleClip = collectible.animations.find((clip) => clip.name === 'Idle');
    if (idleClip) {
      const mixer = new AnimationMixer(collectibleScene);
      mixer.clipAction(idleClip).play();
      collectibleMixers.push(mixer);
    }

    // Pip: swap the placeholder box for the real, animated asset.
    const npc = await loadAsset('npc-pip');
    const npcScene = npc.scene.clone(true);
    npcScene.position.set(NPC_SPOT.x, 0, NPC_SPOT.z);
    npcScene.name = 'Pip';
    scene.add(npcScene);
    npcPlaceholder.visible = false;
    npcMesh = npcScene;
    const npcIdleClip = npc.animations.find((clip) => clip.name === 'Idle');
    if (npcIdleClip) {
      npcMixer = new AnimationMixer(npcScene);
      npcMixer.clipAction(npcIdleClip).play();
    }
  }

  void loadWorldContent();

  // The ambient gull: purely decorative environmental animation
  // (roadmap: "ambient creatures and environmental animation"), never
  // raycast-interactive and never emits a domain event. Still a code-drawn
  // primitive - the first asset pack does not include a bird, per
  // `docs/IMPLEMENTATION_STATUS.md`'s Phase 34 entry.
  const gullPath = new CatmullRomCurve3(
    AMBIENT_GULL_PATH.map((point) => new Vector3(point.x, point.y, point.z)),
    true,
  );
  const gull = new Mesh(
    new ConeGeometry(0.25, 0.9, 4),
    new MeshStandardMaterial({ color: 0xf4f1e8 }),
  );
  gull.rotation.x = Math.PI / 2;
  scene.add(gull);
  const gullSpeed = 0.05; // loops per second

  const raycaster = new Raycaster();
  raycaster.far = RAYCAST_RANGE_METERS;

  function raycastFocus(): string | null {
    raycaster.setFromCamera(new Vector2(0, 0), camera);
    const npcHits = raycaster.intersectObject(npcMesh, true);
    if (npcHits.length > 0) return NPC_ID;
    if (collectibleMesh) {
      const collectibleHits = raycaster.intersectObject(collectibleMesh, true);
      if (collectibleHits.length > 0) return COLLECTIBLE_ID;
    }
    return null;
  }

  function interact(): void {
    const focused = raycastFocus();
    if (focused === NPC_ID) {
      bus.emit('ObjectInteracted', { entityId: NPC_ID, interactionId: `${NPC_ID}:talk` });
    } else if (focused === COLLECTIBLE_ID && collectibleMesh) {
      bus.emit('ObjectInteracted', { entityId: COLLECTIBLE_ID, interactionId: `${COLLECTIBLE_ID}:collect` });
      bus.emit('CollectiblePickedUp', { entityId: COLLECTIBLE_ID });
      scene.remove(collectibleMesh);
      collectibleMesh = null;
    }
  }
  const pointerControls = attachPointerControls(renderer, controller, { onInteract: interact });

  const checkpointZones = WELCOME_HARBOR_REGION_CHECKPOINTS.map((checkpoint) => ({
    id: checkpoint.id,
    zone: new Box3(
      new Vector3(checkpoint.x - 1.5, -1, checkpoint.z - 1.5),
      new Vector3(checkpoint.x + 1.5, 3, checkpoint.z + 1.5),
    ),
    wasInside: false,
  }));
  const interiorZones = BUILDINGS.map((building) => ({
    id: building.interiorZone.id,
    zone: toBox3(building.interiorZone, -1, 6),
    wasInside: false,
  }));

  let wasNearNpc = false;
  let wasFocused: string | null = null;
  let gullT = 0;
  const clock = new Clock();

  function frame(): void {
    const delta = Math.min(clock.getDelta(), 0.1);

    pointerControls.update(delta);

    camera.position.set(controller.position.x, EYE_HEIGHT, controller.position.z);
    // See sandboxScene.ts for why +PI: the controller's forward axis is the
    // opposite of a Three.js camera's default forward at yaw 0.
    camera.rotation.y = controller.yaw + Math.PI;
    camera.rotation.x = controller.pitch;

    npcMixer?.update(delta);
    for (const mixer of collectibleMixers) mixer.update(delta);

    gullT = (gullT + delta * gullSpeed) % 1;
    const gullPoint = gullPath.getPointAt(gullT);
    const gullLookAhead = gullPath.getPointAt((gullT + 0.01) % 1);
    gull.position.copy(gullPoint);
    gull.lookAt(gullLookAhead);

    const npcNearNow = isInRange(
      controller.position,
      new Vector3(NPC_SPOT.x, 0, NPC_SPOT.z),
      APPROACH_RANGE_METERS,
    );
    if (
      hasApproached(
        controller.position,
        new Vector3(NPC_SPOT.x, 0, NPC_SPOT.z),
        APPROACH_RANGE_METERS,
        wasNearNpc,
      )
    ) {
      bus.emit('NpcApproached', { entityId: NPC_ID });
    }
    wasNearNpc = npcNearNow;

    const focusedNow = raycastFocus();
    if (focusedNow !== wasFocused) {
      bus.emit('InteractableFocused', { entityId: focusedNow });
    }
    wasFocused = focusedNow;

    for (const checkpoint of checkpointZones) {
      const insideNow = isInsideZone(controller.position, checkpoint.zone);
      if (insideNow && !checkpoint.wasInside) {
        bus.emit('PlayerEnteredZone', { zoneId: checkpoint.id });
      }
      checkpoint.wasInside = insideNow;
    }
    for (const interior of interiorZones) {
      const insideNow = isInsideZone(controller.position, interior.zone);
      if (insideNow && !interior.wasInside) {
        bus.emit('PlayerEnteredZone', { zoneId: interior.id });
      }
      interior.wasInside = insideNow;
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
