import {
  AnimationMixer,
  Box3,
  BoxGeometry,
  CanvasTexture,
  Clock,
  DoubleSide,
  Group,
  LoopOnce,
  LoopRepeat,
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
  fitRendererToParent,
  EYE_HEIGHT,
  placeKitCluster,
  RAYCAST_RANGE_METERS,
  runPlacements,
  toBox3,
} from './sceneKit';
import {
  BARRELS,
  BOUNDARY_WALLS,
  BRIDGE_APPROACH_ZONE,
  BRIDGE_MAX_Z,
  BRIDGE_MIN_Z,
  BRIDGE_SPAN,
  CHANNEL_BED_Y,
  CHANNEL_MAX_X,
  CHANNEL_MIN_X,
  CHANNEL_NORTH_WATER,
  CHANNEL_SOUTH_WATER,
  CHANNEL_SURFACE,
  COVE_GROUND,
  COVE_PATH_RUN,
  COVE_ROCKS,
  COVE_TREES,
  CRATES,
  DOCK_GROUND,
  FOLIAGE_TREES,
  HARBOR_EXIT_ZONE,
  JETTY_PLANK_WIDTH,
  JETTY_RUN,
  MOORING_POSTS,
  NPC_ID,
  NPC_SPOT,
  PATH_RUN,
  REGION_ID,
  ROCKS,
  ROPE_COIL_ID,
  ROPE_COIL_SPOT,
  SEA_HALF_EXTENT,
  SHIPWRECK,
  SHORE_ROCK_RUNS,
  SHORE_ROCK_SCALE,
  SHORE_ROCK_SPACING,
  SOLID_PROPS,
  TIDE_BANK_TOP_CM,
  TIDE_POST_SPOT,
  TIDE_TUNNEL_BOULDERS,
  TIDE_TUNNEL_ZONE,
  tideCmToWorldY,
  TOOLBOX_ID,
  TOOLBOX_SPOT,
  TREASURE_ID,
  TREASURE_SPOT,
  WATER_SURFACE_Y,
  type RectZone,
} from './pirateBuilderBayRegion';
import type { WorldEngineEventBus } from './worldEngineEvents';
import { TIDE_BOARD, TIDE_DURATION_MS, tideLevelAt } from '../tideTrial';

/**
 * The scene half of "Beat the Tide" (`../tideTrial.ts`). Rendering only:
 * the React panel owns the challenge's state and calls these in order, and
 * nothing here decides whether the child succeeded. The one judgement the
 * scene makes for itself is when the rising water reaches the deck, which
 * is the moment the planks visibly lift off.
 */
export interface TideTrialScene {
  /** The tide goes out, the broken bridge clears away, and a new deck stands at `deckCm`. */
  begin(deckCm: number): void;
  setDeckHeight(deckCm: number): void;
  /** Brings the tide in (and the storm wave on top), reporting each new level. Resolves when the water peaks. */
  runTide(onLevel: (waterCm: number) => void): Promise<void>;
  /** After a flood or a too-steep deck: fresh planks at `deckCm`, and the tide goes back out. */
  rebuild(deckCm: number): void;
  /** Success: the deck stays, becomes walkable, and the water settles below it. */
  complete(): void;
  /** Leaving without success: back to the broken bridge and the usual water. */
  cancel(): void;
}

export interface PirateBuilderBayEngine extends ThreeEngineHandle {
  /** Raycasts from the camera center and fires the matching event, if anything interactive is in range. */
  interact(): void;
  tideTrial: TideTrialScene;
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

