import {
  AnimationMixer,
  Box3,
  BoxGeometry,
  CatmullRomCurve3,
  Clock,
  ConeGeometry,
  CylinderGeometry,
  IcosahedronGeometry,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PointLight,
  Raycaster,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
} from 'three';
import { resolveSpawnCheckpoint } from '../../discovery/checkpoints';
import { createInstancedMeshFromAsset, loadAsset } from './assets/assetLoader';
import {
  AMBIENT_DRAGON_PATH,
  AREA_ZONES,
  BOUNDARY_WALLS,
  buildingWallColliders,
  DRAGON_SCALE_SPOTS,
  DRAGONS_SANCTUARY_REGION_CHECKPOINTS,
  EMBER_ID,
  FIRE_RUNE_SPOTS,
  FORGE,
  FORGE_HEARTH,
  GROUND_HALF_EXTENT,
  KEEPER_LODGE,
  NPC_SPOTS,
  REGION_ID,
  ROOST_STONES,
  RUNE_SOCKET_SPOTS,
  SEALED_GATES,
  SKY_CLIFFS,
  VALLEY_BOULDERS,
  WALL_HALF_THICKNESS,
  type Building,
  type WallSide,
} from './dragonsSanctuaryRegion';
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
 * The Dragon's Sanctuary's first-person scene
 * (`docs/regions/dragons-sanctuary-roadmap.md` Phases 1 and 2).
 *
 * Rendering glue, like `clockworkHarborScene.ts` and `welcomeHarborScene.ts`
 * before it: not unit tested here, because it needs a real WebGL/DOM context.
 * What it *reads* is tested independently - the geometry and ids in
 * `dragonsSanctuaryRegion.ts`, the checkpoint vocabulary in
 * `discovery/checkpoints.ts`, and the asset pipeline in `assets/*.ts` and
 * `sceneKit.ts`.
 *
 * ## Placeholders, and what they are placeholders for
 *
 * The roadmap's "Initial Asset List" names a sanctuary gate, a forge, roosts,
 * a lodge, cliffs, crystals, rune stones and a rigged Ember with thirteen
 * animation clips. None of that exists in `assets/manifest.ts`, so everything
 * distinctive here is drawn from `three` primitives and clearly marked. Every
 * one of them is a placeholder for an authored GLB, and **none carries game
 * state**: the ids they answer to come from the region module, so swapping in
 * real art changes no logic. Ember in particular is a cone and two spheres
 * standing where a dragon goes, and no amount of lighting will make her
 * anything else until the rig lands (ADR-020).
 *
 * ## The scene renders state, it never decides it
 *
 * `forgeLit` arrives as an option rather than being read here, per ADR-008:
 * the World Engine must not reach into World State. Phase 9's restoration
 * ladder is meant to work exactly this way - the renderer reads a flag and
 * changes models, lighting and interactions accordingly, rather than the
 * region owning a second copy of the scene for each stage.
 */

/** Basalt, ember and old bronze: the sanctuary's palette, so placeholders read as one place. */
const BASALT = 0x4a4048;
const EMBER_ORANGE = 0xd9622b;
const OLD_BRONZE = 0x9c7a3c;
const SCALE_GREEN = 0x3f8f6b;
const CRYSTAL_BLUE = 0x5fb8d9;

const WALL_PANEL_WIDTH_METERS = 2;

export interface DragonsSanctuaryEngine extends ThreeEngineHandle {
  /** Raycasts from the camera center and fires the matching event, if anything interactive is in range. */
  interact(): void;
}

export interface DragonsSanctuaryEngineOptions {
  /** The child's last saved checkpoint id (`ChildWorldState.lastCheckpointId`), if any. */
  startCheckpointId?: string;
  /**
   * Whether Rekindle the Forge has been completed.
   *
   * Phase 2's persistent result, seen from inside the world: a child who lit
   * the forge last visit walks back into a valley where it is still burning,
   * the lighting has warmed, and Ember has moved onto her restored roost -
   * with no menu to check. Passed in rather than read here (ADR-008).
   */
  forgeLit?: boolean;
  /**
   * Which fire runes the child has already found, by prop id. Found runes are
   * gone from the valley and set in their sockets instead, so a returning
   * child sees their own progress in the room rather than in a counter.
   */
  foundRuneIds?: readonly string[];
}

