import {
  AnimationMixer,
  Box3,
  BoxGeometry,
  Clock,
  DoubleSide,
  LoopOnce,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Raycaster,
  Vector2,
  Vector3,
  type AnimationClip,
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
  RAYCAST_RANGE_METERS,
  runPlacements,
  toBox3,
} from './sceneKit';
import {
  BOUNDARY_WALLS,
  BRIDGE_APPROACH_ZONE,
  BRIDGE_MAX_Z,
  BRIDGE_MIN_Z,
  BRIDGE_SPAN,
  CHANNEL_MAX_X,
  CHANNEL_MIN_X,
  CHANNEL_NORTH_WATER,
  CHANNEL_SOUTH_WATER,
  FOLIAGE_TREES,
  GROUND_HALF_EXTENT_X,
  GROUND_HALF_EXTENT_Z,
  HARBOR_EXIT_ZONE,
  NPC_ID,
  NPC_SPOT,
  PATH_RUN,
  REGION_ID,
  ROCKS,
  ROPE_COIL_ID,
  ROPE_COIL_SPOT,
  TIDE_TUNNEL_ZONE,
  TOOLBOX_ID,
  TOOLBOX_SPOT,
  TREASURE_ID,
  TREASURE_SPOT,
  type RectZone,
} from './pirateBuilderBayRegion';
import type { WorldEngineEventBus } from './worldEngineEvents';

export interface PirateBuilderBayEngine extends ThreeEngineHandle {
  /** Raycasts from the camera center and fires the matching event, if anything interactive is in range. */
  interact(): void;
}

export interface PirateBuilderBayEngineOptions {
  /** The child's last saved checkpoint id (`ChildWorldState.lastCheckpointId`), if any. */
  startCheckpointId?: string;
  /** Whether `WorldChange.changeKey === 'BRIDGE_REPAIRED'` has already been recorded for this child. */
  bridgeRepaired: boolean;
}

/**
 * Pirate Builder Bay's Phase 33 first-person region, re-pointed at real
 * Phase 34 assets (`assets/manifest.ts`) instead of inline primitive
 * geometry - the bridge itself is the one region-specific case: a `bridge-
 * plank`/`bridge-plank-repaired` kit piece instanced differently for the
 * broken (gapped, one fallen) vs. repaired (continuous run) state, still
 * read once at construction time per this file's original header comment.
 * `sceneKit.ts` owns the camera/renderer/lighting bootstrap this file used
 * to duplicate with `welcomeHarborScene.ts`, and Pip loads through the real
 * `assetLoader.ts` fetch path instead of the retired `placeholderNpcGltf.ts`
 * in-memory parse.
 *
 * Rendering glue, like every existing `scenes/*.ts` Phaser scene: not unit
 * tested here, since it needs a real WebGL/DOM context. The geometry and
 * ids it reads (`pirateBuilderBayRegion.ts`, `discovery/checkpoints.ts`)
 * and the asset pipeline it calls into (`assets/*.ts`, `sceneKit.ts`) are
 * tested independently.
 */
