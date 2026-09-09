import {
  AnimationMixer,
  Box3,
  BoxGeometry,
  CatmullRomCurve3,
  Clock,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Raycaster,
  TorusGeometry,
  Vector2,
  Vector3,
} from 'three';
import { resolveSpawnCheckpoint } from '../../discovery/checkpoints';
import { createInstancedMeshFromAsset, loadAsset } from './assets/assetLoader';
import {
  AMBIENT_GULL_PATH,
  BOUNDARY_WALLS,
  CLOCK_TOWER,
  CLOCKWORK_HARBOR_REGION_CHECKPOINTS,
  DISTRICT_ZONES,
  DOCK_CLUTTER,
  DOCK_DECK,
  GOLDEN_GEAR_SPOTS,
  GROUND_HALF_EXTENT,
  HARBOR_GATE,
  LIGHTHOUSE,
  LIGHTHOUSE_MECHANISM,
  MARKET_STALLS,
  NPC_SPOTS,
  REGION_ID,
  WATER_ZONES,
} from './clockworkHarborRegion';
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
  WALL_HEIGHT,
} from './sceneKit';
import type { ThreeEngineHandle } from './ThreeGameContainer';
import type { WorldEngineEventBus } from './worldEngineEvents';

/**
 * Clockwork Harbor's first-person scene (`docs/regions/clockwork.md` section
 * 9, "Phase 3 - Clockwork Harbor MVP Environment").
 *
 * Rendering glue, like `welcomeHarborScene.ts` and every `scenes/*.ts` Phaser
 * scene before it: not unit tested here, because it needs a real WebGL/DOM
 * context. What it *reads* is tested independently - the geometry and ids in
 * `clockworkHarborRegion.ts`, the checkpoint vocabulary in
 * `discovery/checkpoints.ts`, and the asset pipeline in `assets/*.ts` and
 * `sceneKit.ts`.
 *
 * The harbor reuses the existing asset manifest rather than adding to it.
 * Section 21 of the roadmap lists a mechanical asset inventory (gears, valves,
 * pipes, generators) that does not exist yet, so machinery is drawn here from
 * code primitives and clearly marked - the same interim `docs/IMPLEMENTATION_
 * STATUS.md` records for Welcome Harbor's gull. Every one of these is a
 * placeholder for an authored GLB, and none of them carries game state: the
 * ids they answer to come from the region module, so swapping in real art
 * changes no logic.
 */

const WALL_PANEL_WIDTH_METERS = 2;

/** Brass, iron, and verdigris: the harbor's palette, so placeholders at least read as one town. */
const BRASS = 0xc9a227;
const IRON = 0x4a4e57;
const VERDIGRIS = 0x4c9a8a;

export interface ClockworkHarborEngine extends ThreeEngineHandle {
  /** Raycasts from the camera center and fires the matching event, if anything interactive is in range. */
  interact(): void;
}

export interface ClockworkHarborEngineOptions {
  /** The child's last saved checkpoint id (`ChildWorldState.lastCheckpointId`), if any. */
  startCheckpointId?: string;
  /**
   * Whether the lighthouse has already been repaired
   * (`ClockworkHarborState.lighthouseFixed`).
   *
   * Passed in rather than read here, because the World Engine must not reach
   * into World State (ADR-008). Section 2.3 is what this is for: a child who
   * fixed the lighthouse last visit walks back into a harbor whose lamp is lit
   * and whose gate stands open, with no menu to check.
   */
  lighthouseFixed?: boolean;
}