/** One wall run of a building, as the two endpoints the kit tiles between. */
function buildingWallRun(building: Building, side: WallSide) {
  const { x, z, halfWidth, halfDepth } = building;
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

export function createDragonsSanctuaryEngine(
  parent: HTMLDivElement,
  bus: WorldEngineEventBus,
  options: DragonsSanctuaryEngineOptions = {},
): DragonsSanctuaryEngine {
  const forgeLit = options.forgeLit ?? false;
  const foundRuneIds = new Set(options.foundRuneIds ?? []);

  /*
    A cold, overcast valley before the forge is lit; a warm one after. The
    cheapest honest version of Phase 9's Stage 0 -> Stage 1 transition, and it
    costs nothing to keep once real art lands.
  */
  const { scene, camera, renderer } = createSceneBootstrap(
    parent,
    forgeLit ? 0xe8b98a : 0x6a6472,
    forgeLit
      ? { ambientIntensity: 0.75, sunIntensity: 0.9 }
      : { ambientIntensity: 0.4, sunIntensity: 0.5 },
  );

  const colliders: Box3[] = [
    ...BOUNDARY_WALLS.map((wall) => toBox3(wall, -1, 14)),
    ...buildingWallColliders(KEEPER_LODGE).map((wall) => toBox3(wall, 0, KEEPER_LODGE.height)),
    ...buildingWallColliders(FORGE).map((wall) => toBox3(wall, 0, FORGE.height)),
    ...ROOST_STONES.map(
      (stone) =>
        new Box3(
          new Vector3(stone.x - stone.halfSize, 0, stone.z - stone.halfSize),
          new Vector3(stone.x + stone.halfSize, 1.6, stone.z + stone.halfSize),
        ),
    ),
    ...VALLEY_BOULDERS.map(
      (boulder) =>
        new Box3(
          new Vector3(boulder.x - boulder.halfSize, 0, boulder.z - boulder.halfSize),
          new Vector3(boulder.x + boulder.halfSize, 2.4, boulder.z + boulder.halfSize),
        ),
    ),
    ...SEALED_GATES.map(
      (gate) =>
        new Box3(
          new Vector3(gate.x - gate.halfWidth, 0, gate.z - WALL_HALF_THICKNESS),
          new Vector3(gate.x + gate.halfWidth, gate.height, gate.z + WALL_HALF_THICKNESS),
        ),
    ),
  ];

  const controller = new FirstPersonController({ colliders });
  const spawn = resolveSpawnCheckpoint(REGION_ID, options.startCheckpointId);
  controller.position.set(spawn.x, 0, spawn.z);
  controller.yaw = spawn.yaw;

  // --- Placeholders (see the file header) ---

  /**
   * The forge hearth: a basalt block with a fire bowl on top. The bowl is the
   * whole region's status light - dark and cold, or burning.
   */
  const hearth = new Object3D();
  hearth.position.set(FORGE_HEARTH.x, 0, FORGE_HEARTH.z);
  const hearthBlock = new Mesh(
    new BoxGeometry(1.6, 1.1, 1.6),
    new MeshStandardMaterial({ color: BASALT }),
  );
  hearthBlock.position.y = 0.55;
  const fireBowl = new Mesh(
    new CylinderGeometry(0.7, 0.45, 0.5, 12),
    new MeshStandardMaterial({
      color: forgeLit ? EMBER_ORANGE : 0x2e2a30,
      emissive: forgeLit ? EMBER_ORANGE : 0x000000,
      emissiveIntensity: forgeLit ? 1.4 : 0,
    }),
  );
  fireBowl.position.y = 1.35;
  hearth.add(hearthBlock, fireBowl);
  scene.add(hearth);

  /** Firelight, so lighting the forge changes the room and not just one mesh. */
  if (forgeLit) {
    const firelight = new PointLight(0xffb066, 2.2, 18);
    firelight.position.set(FORGE_HEARTH.x, 2.2, FORGE_HEARTH.z);
    scene.add(firelight);
  }

  /**
   * The three rune sockets on the hearth wall. A socket holding a rune the
   * child has found glows; an empty one does not. This is the child's own
   * progress, shown in the room rather than in a counter.
   */
  const socketMeshes: Mesh[] = RUNE_SOCKET_SPOTS.map((socket, index) => {
    const runeId = FIRE_RUNE_SPOTS[index]?.id;
    const filled = runeId !== undefined && (foundRuneIds.has(runeId) || forgeLit);
    const mesh = new Mesh(
      new TorusGeometry(0.28, 0.08, 8, 14),
      new MeshStandardMaterial({
        color: filled ? EMBER_ORANGE : BASALT,
        emissive: filled ? EMBER_ORANGE : 0x000000,
        emissiveIntensity: filled ? 0.8 : 0,
      }),
    );
    mesh.position.set(socket.x, 1.5, socket.z);
    scene.add(mesh);
    return mesh;
  });

  /**
   * The fire runes still out in the valley. A rune the child has already found
   * is not drawn at all - it is in its socket, and drawing it in both places
   * would tell them their progress had not been kept.
   */
  const runeMeshes = new Map<string, Object3D>();
  for (const rune of FIRE_RUNE_SPOTS) {
    if (foundRuneIds.has(rune.id) || forgeLit) continue;
    const stone = new Mesh(
      new BoxGeometry(0.45, 0.9, 0.2),
      new MeshStandardMaterial({ color: BASALT }),
    );
    stone.position.y = 0.45;
    const glyph = new Mesh(
      new TorusGeometry(0.16, 0.05, 6, 12),
      new MeshStandardMaterial({
        color: EMBER_ORANGE,
        emissive: EMBER_ORANGE,
        emissiveIntensity: 0.7,
      }),
    );
    glyph.position.set(0, 0.55, 0.13);
    const group = new Object3D();
    group.position.set(rune.x, 0, rune.z);
    group.add(stone, glyph);
    scene.add(group);
    runeMeshes.set(rune.id, group);
  }

  /**
   * The two sealed gates. Solid slabs across their valleys, with a seam of
   * light at the crack so a child can see there is somewhere behind them.
   */
  const gateMeshes = new Map<string, Object3D>();
  for (const gate of SEALED_GATES) {
    const slab = new Mesh(
      new BoxGeometry(gate.halfWidth * 2, gate.height, WALL_HALF_THICKNESS * 2),
      new MeshStandardMaterial({ color: BASALT }),
    );
    slab.position.set(gate.x, gate.height / 2, gate.z);
    const seam = new Mesh(
      new BoxGeometry(0.12, gate.height * 0.7, 0.05),
      new MeshStandardMaterial({
        color: gate.id.includes('crystal') ? CRYSTAL_BLUE : EMBER_ORANGE,
        emissive: gate.id.includes('crystal') ? CRYSTAL_BLUE : EMBER_ORANGE,
        emissiveIntensity: 0.6,
      }),
    );
    seam.position.set(gate.x, gate.height / 2, gate.z + WALL_HALF_THICKNESS + 0.03);
    scene.add(slab, seam);
    gateMeshes.set(gate.id, slab);
  }

  /** Dragon scales: small collectibles, one `CollectiblePickedUp` each. */
  const dragonScales = new Map<string, Object3D>();
  for (const spot of DRAGON_SCALE_SPOTS) {
    const scaleMesh = new Mesh(
      new IcosahedronGeometry(0.22, 0),
      new MeshStandardMaterial({
        color: SCALE_GREEN,
        emissive: SCALE_GREEN,
        emissiveIntensity: 0.3,
      }),
    );
    scaleMesh.position.set(spot.x, spot.y, spot.z);
    scene.add(scaleMesh);
    dragonScales.set(spot.id, scaleMesh);
  }

  /**
   * Ember: a cone body, a sphere head, and two folded wings, at the scale a
   * dragon would be so the roost is sized for the real asset. See the file
   * header - this is a stand-in, not a style.
   */
  const npcMeshes = new Map<string, Object3D>();
  const npcMixers: AnimationMixer[] = [];
  const ember = new Object3D();
  {
    const emberSpot = NPC_SPOTS.find((npc) => npc.id === EMBER_ID);
    ember.position.set(emberSpot?.x ?? 0, 0, emberSpot?.z ?? 0);
    const body = new Mesh(
      new ConeGeometry(1.1, 2.6, 8),
      new MeshStandardMaterial({ color: EMBER_ORANGE }),
    );
    body.position.y = 1.3;
    const head = new Mesh(
      new SphereGeometry(0.55, 10, 8),
      new MeshStandardMaterial({ color: EMBER_ORANGE }),
    );
    head.position.set(0, 2.7, 0.5);
    for (const side of [-1, 1]) {
      const wing = new Mesh(
        new BoxGeometry(0.15, 1.4, 1.1),
        new MeshStandardMaterial({ color: OLD_BRONZE }),
      );
      wing.position.set(side * 0.95, 1.7, -0.2);
      wing.rotation.z = side * 0.25;
      ember.add(wing);
    }
    ember.add(body, head);
    scene.add(ember);
    npcMeshes.set(EMBER_ID, ember);
  }

  /** The valley walls: a ring of rock faces just inside the boundary colliders. */
  for (const wall of BOUNDARY_WALLS) {
    const face = new Mesh(
      new BoxGeometry(Math.max(wall.maxX - wall.minX, 1), 14, Math.max(wall.maxZ - wall.minZ, 1)),
      new MeshStandardMaterial({ color: BASALT }),
    );
    face.position.set((wall.minX + wall.maxX) / 2, 7, (wall.minZ + wall.maxZ) / 2);
    scene.add(face);
  }

  /**
   * The Sky Cliffs, out beyond the north wall. Deliberately drawn and
   * deliberately unreachable: Phase 1 calls them "Distant", and the honest way
   * to show a place a child cannot go is to put it past the wall rather than
   * behind a door that never opens.
   */
  for (const cliff of SKY_CLIFFS) {
    const rock = new Mesh(
      new ConeGeometry(cliff.halfWidth, cliff.height, 6),
      new MeshStandardMaterial({ color: 0x5b5566 }),
    );
    rock.position.set(cliff.x, cliff.height / 2, cliff.z);
    scene.add(rock);
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

    // Both buildings' built sides, tiled and instanced into one draw call.
    const wallRuns = [KEEPER_LODGE, FORGE].flatMap((building) => {
      const heightScale = building.height / WALL_HEIGHT;
      return building.wallSides.flatMap((side) => {
        const run = buildingWallRun(building, side);
        return runPlacements(run.from, run.to, WALL_PANEL_WIDTH_METERS).map((placement) => ({
          ...placement,
          scale: { y: heightScale },
        }));
      });
    });

    const [ground, walls, roofs] = await Promise.all([
      createInstancedMeshFromAsset('ground-tile', groundTiles),
      createInstancedMeshFromAsset('wall-stone', wallRuns),
      createInstancedMeshFromAsset(
        'roof',
        [KEEPER_LODGE, FORGE].map((building) => ({
          position: { x: building.x, y: building.height, z: building.z },
          rotationY: Math.PI / 4,
          scale: { x: 3.6, y: 1, z: 3.6 },
        })),
      ),
    ]);
    scene.add(ground, walls, roofs);

    // Roost stones and valley boulders, from the same rock kit piece.
    await placeKitCluster(
      scene,
      'rock',
      [...ROOST_STONES, ...VALLEY_BOULDERS].map((block, index) => ({
        x: block.x,
        z: block.z,
        rotationY: index * 0.9,
      })),
    );

    /*
      Ember reuses the existing character asset until the roadmap's dragon rig
      exists. The primitive dragon above stays in the scene *behind* her rather
      than being hidden: a child-sized biped standing alone in a dragon's roost
      reads as a person, not as a dragon, and the silhouette is the one thing
      the placeholder can honestly get right.
    */
    const asset = await loadAsset('npc-pip');
    const emberScene = asset.scene.clone(true);
    const emberSpot = NPC_SPOTS.find((npc) => npc.id === EMBER_ID);
    emberScene.position.set(emberSpot?.x ?? 0, 0, (emberSpot?.z ?? 0) + 1.8);
    emberScene.name = emberSpot?.label ?? 'Ember';
    scene.add(emberScene);
    const idle = asset.animations.find((clip) => clip.name === 'Idle');
    if (idle) {
      const mixer = new AnimationMixer(emberScene);
      mixer.clipAction(idle).play();
      npcMixers.push(mixer);
    }
  }

  void loadWorldContent();

  const dragonPath = new CatmullRomCurve3(
    AMBIENT_DRAGON_PATH.map((point) => new Vector3(point.x, point.y, point.z)),
    true,
  );
  const ambientDragon = new Mesh(
    new ConeGeometry(0.6, 2.2, 4),
    new MeshStandardMaterial({ color: 0x6d5f7a }),
  );
  ambientDragon.rotation.x = Math.PI / 2;
  scene.add(ambientDragon);

  const raycaster = new Raycaster();
  raycaster.far = RAYCAST_RANGE_METERS;

  function raycastFocus(): string | null {
    raycaster.setFromCamera(new Vector2(0, 0), camera);
    for (const [id, mesh] of npcMeshes) {
      if (raycaster.intersectObject(mesh, true).length > 0) return id;
    }
    if (raycaster.intersectObject(hearth, true).length > 0) return FORGE_HEARTH.id;
    for (const [id, mesh] of runeMeshes) {
      if (raycaster.intersectObject(mesh, true).length > 0) return id;
    }
    for (const [id, mesh] of gateMeshes) {
      if (raycaster.intersectObject(mesh, true).length > 0) return id;
    }
    for (const [id, mesh] of dragonScales) {
      if (raycaster.intersectObject(mesh, true).length > 0) return id;
    }
    return null;
  }

  function interact(): void {
    const focused = raycastFocus();
    if (!focused) return;

    const scaleMesh = dragonScales.get(focused);
    if (scaleMesh) {
      bus.emit('ObjectInteracted', { entityId: focused, interactionId: `${focused}:collect` });
      bus.emit('CollectiblePickedUp', { entityId: focused });
      scene.remove(scaleMesh);
      dragonScales.delete(focused);
      return;
    }

    const runeMesh = runeMeshes.get(focused);
    if (runeMesh) {
      /*
        The scene reports that the child touched a rune; it does not decide
        that they now have it. The view records the world change, and a
        client that forged this event still cannot light the forge - the
        Adventure Engine grades that, at the hearth.
      */
      bus.emit('ObjectInteracted', { entityId: focused, interactionId: `${focused}:take` });
      scene.remove(runeMesh);
      runeMeshes.delete(focused);
      return;
    }

    if (gateMeshes.has(focused)) {
      bus.emit('ObjectInteracted', { entityId: focused, interactionId: `${focused}:try` });
      return;
    }

    if (focused === FORGE_HEARTH.id) {
      bus.emit('ObjectInteracted', { entityId: focused, interactionId: `${focused}:use` });
      return;
    }

    bus.emit('ObjectInteracted', { entityId: focused, interactionId: `${focused}:talk` });
  }

  const pointerControls = attachPointerControls(renderer, controller, { onInteract: interact });

  const checkpointZones = DRAGONS_SANCTUARY_REGION_CHECKPOINTS.map((checkpoint) => ({
    id: checkpoint.id,
    zone: new Box3(
      new Vector3(checkpoint.x - 1.5, -1, checkpoint.z - 1.5),
      new Vector3(checkpoint.x + 1.5, 3, checkpoint.z + 1.5),
    ),
    wasInside: false,
  }));
  const areaZones = AREA_ZONES.map((zone) => ({
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
  let dragonT = 0;
  const clock = new Clock();

  function frame(): void {
    const delta = Math.min(clock.getDelta(), 0.1);

    pointerControls.update(delta);

    camera.position.set(controller.position.x, EYE_HEIGHT, controller.position.z);
    // See sandboxScene.ts for why +PI: the controller's forward axis is the
    // opposite of a Three.js camera's default forward at yaw 0.
    camera.rotation.y = controller.yaw + Math.PI;
    camera.rotation.x = controller.pitch;

    for (const mixer of npcMixers) mixer.update(delta);

    // The fire moves only once it is lit; before that the valley is still.
    if (forgeLit) {
      fireBowl.rotation.y += delta * 0.6;
      fireBowl.scale.setScalar(1 + Math.sin(clock.elapsedTime * 4) * 0.05);
      for (const socket of socketMeshes) socket.rotation.z += delta * 0.5;
    }

    for (const runeMesh of runeMeshes.values()) runeMesh.rotation.y += delta * 0.5;
    for (const scaleMesh of dragonScales.values()) scaleMesh.rotation.y += delta * 1.1;

    dragonT = (dragonT + delta * 0.04) % 1;
    ambientDragon.position.copy(dragonPath.getPointAt(dragonT));
    ambientDragon.lookAt(dragonPath.getPointAt((dragonT + 0.01) % 1));

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
    for (const area of areaZones) {
      const insideNow = isInsideZone(controller.position, area.zone);
      if (insideNow && !area.wasInside) {
        bus.emit('PlayerEnteredZone', { zoneId: area.id });
      }
      area.wasInside = insideNow;
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