export function createPirateBuilderBayEngine(
  parent: HTMLDivElement,
  bus: WorldEngineEventBus,
  options: PirateBuilderBayEngineOptions,
): PirateBuilderBayEngine {
  const { scene, camera, renderer } = createSceneBootstrap(parent, 0x9fd4ec);

  const ground = new Mesh(
    new PlaneGeometry(GROUND_HALF_EXTENT_X * 2, GROUND_HALF_EXTENT_Z * 2),
    new MeshStandardMaterial({ color: 0xdccf9a }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  const waterMaterial = new MeshStandardMaterial({ color: 0x2f6f9e, side: DoubleSide });
  function addWater(zone: RectZone): void {
    const water = new Mesh(
      new PlaneGeometry(zone.maxX - zone.minX, zone.maxZ - zone.minZ),
      waterMaterial,
    );
    water.rotation.x = -Math.PI / 2;
    water.position.set((zone.minX + zone.maxX) / 2, -0.05, (zone.minZ + zone.maxZ) / 2);
    scene.add(water);
  }
  addWater(CHANNEL_NORTH_WATER);
  addWater(CHANNEL_SOUTH_WATER);

  // Boundary colliders only - no visible wall mesh, matching
  // `welcomeHarborScene.ts`'s outer boundary (the ground plane's own extent
  // reads as the plot edge).
  const colliders: Box3[] = [
    ...BOUNDARY_WALLS.map((wall) => toBox3(wall)),
    toBox3(CHANNEL_NORTH_WATER, -1, 4),
    toBox3(CHANNEL_SOUTH_WATER, -1, 4),
  ];
  if (!options.bridgeRepaired) {
    colliders.push(toBox3(BRIDGE_SPAN, -1, 4));
  }

  const controller = new FirstPersonController({ colliders });

  const spawn = resolveSpawnCheckpoint(REGION_ID, options.startCheckpointId);
  controller.position.set(spawn.x, 0, spawn.z);
  controller.yaw = spawn.yaw;

  // Pip, shown as a placeholder box until the real `npc-pip` asset resolves.
  const npcPlaceholder = new Mesh(
    new BoxGeometry(0.4, 0.6, 0.2),
    new MeshStandardMaterial({ color: 0x2f8f4e }),
  );
  npcPlaceholder.position.set(NPC_SPOT.x, 0, NPC_SPOT.z);
  scene.add(npcPlaceholder);
  let npcMesh: Object3D = npcPlaceholder;
  let npcMixer: AnimationMixer | null = null;

  let ropeCoilMesh: Object3D | null = null;
  let toolboxMesh: Object3D | null = null;
  let treasureChestMesh: Object3D | null = null;
  let treasureMixer: AnimationMixer | null = null;
  let treasureOpenClip: AnimationClip | null = null;
  let treasureOpened = false;

  async function loadWorldContent(): Promise<void> {
    // The bridge: an actual geometry/collider difference between broken and
    // repaired, read once here, per this file's header comment - now
    // sourced from `bridge-plank`/`bridge-plank-repaired` instead of inline
    // branching `BoxGeometry`.
    const bridgeSpanLength = BRIDGE_MAX_Z - BRIDGE_MIN_Z;
    if (options.bridgeRepaired) {
      const plankWidth = 1;
      const deckPlanks = runPlacements(
        { x: CHANNEL_MIN_X, z: 0 },
        { x: CHANNEL_MAX_X, z: 0 },
        plankWidth,
      ).map((placement) => ({ ...placement, rotationY: 0, scale: { x: 1, y: 1, z: bridgeSpanLength / 3 } }));
      const deck = await createInstancedMeshFromAsset('bridge-plank-repaired', deckPlanks);
      scene.add(deck);
      // No collider over the deck span: it is a real doorway across the channel now.
    } else {
      const brokenPlanks = [
        { position: { x: CHANNEL_MIN_X + 0.6, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
        { position: { x: CHANNEL_MAX_X - 0.6, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
      ];
      const stubs = await createInstancedMeshFromAsset('bridge-plank', brokenPlanks);
      scene.add(stubs);
      // One fallen plank, tilted into the gap, for visible damage flavor.
      const fallenPlank = await loadAsset('bridge-plank');
      const fallenScene = fallenPlank.scene.clone(true);
      fallenScene.position.set(0.4, -0.4, 0.6);
      fallenScene.rotation.set(0.9, 0.3, 0.4);
      scene.add(fallenScene);
    }

    // Terrain kit accents and a decorative path run leading toward the bridge.
    await placeKitCluster(scene, 'rock', ROCKS);
    await placeKitCluster(scene, 'foliage-tree', FOLIAGE_TREES);
    const pathInstanced = await createInstancedMeshFromAsset('path', runPlacements(PATH_RUN.from, PATH_RUN.to, 1.5));
    scene.add(pathInstanced);

    // Quest props (roadmap: "quest props"), still flavor-only per this
    // region's own header comment - now real loaded assets instead of
    // inline primitives.
    const [ropeCoil, toolbox, treasureChest, signpost] = await Promise.all([
      loadAsset('rope-coil'),
      loadAsset('toolbox'),
      loadAsset('treasure-chest'),
      loadAsset('signpost'),
    ]);

    const ropeCoilScene = ropeCoil.scene.clone(true);
    ropeCoilScene.position.set(ROPE_COIL_SPOT.x, 0, ROPE_COIL_SPOT.z);
    scene.add(ropeCoilScene);
    ropeCoilMesh = ropeCoilScene;

    const toolboxScene = toolbox.scene.clone(true);
    toolboxScene.position.set(TOOLBOX_SPOT.x, 0, TOOLBOX_SPOT.z);
    scene.add(toolboxScene);
    toolboxMesh = toolboxScene;

    const treasureChestScene = treasureChest.scene.clone(true);
    treasureChestScene.position.set(TREASURE_SPOT.x, 0, TREASURE_SPOT.z);
    scene.add(treasureChestScene);
    treasureChestMesh = treasureChestScene;
    treasureMixer = new AnimationMixer(treasureChestScene);
    treasureOpenClip = treasureChest.animations.find((clip) => clip.name === 'Open') ?? null;

    const signpostScene = signpost.scene.clone(true);
    signpostScene.position.set(
      (HARBOR_EXIT_ZONE.minX + HARBOR_EXIT_ZONE.maxX) / 2,
      0,
      (HARBOR_EXIT_ZONE.minZ + HARBOR_EXIT_ZONE.maxZ) / 2,
    );
    scene.add(signpostScene);

    // Pip: swap the placeholder box for the real, animated asset.
    const npc = await loadAsset('npc-pip');
    const npcScene = npc.scene.clone(true);
    npcScene.position.set(NPC_SPOT.x, 0, NPC_SPOT.z);
    npcScene.name = 'Pip';
    scene.add(npcScene);
    npcPlaceholder.visible = false;
    npcMesh = npcScene;
    const idleClip = npc.animations.find((clip) => clip.name === 'Idle');
    if (idleClip) {
      npcMixer = new AnimationMixer(npcScene);
      npcMixer.clipAction(idleClip).play();
    }
  }

  void loadWorldContent();

  const raycastTargets: readonly { entityId: string; mesh: () => Object3D | null }[] = [
    { entityId: NPC_ID, mesh: () => npcMesh },
    { entityId: ROPE_COIL_ID, mesh: () => ropeCoilMesh },
    { entityId: TOOLBOX_ID, mesh: () => toolboxMesh },
    { entityId: TREASURE_ID, mesh: () => treasureChestMesh },
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
    bus.emit('ObjectInteracted', { entityId: focused, interactionId: `${focused}:interact` });
    // A one-time visual flourish (roadmap: exercise the "Open" clip on a
    // real prop), not a mechanically-required step - the treasure/cove
    // discovery itself is gated by `BRIDGE_REPAIRED`, not by this animation.
    if (focused === TREASURE_ID && !treasureOpened && treasureMixer && treasureOpenClip) {
      const action = treasureMixer.clipAction(treasureOpenClip);
      action.setLoop(LoopOnce, 1);
      action.clampWhenFinished = true;
      action.play();
      treasureOpened = true;
    }
  }
  const pointerControls = attachPointerControls(renderer, controller, { onInteract: interact });

  const approachZones = [
    { id: BRIDGE_APPROACH_ZONE.id, zone: toBox3(BRIDGE_APPROACH_ZONE, -1, 3), wasInside: false },
    { id: TIDE_TUNNEL_ZONE.id, zone: toBox3(TIDE_TUNNEL_ZONE, -1, 3), wasInside: false },
    { id: HARBOR_EXIT_ZONE.id, zone: toBox3(HARBOR_EXIT_ZONE, -1, 3), wasInside: false },
  ];
  const checkpointZones = [
    {
      id: 'pirate-builder-bay:dock',
      zone: new Box3(new Vector3(-9, -1, -1.5), new Vector3(-7, 3, 1.5)),
      wasInside: false,
    },
    {
      id: 'pirate-builder-bay:bridge-approach',
      zone: toBox3(BRIDGE_APPROACH_ZONE, -1, 3),
      wasInside: false,
    },
    {
      id: 'pirate-builder-bay:cove',
      zone: new Box3(new Vector3(8, -1, -1.5), new Vector3(10, 3, 1.5)),
      wasInside: false,
    },
  ];

  let wasNearNpc = false;
  let wasFocused: string | null = null;
  const clock = new Clock();

  function frame(): void {
    const delta = Math.min(clock.getDelta(), 0.1);

    pointerControls.update(delta);

    camera.position.set(controller.position.x, EYE_HEIGHT, controller.position.z);
    camera.rotation.y = controller.yaw + Math.PI;
    camera.rotation.x = controller.pitch;

    npcMixer?.update(delta);
    treasureMixer?.update(delta);

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
