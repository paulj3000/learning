import {
  AmbientLight,
  Box3,
  BoxGeometry,
  Clock,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  Scene,
  TorusGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { resolveSpawnCheckpoint } from '../../discovery/checkpoints';
import type { ThreeEngineHandle } from './ThreeGameContainer';
import { FirstPersonController } from './firstPersonController';
import { attachPointerControls } from './pointerControls';
import { loadPlaceholderNpc } from './placeholderNpcGltf';
import { hasApproached, isInRange, isInsideZone } from './sandboxTriggers';
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
  GROUND_HALF_EXTENT_X,
  GROUND_HALF_EXTENT_Z,
  HARBOR_EXIT_ZONE,
  NPC_ID,
  NPC_SPOT,
  REGION_ID,
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

const APPROACH_RANGE_METERS = 2.5;
const RAYCAST_RANGE_METERS = 4;
const EYE_HEIGHT = 1.6;
const WALL_HEIGHT = 3;

function toBox3(zone: RectZone, minY = -1, maxY = WALL_HEIGHT): Box3 {
  return new Box3(new Vector3(zone.minX, minY, zone.minZ), new Vector3(zone.maxX, maxY, zone.maxZ));
}

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
 * Pirate Builder Bay's Phase 33 first-person region (`docs/ROADMAP.md`
 * Phase 33: "Re-implements 'Repair the Moonlight Bridge' (Phase 11) in
 * first person"). Built the same way `welcomeHarborScene.ts` was at Phase
 * 32: on top of the Phase 31 sandbox's proven pieces
 * (`firstPersonController.ts`, `pointerControls.ts`, `sandboxTriggers.ts`,
 * `placeholderNpcGltf.ts`), with this region's own geometry
 * (`pirateBuilderBayRegion.ts`).
 *
 * The one thing this region does that Welcome Harbor's does not: build a
 * genuinely different bridge mesh and collider set depending on
 * `bridgeRepaired`, read once at construction time - the Three.js
 * equivalent of the Phaser scene's `tileOverrides` swap
 * (`scenes/PirateBuilderBayScene.ts`). Starting or resuming the actual
 * "Repair the Moonlight Bridge" adventure still happens on the existing
 * adventure route, not in this scene (see `PirateBuilderBayWorldView.tsx`'s
 * header comment for why); walking back into this region afterward is what
 * shows the repaired geometry.
 *
 * Rendering glue, like every existing `scenes/*.ts` Phaser scene and
 * `welcomeHarborScene.ts`: not unit tested here, since it needs a real
 * WebGL/DOM context. The geometry and ids it reads
 * (`pirateBuilderBayRegion.ts`, `discovery/checkpoints.ts`) are tested
 * independently.
 */
export function createPirateBuilderBayEngine(
  parent: HTMLDivElement,
  bus: WorldEngineEventBus,
  options: PirateBuilderBayEngineOptions,
): PirateBuilderBayEngine {
  const scene = new Scene();
  scene.background = new Color(0x9fd4ec);

  const camera = new PerspectiveCamera(70, parent.clientWidth / parent.clientHeight, 0.1, 150);
  camera.rotation.order = 'YXZ';

  const renderer = new WebGLRenderer({ antialias: true });
  renderer.setSize(parent.clientWidth, parent.clientHeight);
  parent.appendChild(renderer.domElement);

  scene.add(new AmbientLight(0xffffff, 0.65));
  const sun = new DirectionalLight(0xffffff, 0.8);
  sun.position.set(8, 14, 6);
  scene.add(sun);

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

  // The bridge itself: an actual geometry/collider difference between
  // broken and repaired, read once here, per this file's header comment.
  const plankGeometry = new BoxGeometry(0.9, 0.15, BRIDGE_MAX_Z - BRIDGE_MIN_Z);
  if (options.bridgeRepaired) {
    const repairedMaterial = new MeshStandardMaterial({ color: 0xcaa768, emissive: 0x332711 });
    const deck = new Mesh(
      new BoxGeometry(CHANNEL_MAX_X - CHANNEL_MIN_X, 0.15, BRIDGE_MAX_Z - BRIDGE_MIN_Z),
      repairedMaterial,
    );
    deck.position.set(0, 0, 0);
    scene.add(deck);
    // No collider over the deck span: it is a real doorway across the channel now.
  } else {
    const brokenMaterial = new MeshStandardMaterial({ color: 0x8a6a45 });
    // Two short plank stubs at each bank, with a visible gap over the water
    // between them - the "damaged bridge" the child sees before repairing it.
    const westStub = new Mesh(plankGeometry, brokenMaterial);
    westStub.position.set(CHANNEL_MIN_X + 0.6, 0, 0);
    scene.add(westStub);
    const eastStub = new Mesh(plankGeometry, brokenMaterial);
    eastStub.position.set(CHANNEL_MAX_X - 0.6, 0, 0);
    scene.add(eastStub);
    // One fallen plank, tilted into the gap, for visible damage flavor.
    const fallenPlank = new Mesh(plankGeometry, brokenMaterial);
    fallenPlank.position.set(0.4, -0.4, 0.6);
    fallenPlank.rotation.set(0.9, 0.3, 0.4);
    scene.add(fallenPlank);
    colliders.push(toBox3(BRIDGE_SPAN, -1, 4));
  }

  const controller = new FirstPersonController({ colliders });

  const spawn = resolveSpawnCheckpoint(REGION_ID, options.startCheckpointId);
  controller.position.set(spawn.x, 0, spawn.z);
  controller.yaw = spawn.yaw;

  // Pip, reusing the same placeholder GLB and animation every other region exercises.
  const npcPlaceholder = new Mesh(
    new BoxGeometry(0.4, 0.6, 0.2),
    new MeshStandardMaterial({ color: 0x2f8f4e }),
  );
  npcPlaceholder.position.set(NPC_SPOT.x, 0, NPC_SPOT.z);
  scene.add(npcPlaceholder);
  let npcMesh: Object3D = npcPlaceholder;
  void loadPlaceholderNpc().then(({ scene: npcScene }) => {
    npcScene.position.set(NPC_SPOT.x, 0, NPC_SPOT.z);
    npcScene.name = 'Pip';
    scene.add(npcScene);
    npcPlaceholder.visible = false;
    npcMesh = npcScene;
  });

  // Materials, placeholder primitives (real art is Phase 34's job).
  const ropeCoil = new Mesh(
    new TorusGeometry(0.25, 0.08, 8, 20),
    new MeshStandardMaterial({ color: 0xb0793a }),
  );
  ropeCoil.rotation.x = Math.PI / 2;
  ropeCoil.position.set(ROPE_COIL_SPOT.x, 0.1, ROPE_COIL_SPOT.z);
  scene.add(ropeCoil);

  const toolbox = new Mesh(
    new BoxGeometry(0.5, 0.3, 0.3),
    new MeshStandardMaterial({ color: 0x555f6b }),
  );
  toolbox.position.set(TOOLBOX_SPOT.x, 0.15, TOOLBOX_SPOT.z);
  scene.add(toolbox);

  const treasureChest = new Mesh(
    new BoxGeometry(0.6, 0.4, 0.4),
    new MeshStandardMaterial({ color: 0xd4a63a }),
  );
  treasureChest.position.set(TREASURE_SPOT.x, 0.2, TREASURE_SPOT.z);
  scene.add(treasureChest);

  // A signpost marking the harbor exit, and a dark opening marking the tide
  // tunnel - purely visual markers, never raycast-interactive; both are
  // approach-triggered zones.
  const signpost = new Mesh(
    new ConeGeometry(0.3, 1.2, 4),
    new MeshStandardMaterial({ color: 0x6b4a34 }),
  );
  signpost.position.set(
    (HARBOR_EXIT_ZONE.minX + HARBOR_EXIT_ZONE.maxX) / 2,
    0.6,
    (HARBOR_EXIT_ZONE.minZ + HARBOR_EXIT_ZONE.maxZ) / 2,
  );
  scene.add(signpost);

  const tunnelMouth = new Mesh(
    new CylinderGeometry(0.9, 0.9, 0.4, 12, 1, true),
    new MeshStandardMaterial({ color: 0x1c1c1c, side: DoubleSide }),
  );
  tunnelMouth.rotation.z = Math.PI / 2;
  tunnelMouth.position.set(
    (TIDE_TUNNEL_ZONE.minX + TIDE_TUNNEL_ZONE.maxX) / 2,
    0.5,
    (TIDE_TUNNEL_ZONE.minZ + TIDE_TUNNEL_ZONE.maxZ) / 2,
  );
  scene.add(tunnelMouth);

  const raycastTargets: readonly { entityId: string; mesh: () => Object3D }[] = [
    { entityId: NPC_ID, mesh: () => npcMesh },
    { entityId: ROPE_COIL_ID, mesh: () => ropeCoil },
    { entityId: TOOLBOX_ID, mesh: () => toolbox },
    { entityId: TREASURE_ID, mesh: () => treasureChest },
  ];

  const raycaster = new Raycaster();
  raycaster.far = RAYCAST_RANGE_METERS;

  function raycastFocus(): string | null {
    raycaster.setFromCamera(new Vector2(0, 0), camera);
    let closestId: string | null = null;
    let closestDistance = Infinity;
    for (const target of raycastTargets) {
      const hits = raycaster.intersectObject(target.mesh(), true);
      if (hits.length > 0 && hits[0].distance < closestDistance) {
        closestDistance = hits[0].distance;
        closestId = target.entityId;
      }
    }
    return closestId;
  }

  function interact(): void {
    const focused = raycastFocus();
    if (focused) {
      bus.emit('ObjectInteracted', { entityId: focused, interactionId: `${focused}:interact` });
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