  /*
    Sand either side of the channel, not one plane across the whole region.
    The single full-extent plane this replaces sat *above* the water quads
    (ground at y=0, water at y=-0.05), so the bay's defining feature - the
    channel the broken bridge crosses - was completely hidden and the child
    walked into an invisible wall on bare sand.
  */
  const sandMaterial = new MeshStandardMaterial({ color: 0xdccf9a });
  function addGround(zone: RectZone): void {
    const patch = new Mesh(
      new PlaneGeometry(zone.maxX - zone.minX, zone.maxZ - zone.minZ),
      sandMaterial,
    );
    patch.rotation.x = -Math.PI / 2;
    patch.position.set((zone.minX + zone.maxX) / 2, 0, (zone.minZ + zone.maxZ) / 2);
    scene.add(patch);
  }
  addGround(DOCK_GROUND);
  addGround(COVE_GROUND);

  // The channel, as a box rather than a plane, so its sides read as banks
  // and no camera angle can see past the water into the background.
  const channelWidth = CHANNEL_SURFACE.maxX - CHANNEL_SURFACE.minX;
  const channelDepth = CHANNEL_SURFACE.maxZ - CHANNEL_SURFACE.minZ;
  const channelHeight = WATER_SURFACE_Y - CHANNEL_BED_Y;
  const channel = new Mesh(
    new BoxGeometry(channelWidth, channelHeight, channelDepth),
    new MeshStandardMaterial({ color: 0x2f6f9e }),
  );
  channel.position.set(
    (CHANNEL_SURFACE.minX + CHANNEL_SURFACE.maxX) / 2,
    WATER_SURFACE_Y - channelHeight / 2,
    (CHANNEL_SURFACE.minZ + CHANNEL_SURFACE.maxZ) / 2,
  );
  scene.add(channel);

  // Stone quay walls down both banks. Hidden behind the water at its usual
  // level; they matter when "Beat the Tide" sends the tide out, which would
  // otherwise leave the sand either side floating over an empty gap.
  const quayMaterial = new MeshStandardMaterial({ color: 0x8a8274 });
  const quayHeight = 0 - CHANNEL_BED_Y;
  for (const wallX of [CHANNEL_MIN_X - 0.101, CHANNEL_MAX_X + 0.101]) {
    const wall = new Mesh(new BoxGeometry(0.2, quayHeight, channelDepth), quayMaterial);
    wall.position.set(wallX, CHANNEL_BED_Y + quayHeight / 2, channel.position.z);
    scene.add(wall);
  }

  // Open sea out to the horizon, so the region stops at a skyline instead
  // of at the edge of the sand with sky underneath it.
  const sea = new Mesh(
    new PlaneGeometry(SEA_HALF_EXTENT * 2, SEA_HALF_EXTENT * 2),
    new MeshStandardMaterial({ color: 0x3a7fae, side: DoubleSide }),
  );
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = WATER_SURFACE_Y;
  scene.add(sea);