/** One wall segment collider per built side of the lighthouse; the omitted side is the doorway. */
function lighthouseWallColliders(): Box3[] {
  const { x, z, halfWidth, halfDepth, height } = LIGHTHOUSE;
  const thickness = 0.25;
  const colliders: Box3[] = [];
  for (const side of LIGHTHOUSE.wallSides) {
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

function lighthouseWallRun(side: 'north' | 'south' | 'east' | 'west') {
  const { x, z, halfWidth, halfDepth } = LIGHTHOUSE;
  switch (side) {
    case 'north':
      return {
        from: { x: x - halfWidth, z: z - halfDepth },
        to: { x: x + halfWidth, z: z - halfDepth },
      };
    case 'south':
      return {
        from: { x: x - halfWidth, z: z + halfDepth },
        to: { x: x + halfWidth, z: z + halfDepth },
      };
    case 'east':
      return {
        from: { x: x + halfWidth, z: z - halfDepth },
        to: { x: x + halfWidth, z: z + halfDepth },
      };
    case 'west':
      return {
        from: { x: x - halfWidth, z: z - halfDepth },
        to: { x: x - halfWidth, z: z + halfDepth },
      };
  }
}

export function createClockworkHarborEngine(
  parent: HTMLDivElement,
  bus: WorldEngineEventBus,
  options: ClockworkHarborEngineOptions = {},
): ClockworkHarborEngine {
  const lighthouseFixed = options.lighthouseFixed ?? false;

  /*
    A muted sky before the lighthouse turns, a clear one after. Section 19's
    "before" harbor is dim and stalled; this is the cheapest honest version of
    that transformation, and it costs nothing to keep once real art lands.
  */
  const { scene, camera, renderer } = createSceneBootstrap(
    parent,
    lighthouseFixed ? 0x8fc7e6 : 0x6b7f92,
    lighthouseFixed ? {} : { ambientIntensity: 0.45, sunIntensity: 0.55 },
  );

  const colliders: Box3[] = [
    ...BOUNDARY_WALLS.map((wall) => toBox3(wall)),
    ...WATER_ZONES.map((water) => toBox3(water)),
    ...MARKET_STALLS.map(
      (stall) =>
        new Box3(
          new Vector3(stall.x - stall.halfSize, 0, stall.z - stall.halfSize),
          new Vector3(stall.x + stall.halfSize, 2.2, stall.z + stall.halfSize),
        ),
    ),
    new Box3(
      new Vector3(CLOCK_TOWER.x - CLOCK_TOWER.halfSize, 0, CLOCK_TOWER.z - CLOCK_TOWER.halfSize),
      new Vector3(
        CLOCK_TOWER.x + CLOCK_TOWER.halfSize,
        CLOCK_TOWER.height,
        CLOCK_TOWER.z + CLOCK_TOWER.halfSize,
      ),
    ),
    ...lighthouseWallColliders(),
  ];

  const controller = new FirstPersonController({ colliders });
  const spawn = resolveSpawnCheckpoint(REGION_ID, options.startCheckpointId);
  controller.position.set(spawn.x, 0, spawn.z);
  controller.yaw = spawn.yaw;

  // --- Machinery placeholders (see the file header) ---

  /** The lighthouse power mechanism: a brass drum with a gear on its face. */
  const mechanism = new Object3D();
  mechanism.position.set(LIGHTHOUSE_MECHANISM.x, 0, LIGHTHOUSE_MECHANISM.z);
  const drum = new Mesh(
    new CylinderGeometry(0.6, 0.7, 1.2, 12),
    new MeshStandardMaterial({ color: IRON }),
  );
  drum.position.y = 0.6;
  const gear = new Mesh(
    new TorusGeometry(0.45, 0.12, 8, 12),
    new MeshStandardMaterial({
      color: BRASS,
      emissive: lighthouseFixed ? BRASS : 0x000000,
      emissiveIntensity: lighthouseFixed ? 0.5 : 0,
    }),
  );
  gear.position.set(0, 1.35, 0.1);
  mechanism.add(drum, gear);
  scene.add(mechanism);

  /** The lamp at the top of the tower. Dark until the harbor's first chapter is done. */
  const lamp = new Mesh(
    new CylinderGeometry(1.1, 1.1, 1.4, 12),
    new MeshStandardMaterial({
      color: lighthouseFixed ? 0xfff3c4 : 0x3a3f47,
      emissive: lighthouseFixed ? 0xffe9a8 : 0x000000,
      emissiveIntensity: lighthouseFixed ? 1.2 : 0,
    }),
  );
  lamp.position.set(LIGHTHOUSE.x, LIGHTHOUSE.height + 0.7, LIGHTHOUSE.z);
  scene.add(lamp);

  /**
   * The harbor gate. Shut across the harbor mouth until the lamp turns, then
   * swung clear - section 10's completion event, seen from inside the world.
   */
  const gate = new Mesh(
    new BoxGeometry(HARBOR_GATE.halfWidth * 2, HARBOR_GATE.height, 0.4),
    new MeshStandardMaterial({ color: IRON }),
  );
  gate.position.set(HARBOR_GATE.x, HARBOR_GATE.height / 2, HARBOR_GATE.z);
  gate.visible = !lighthouseFixed;
  scene.add(gate);
  if (!lighthouseFixed) {
    colliders.push(
      new Box3(
        new Vector3(HARBOR_GATE.x - HARBOR_GATE.halfWidth, 0, HARBOR_GATE.z - 0.3),
        new Vector3(HARBOR_GATE.x + HARBOR_GATE.halfWidth, HARBOR_GATE.height, HARBOR_GATE.z + 0.3),
      ),
    );
  }

  /** The clock tower's face, which runs backward until the Heart is repaired (section 3). */
  const clockFace = new Mesh(
    new CylinderGeometry(1.6, 1.6, 0.3, 16),
    new MeshStandardMaterial({ color: 0xf2ead6 }),
  );
  clockFace.rotation.x = Math.PI / 2;
  clockFace.position.set(
    CLOCK_TOWER.x,
    CLOCK_TOWER.height - 2,
    CLOCK_TOWER.z + CLOCK_TOWER.halfSize,
  );
  const clockHand = new Mesh(
    new BoxGeometry(0.16, 1.2, 0.1),
    new MeshStandardMaterial({ color: IRON }),
  );
  clockHand.position.set(0, 0.6, 0.2);
  const clockHandPivot = new Object3D();
  clockHandPivot.position.copy(clockFace.position);
  clockHandPivot.position.z += 0.25;
  clockHandPivot.add(clockHand);
  scene.add(clockFace, clockHandPivot);

  // Golden gears: small spinning collectibles, one `CollectiblePickedUp` each.
  const goldenGears = new Map<string, Object3D>();
  for (const spot of GOLDEN_GEAR_SPOTS) {
    const gearMesh = new Mesh(
      new TorusGeometry(0.22, 0.07, 8, 12),
      new MeshStandardMaterial({ color: BRASS, emissive: BRASS, emissiveIntensity: 0.35 }),
    );
    gearMesh.position.set(spot.x, spot.y, spot.z);
    scene.add(gearMesh);
    goldenGears.set(spot.id, gearMesh);
  }

  // NPC placeholders, swapped for real assets once they resolve.
  const npcMeshes = new Map<string, Object3D>();
  const npcMixers: AnimationMixer[] = [];
  for (const npc of NPC_SPOTS) {
    const placeholder = new Mesh(
      new BoxGeometry(0.4, 0.6, 0.2),
      new MeshStandardMaterial({ color: npc.id === 'harbor-master' ? VERDIGRIS : 0x8a5a3c }),
    );
    placeholder.position.set(npc.x, 0, npc.z);
    scene.add(placeholder);
    npcMeshes.set(npc.id, placeholder);
  }

  async function loadWorldContent(): Promise<void> {
    // Ground: a grid of ground-tile.gltf covering the walkable plot exactly.
    const tileSize = 4;
    const tilesPerSide = (GROUND_HALF_EXTENT * 2) / tileSize;
    const groundTiles = Array.from({ length: tilesPerSide * tilesPerSide }, (_, index) => {
      const ix = index % tilesPerSide;
      const iz = Math.floor(index / tilesPerSide);
      return {
        position: {
          x: -GROUND_HALF_EXTENT + tileSize / 2 + ix * tileSize,
          y: 0,
          z: -GROUND_HALF_EXTENT + tileSize / 2 + iz * tileSize,
        },
      };
    });

    // The lighthouse's built sides, tiled and instanced together.
    const heightScale = LIGHTHOUSE.height / WALL_HEIGHT;
    const wallRuns = LIGHTHOUSE.wallSides.flatMap((side) => {
      const run = lighthouseWallRun(side);
      return runPlacements(run.from, run.to, WALL_PANEL_WIDTH_METERS).map((placement) => ({
        ...placement,
        scale: { y: heightScale },
      }));
    });

    // Market stalls and the clock tower, from the same stone wall kit piece.
    const stallPlacements = MARKET_STALLS.map((stall) => ({
      position: { x: stall.x, y: 0, z: stall.z },
      scale: { x: stall.halfSize, y: 0.7, z: stall.halfSize },
    }));

    const [ground, walls, roof, door, stalls] = await Promise.all([
      createInstancedMeshFromAsset('ground-tile', groundTiles),
      createInstancedMeshFromAsset('wall-stone', wallRuns),
      createInstancedMeshFromAsset('roof', [
        {
          position: { x: LIGHTHOUSE.x, y: LIGHTHOUSE.height, z: LIGHTHOUSE.z },
          rotationY: Math.PI / 4,
          scale: { x: 3.4, y: 1, z: 3.4 },
        },
      ]),
      createInstancedMeshFromAsset('door', [
        { position: { x: LIGHTHOUSE.x + LIGHTHOUSE.halfWidth, y: 0, z: LIGHTHOUSE.z } },
      ]),
      createInstancedMeshFromAsset('wall-stone', stallPlacements),
    ]);
    scene.add(ground, walls, roof, door, stalls);

    // Crates and barrels along the dock, instanced into one draw call.
    await placeKitCluster(
      scene,
      'rock',
      DOCK_CLUTTER.map((crate, index) => ({ x: crate.x, z: crate.z, rotationY: index * 0.7 })),
    );

    // The Harbor Master and Professor Ticktock reuse the existing character
    // asset until section 21's own cast is authored.
    for (const npc of NPC_SPOTS) {
      const asset = await loadAsset('npc-pip');
      const npcScene = asset.scene.clone(true);
      npcScene.position.set(npc.x, 0, npc.z);
      npcScene.name = npc.label;
      scene.add(npcScene);
      const placeholder = npcMeshes.get(npc.id);
      if (placeholder) placeholder.visible = false;
      npcMeshes.set(npc.id, npcScene);
      const idle = asset.animations.find((clip) => clip.name === 'Idle');
      if (idle) {
        const mixer = new AnimationMixer(npcScene);
        mixer.clipAction(idle).play();
        npcMixers.push(mixer);
      }
    }
  }

  void loadWorldContent();

  /*
    Harbor water, at the mouth where the gulls loop.

    Sits just *above* the ground tiles (y = 0.02), not below them. The ground
    kit tiles the whole plot with opaque geometry at y = 0, so water authored
    underneath it renders as nothing at all - which left the harbor reading as
    flat brown ground that a child then walked into an invisible wall on,
    because `WATER_ZONES` are colliders. Found by looking at the region rather
    than by a test: every geometry invariant still passed, since the numbers
    were right and only the draw order was wrong.

    Floating the sheet on top is the fix that cannot leave a hole. Punching the
    ground tiles out under each zone would need the 4m tile grid to line up
    with the water rects, and it does not.
  */
  for (const water of WATER_ZONES) {
    const plane = new Mesh(
      new PlaneGeometry(water.maxX - water.minX, water.maxZ - water.minZ),
      new MeshStandardMaterial({ color: 0x2f6f9e, side: DoubleSide }),
    );
    plane.rotation.x = -Math.PI / 2;
    plane.position.set((water.minX + water.maxX) / 2, 0.02, (water.minZ + water.maxZ) / 2);
    scene.add(plane);
  }

  /*
    The dock deck itself. `DOCK_DECK` was authored as a walkable rect and
    tested as one (the "deck is clear of the water colliders" invariant), but
    nothing ever drew it - so "the docks" was an empty patch of ground between
    two now-visible stretches of water. Raised a little above the waterline so
    it reads as a pier rather than a puddle.
  */
  const deck = new Mesh(
    new BoxGeometry(DOCK_DECK.maxX - DOCK_DECK.minX, 0.18, DOCK_DECK.maxZ - DOCK_DECK.minZ),
    new MeshStandardMaterial({ color: 0x8a6a45 }),
  );
  deck.position.set(
    (DOCK_DECK.minX + DOCK_DECK.maxX) / 2,
    0.09,
    (DOCK_DECK.minZ + DOCK_DECK.maxZ) / 2,
  );
  scene.add(deck);

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

  const raycaster = new Raycaster();
  raycaster.far = RAYCAST_RANGE_METERS;

  function raycastFocus(): string | null {
    raycaster.setFromCamera(new Vector2(0, 0), camera);
    for (const [id, mesh] of npcMeshes) {
      if (!mesh.visible) continue;
      if (raycaster.intersectObject(mesh, true).length > 0) return id;
    }
    if (raycaster.intersectObject(mechanism, true).length > 0) return LIGHTHOUSE_MECHANISM.id;
    for (const [id, mesh] of goldenGears) {
      if (raycaster.intersectObject(mesh, true).length > 0) return id;
    }
    return null;
  }

  function interact(): void {
    const focused = raycastFocus();
    if (!focused) return;

    const gearMesh = goldenGears.get(focused);
    if (gearMesh) {
      bus.emit('ObjectInteracted', { entityId: focused, interactionId: `${focused}:collect` });
      bus.emit('CollectiblePickedUp', { entityId: focused });
      scene.remove(gearMesh);
      goldenGears.delete(focused);
      return;
    }

    if (focused === LIGHTHOUSE_MECHANISM.id) {
      /*
        The scene asks for the challenge; it never grades one. `gradeChallenge`
        in `src/features/challenges/engine.ts` decides correctness, and the
        view records the world change - so a client that forged this event
        still cannot repair the lighthouse.
      */
      bus.emit('ObjectInteracted', { entityId: focused, interactionId: `${focused}:use` });
      return;
    }

    bus.emit('ObjectInteracted', { entityId: focused, interactionId: `${focused}:talk` });
  }

  const pointerControls = attachPointerControls(renderer, controller, { onInteract: interact });

  const checkpointZones = CLOCKWORK_HARBOR_REGION_CHECKPOINTS.map((checkpoint) => ({
    id: checkpoint.id,
    zone: new Box3(
      new Vector3(checkpoint.x - 1.5, -1, checkpoint.z - 1.5),
      new Vector3(checkpoint.x + 1.5, 3, checkpoint.z + 1.5),
    ),
    wasInside: false,
  }));
  const districtZones = DISTRICT_ZONES.map((zone) => ({
    id: zone.id,
    zone: toBox3(zone, -1, 12),
    wasInside: false,
  }));
  const npcApproach = NPC_SPOTS.map((npc) => ({
    id: npc.id,
    position: new Vector3(npc.x, 0, npc.z),
    wasNear: false,
  }));

  let wasFocused: string | null = null;
  let gullT = 0;
  const clock = new Clock();
  const gullSpeed = 0.05;

  function frame(): void {
    const delta = Math.min(clock.getDelta(), 0.1);

    pointerControls.update(delta);

    camera.position.set(controller.position.x, EYE_HEIGHT, controller.position.z);
    // See sandboxScene.ts for why +PI: the controller's forward axis is the
    // opposite of a Three.js camera's default forward at yaw 0.
    camera.rotation.y = controller.yaw + Math.PI;
    camera.rotation.x = controller.pitch;

    for (const mixer of npcMixers) mixer.update(delta);

    // The gear turns only once the machine runs; before that the harbor is still.
    if (lighthouseFixed) gear.rotation.z += delta * 1.4;
    // The clock hand runs backward until the Heart of the Harbor is repaired
    // (section 3's symptom list). Forward once it is - but that is section 18's
    // finale, so for now it always runs backward.
    clockHandPivot.rotation.z += delta * 0.35;

    for (const gearMesh of goldenGears.values()) gearMesh.rotation.z += delta * 1.1;

    gullT = (gullT + delta * gullSpeed) % 1;
    gull.position.copy(gullPath.getPointAt(gullT));
    gull.lookAt(gullPath.getPointAt((gullT + 0.01) % 1));

    for (const npc of npcApproach) {
      const nearNow = isInRange(controller.position, npc.position, APPROACH_RANGE_METERS);
      if (hasApproached(controller.position, npc.position, APPROACH_RANGE_METERS, npc.wasNear)) {
        bus.emit('NpcApproached', { entityId: npc.id });
      }
      npc.wasNear = nearNow;
    }

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
    for (const district of districtZones) {
      const insideNow = isInsideZone(controller.position, district.zone);
      if (insideNow && !district.wasInside) {
        bus.emit('PlayerEnteredZone', { zoneId: district.id });
      }
      district.wasInside = insideNow;
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