  // Boundary colliders, plus the footprints of the props a child would
  // otherwise walk straight through (the wreck, the crate stacks). The
  // boundary itself is now also *visible*, as the shore boulder lines
  // placed in `loadWorldContent`.
  const colliders: Box3[] = [
    ...BOUNDARY_WALLS.map((wall) => toBox3(wall)),
    ...SOLID_PROPS.map((prop) => toBox3(prop)),
    toBox3(CHANNEL_NORTH_WATER, -1, 4),
    toBox3(CHANNEL_SOUTH_WATER, -1, 4),
  ];
  const bridgeCollider = toBox3(BRIDGE_SPAN, -1, 4);
  if (!options.bridgeRepaired) {
    colliders.push(bridgeCollider);
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
  /** The broken bridge's stubs and fallen plank, cleared away while a new deck is built. */
  const brokenBridgeParts: Object3D[] = [];
  let pipClips: AnimationClip[] = [];
  let tideTrialActive = false;

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
      ).map((placement) => ({
        ...placement,
        rotationY: 0,
        scale: { x: 1, y: 1, z: bridgeSpanLength / 3 },
      }));
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
      brokenBridgeParts.push(stubs);
      // One fallen plank, tilted into the gap, for visible damage flavor.
      const fallenPlank = await loadAsset('bridge-plank');
      const fallenScene = fallenPlank.scene.clone(true);
      // Half sunk against the dock bank, one end still out of the water.
      // It used to be placed at y=-0.4 under a ground plane that spanned
      // the channel, which buried two thirds of it and read as a brown
      // slab lying in the sand.
      fallenScene.position.set(CHANNEL_MIN_X + 0.5, WATER_SURFACE_Y - 0.1, 2.4);
      fallenScene.rotation.set(0.1, 1.15, 0.35);
      scene.add(fallenScene);
      brokenBridgeParts.push(fallenScene);
      // A trial begun before the assets arrived has already cleared the bridge.
      for (const part of brokenBridgeParts) part.visible = !tideTrialActive;
    }

    // Terrain kit accents, and the path across the dock picked up again on
    // the cove side. Both path runs are lifted a hair above the sand
    // because `path.gltf` is a flat ground quad and would otherwise
    // z-fight the ground plane it lies on.
    await placeKitCluster(scene, 'rock', [...ROCKS, ...COVE_ROCKS]);
    await placeKitCluster(scene, 'foliage-tree', [...FOLIAGE_TREES, ...COVE_TREES]);
    const pathInstanced = await createInstancedMeshFromAsset(
      'path',
      [
        ...runPlacements(PATH_RUN.from, PATH_RUN.to, 1.5),
        ...runPlacements(COVE_PATH_RUN.from, COVE_PATH_RUN.to, 1.5),
      ].map((placement) => ({ ...placement, position: { ...placement.position, y: 0.01 } })),
    );
    scene.add(pathInstanced);

    // The shoreline: boulder lines standing in for the boundary colliders,
    // which until now had no mesh at all, plus two oversized boulders
    // framing the tide tunnel so Phase 26's secret has a mouth.
    const shoreRocks = SHORE_ROCK_RUNS.flatMap((run) =>
      runPlacements(run.from, run.to, SHORE_ROCK_SPACING).map((placement, index) => ({
        ...placement,
        rotationY: index * 1.1,
        scale: { x: SHORE_ROCK_SCALE, y: SHORE_ROCK_SCALE * 0.8, z: SHORE_ROCK_SCALE },
      })),
    );
    const boulders = await createInstancedMeshFromAsset('rock', [
      ...shoreRocks,
      ...TIDE_TUNNEL_BOULDERS.map((boulder) => ({
        position: { x: boulder.x, y: 0, z: boulder.z },
        rotationY: boulder.x,
        scale: { x: boulder.scale, y: boulder.scale, z: boulder.scale },
      })),
    ]);
    scene.add(boulders);

    // The dock: a jetty out over the open sea off the south shore, built
    // from the same `bridge-plank` piece the bridge uses, with mooring
    // posts at its corners. Decoration outside the boundary collider - it
    // is there so the dock reads as a dock from anywhere on the west side.
    const jettyDeck = await createInstancedMeshFromAsset(
      'bridge-plank',
      runPlacements(JETTY_RUN.from, JETTY_RUN.to, JETTY_PLANK_WIDTH).map((placement) => ({
        ...placement,
        position: { ...placement.position, y: WATER_SURFACE_Y + 0.35 },
      })),
    );
    scene.add(jettyDeck);
    const posts = await createInstancedMeshFromAsset(
      'mooring-post',
      MOORING_POSTS.map((post) => ({ position: { x: post.x, y: CHANNEL_BED_Y, z: post.z } })),
    );
    scene.add(posts);

    // Cargo: the only things in this region at a child's own scale. Some
    // crates are stacked (`y > 0`) and every one is turned a little, so a
    // stack reads as stacked cargo rather than as a texture.
    const crates = await createInstancedMeshFromAsset(
      'crate',
      CRATES.map((crate) => ({
        position: { x: crate.x, y: crate.y ?? 0, z: crate.z },
        rotationY: crate.rotationY ?? 0,
      })),
    );
    scene.add(crates);
    const barrels = await createInstancedMeshFromAsset(
      'barrel',
      BARRELS.map((barrel, index) => ({
        position: { x: barrel.x, y: 0, z: barrel.z },
        rotationY: index * 0.7,
      })),
    );
    scene.add(barrels);

    // The cove's landmark, and the reason the east half is worth crossing
    // the bridge for. Its footprint is already in `colliders`.
    const wreck = await loadAsset('shipwreck');
    const wreckScene = wreck.scene.clone(true);
    wreckScene.position.set(SHIPWRECK.x, 0, SHIPWRECK.z);
    wreckScene.rotation.y = SHIPWRECK.rotationY;
    scene.add(wreckScene);

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
      const mixer = new AnimationMixer(npcScene);
      mixer.clipAction(idleClip).play();
      // A gesture (`playPipGesture`) plays a few times, then Pip goes back to idling.
      mixer.addEventListener('finished', () => {
        mixer.stopAllAction();
        mixer.clipAction(idleClip).play();
      });
      npcMixer = mixer;
      pipClips = npc.animations;
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

  // ---- "Beat the Tide" -------------------------------------------------

  function playPipGesture(clipName: 'Talk' | 'Wave', repetitions: number): void {
    const clip = pipClips.find((candidate) => candidate.name === clipName);
    if (!npcMixer || !clip) return;
    npcMixer.stopAllAction();
    const action = npcMixer.clipAction(clip);
    action.reset();
    action.setLoop(LoopRepeat, repetitions);
    action.play();
  }

  /** The water the scene opened with, in tide-board centimetres. */
  const restingWaterCm =
    ((WATER_SURFACE_Y - CHANNEL_BED_Y) / (0 - CHANNEL_BED_Y)) * TIDE_BANK_TOP_CM;
  /** Where the water settles once the new deck stands: comfortably under any deck that passed. */
  const settledWaterCm = 120;
  let waterCm = restingWaterCm;

  /** Moves the channel's water and the open sea together, so the channel never shows a step where it meets the sea. */
  function setWaterLevel(cm: number): void {
    waterCm = cm;
    const surfaceY = tideCmToWorldY(cm);
    const depth = Math.max(0.01, surfaceY - CHANNEL_BED_Y);
    channel.scale.y = depth / channelHeight;
    channel.position.y = CHANNEL_BED_Y + depth / 2;
    // A centimetre under the channel's surface: coplanar, the two would z-fight along the seam.
    sea.position.y = surfaceY - 0.01;
  }

  interface WaterAnimation {
    startedAt: number;
    durationMs: number;
    levelAt: (elapsedMs: number) => number;
    onLevel?: (cm: number) => void;
    resolve: () => void;
  }
  let waterAnimation: WaterAnimation | null = null;

  function animateWater(
    durationMs: number,
    levelAt: (elapsedMs: number) => number,
    onLevel?: (cm: number) => void,
  ): Promise<void> {
    // A newer animation replaces an unfinished one; the old one's caller is released rather than left hanging.
    waterAnimation?.resolve();
    return new Promise((resolve) => {
      waterAnimation = { startedAt: performance.now(), durationMs, levelAt, onLevel, resolve };
    });
  }

  function easeWaterTo(targetCm: number, durationMs: number): void {
    const fromCm = waterCm;
    void animateWater(durationMs, (elapsed) => {
      const t = Math.min(1, elapsed / durationMs);
      return fromCm + (targetCm - fromCm) * (1 - (1 - t) ** 2);
    });
  }

  // The tide board: red and white bands every 10 cm, numbered every 20 cm,
  // from the channel bed (0 cm) to just above the banks (200 cm).
  const tideBoardTopCm = 200;
  const tideBoardHeight = tideCmToWorldY(tideBoardTopCm) - CHANNEL_BED_Y;
  const tideBoardWidth = 0.8;
  function drawTideBoard(): CanvasTexture | null {
    const canvas = document.createElement('canvas');
    canvas.height = 1024;
    // Matching the board's own proportions, so the numbers are not stretched.
    canvas.width = Math.round((canvas.height * tideBoardWidth) / tideBoardHeight);
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.fillStyle = '#f4efe1';
    context.fillRect(0, 0, canvas.width, canvas.height);
    const pxPerCm = canvas.height / tideBoardTopCm;
    for (let cm = 0; cm < tideBoardTopCm; cm += 10) {
      context.fillStyle = (cm / 10) % 2 === 0 ? '#c8372d' : '#ffffff';
      context.fillRect(0, canvas.height - (cm + 10) * pxPerCm, 200, 10 * pxPerCm);
    }
    context.fillStyle = '#1d2a33';
    context.font = 'bold 92px sans-serif';
    context.textBaseline = 'middle';
    for (let cm = 20; cm < tideBoardTopCm; cm += 20) {
      const y = canvas.height - cm * pxPerCm;
      context.fillRect(200, y - 4, 50, 8);
      context.fillText(String(cm), 280, y);
    }
    return new CanvasTexture(canvas);
  }

  const tideTrialGroup = new Group();
  tideTrialGroup.visible = false;
  scene.add(tideTrialGroup);

  const tidePost = new Mesh(
    new BoxGeometry(0.12, tideBoardHeight + 0.2, 0.12),
    new MeshStandardMaterial({ color: 0x5b4632 }),
  );
  tidePost.position.set(
    TIDE_POST_SPOT.x + 0.08,
    CHANNEL_BED_Y + (tideBoardHeight + 0.2) / 2,
    TIDE_POST_SPOT.z,
  );
  tideTrialGroup.add(tidePost);
  const tideBoardTexture = drawTideBoard();
  if (tideBoardTexture) {
    const board = new Mesh(
      new PlaneGeometry(tideBoardWidth, tideBoardHeight),
      new MeshStandardMaterial({ map: tideBoardTexture }),
    );
    // A plane faces +z; turn it to face west, at the dock side.
    board.rotation.y = -Math.PI / 2;
    board.position.set(TIDE_POST_SPOT.x, CHANNEL_BED_Y + tideBoardHeight / 2, TIDE_POST_SPOT.z);
    tideTrialGroup.add(board);
  }

  // The deck's support posts, stretched from the bed to wherever the deck is.
  const deckPostMaterial = new MeshStandardMaterial({ color: 0x6b4a2b });
  const deckPosts = [-1.5, 1.5].flatMap((x) =>
    [BRIDGE_MIN_Z + 0.15, BRIDGE_MAX_Z - 0.15].map((z) => {
      const post = new Mesh(new BoxGeometry(0.14, 1, 0.14), deckPostMaterial);
      post.position.set(x, 0, z);
      tideTrialGroup.add(post);
      return post;
    }),
  );

  // The deck: six planks laid across the channel, each 0.9 m wide and as long as the span.
  const deckPlankXs = [-2.5, -1.5, -0.5, 0.5, 1.5, 2.5];
  let deckPlanks: Object3D[] = [];
  let deckCm = TIDE_BOARD.lowWaterCm;
  interface FloatingPlank {
    plank: Object3D;
    driftPerSecond: number;
    spinPerSecond: number;
  }
  let floatingPlanks: FloatingPlank[] = [];

  async function loadDeckPlanks(): Promise<void> {
    const plankAsset = await loadAsset('bridge-plank');
    deckPlanks = deckPlankXs.map((x) => {
      const plank = plankAsset.scene.clone(true);
      plank.position.set(x, 0, 0);
      tideTrialGroup.add(plank);
      return plank;
    });
    placeDeck(deckCm);
  }

  function placeDeck(cm: number): void {
    deckCm = cm;
    const deckY = tideCmToWorldY(cm);
    for (const [index, plank] of deckPlanks.entries()) {
      plank.visible = true;
      plank.position.set(deckPlankXs[index] ?? 0, deckY, 0);
      plank.rotation.set(0, 0, 0);
    }
    const postHeight = deckY - CHANNEL_BED_Y;
    for (const post of deckPosts) {
      post.scale.y = postHeight;
      post.position.y = CHANNEL_BED_Y + postHeight / 2;
    }
    floatingPlanks = [];
  }

  function startFloatingAway(): void {
    playPipGesture('Talk', 2);
    floatingPlanks = deckPlanks.map((plank, index) => ({
      plank,
      // Alternate planks drift out opposite ends of the channel, at different speeds.
      driftPerSecond: (index % 2 === 0 ? 1 : -1) * (0.7 + 0.2 * index),
      spinPerSecond: (index % 2 === 0 ? 0.5 : -0.4) * (1 + index * 0.1),
    }));
  }

  function updateTideTrial(deltaSeconds: number): void {
    if (waterAnimation) {
      const animation = waterAnimation;
      const elapsed = performance.now() - animation.startedAt;
      const level = animation.levelAt(Math.min(elapsed, animation.durationMs));
      setWaterLevel(level);
      animation.onLevel?.(Math.round(level));
      if (elapsed >= animation.durationMs) {
        waterAnimation = null;
        animation.resolve();
      }
    }
    if (floatingPlanks.length > 0) {
      const surfaceY = tideCmToWorldY(waterCm);
      for (const floating of floatingPlanks) {
        const { plank } = floating;
        if (!plank.visible) continue;
        // Riding on the surface, a little low in the water.
        plank.position.y = surfaceY - 0.08;
        plank.position.z += floating.driftPerSecond * deltaSeconds;
        plank.rotation.y += floating.spinPerSecond * deltaSeconds;
        if (Math.abs(plank.position.z) > 14) plank.visible = false;
      }
    }
  }

  const tideTrial: TideTrialScene = {
    begin(startDeckCm) {
      tideTrialActive = true;
      for (const part of brokenBridgeParts) part.visible = false;
      tideTrialGroup.visible = true;
      deckCm = startDeckCm;
      if (deckPlanks.length === 0) {
        void loadDeckPlanks();
      } else {
        placeDeck(startDeckCm);
      }
      easeWaterTo(TIDE_BOARD.lowWaterCm, 1800);
      playPipGesture('Talk', 2);
    },
    setDeckHeight(cm) {
      placeDeck(cm);
    },
    runTide(onLevel) {
      let flooded = false;
      return animateWater(
        TIDE_DURATION_MS,
        (elapsed) => tideLevelAt(elapsed),
        (cm) => {
          // Water level with the underside of the deck is enough to lift it (`evaluateDeck`).
          if (!flooded && cm >= deckCm) {
            flooded = true;
            startFloatingAway();
          }
          onLevel(cm);
        },
      );
    },
    rebuild(cm) {
      placeDeck(cm);
      easeWaterTo(TIDE_BOARD.lowWaterCm, 1500);
    },
    complete() {
      const colliderIndex = colliders.indexOf(bridgeCollider);
      if (colliderIndex >= 0) colliders.splice(colliderIndex, 1);
      easeWaterTo(settledWaterCm, 2500);
      playPipGesture('Wave', 3);
    },
    cancel() {
      tideTrialActive = false;
      tideTrialGroup.visible = false;
      for (const part of brokenBridgeParts) part.visible = true;
      floatingPlanks = [];
      easeWaterTo(restingWaterCm, 1500);
    },
  };

  const pointerControls = attachPointerControls(renderer, controller, { onInteract: interact });
  const stopFittingRenderer = fitRendererToParent(parent, camera, renderer);

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
    updateTideTrial(delta);

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
    // Release anyone awaiting a tide, so an unmounted panel's promise does not hang.
    waterAnimation?.resolve();
    waterAnimation = null;
    tideBoardTexture?.dispose();
    pointerControls.dispose();
    stopFittingRenderer();
    renderer.dispose();
    parent.removeChild(renderer.domElement);
  }

  return { dispose, interact, tideTrial };
}
