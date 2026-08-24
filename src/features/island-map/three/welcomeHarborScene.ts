import {
  AmbientLight,
  AnimationMixer,
  Box3,
  BoxGeometry,
  CatmullRomCurve3,
  Clock,
  Color,
  ConeGeometry,
  DirectionalLight,
  DoubleSide,
  InstancedMesh,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  Scene,
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
  AMBIENT_GULL_PATH,
  BOUNDARY_WALLS,
  BUILDINGS,
  GROUND_HALF_EXTENT,
  NPC_ID,
  NPC_SPOT,
  REGION_ID,
  SCENERY_CLUSTER,
  WELCOME_HARBOR_REGION_CHECKPOINTS,
  type RectZone,
} from './welcomeHarborRegion';
import type { WorldEngineEventBus } from './worldEngineEvents';

const APPROACH_RANGE_METERS = 2.5;
const RAYCAST_RANGE_METERS = 4;
const EYE_HEIGHT = 1.6;
const WALL_HEIGHT = 3;

function toBox3(zone: RectZone, minY = -1, maxY = WALL_HEIGHT): Box3 {
  return new Box3(new Vector3(zone.minX, minY, zone.minZ), new Vector3(zone.maxX, maxY, zone.maxZ));
}

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
 * 32: "Rebuilds Welcome Harbor ... as a polished first-person 3D space").
 * Builds on the Phase 31 sandbox's proven pieces
 * (`firstPersonController.ts`, `sandboxTriggers.ts`, `placeholderNpcGltf.ts`,
 * `pointerControls.ts`) rather than inventing new ones, and adds what the
 * sandbox deliberately left out: enterable buildings, checkpoint-based
 * spawning, an ambient animated creature, and instanced scenery.
 *
 * Rendering glue, like every existing `scenes/*.ts` Phaser scene and
 * `sandboxScene.ts`: not unit tested here, since it needs a real
 * WebGL/DOM context. The geometry and ids it reads
 * (`welcomeHarborRegion.ts`, `discovery/checkpoints.ts`) are tested
 * independently.
 */
export function createWelcomeHarborEngine(
  parent: HTMLDivElement,
  bus: WorldEngineEventBus,
  options: WelcomeHarborEngineOptions = {},
): WelcomeHarborEngine {
  const scene = new Scene();
  scene.background = new Color(0x8fc7e6);

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
    new PlaneGeometry(GROUND_HALF_EXTENT * 2, GROUND_HALF_EXTENT * 2),
    new MeshStandardMaterial({ color: 0xd8c48a }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  // The water at the region's south edge, where the ambient gull loops.
  const water = new Mesh(
    new PlaneGeometry(GROUND_HALF_EXTENT * 2, 8),
    new MeshStandardMaterial({ color: 0x2f6f9e, side: DoubleSide }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, -0.05, GROUND_HALF_EXTENT - 4);
  scene.add(water);

  // Boundary + building wall colliders, one Box3 per wall segment. Each
  // building's missing side (its `wallSides` omission) has no collider, so
  // it is a real doorway the child walks through, not a solid box with a
  // decal on it.
  const colliders: Box3[] = [...BOUNDARY_WALLS.map((wall) => toBox3(wall))];
  const buildingMaterial = new MeshStandardMaterial({ color: 0x9c7a54 });
  const roofMaterial = new MeshStandardMaterial({ color: 0x6b4a34 });
  for (const building of BUILDINGS) {
    colliders.push(...buildingWallColliders(building));

    for (const side of building.wallSides) {
      const wallWidth =
        side === 'north' || side === 'south' ? building.halfWidth * 2 : building.halfDepth * 2;
      const wallMesh = new Mesh(new PlaneGeometry(wallWidth, building.height), buildingMaterial);
      wallMesh.position.set(building.x, building.height / 2, building.z);
      if (side === 'north') {
        wallMesh.position.z -= building.halfDepth;
      } else if (side === 'south') {
        wallMesh.position.z += building.halfDepth;
        wallMesh.rotation.y = Math.PI;
      } else if (side === 'east') {
        wallMesh.position.x += building.halfWidth;
        wallMesh.rotation.y = -Math.PI / 2;
      } else {
        wallMesh.position.x -= building.halfWidth;
        wallMesh.rotation.y = Math.PI / 2;
      }
      scene.add(wallMesh);
    }

    const roof = new Mesh(
      new ConeGeometry(Math.max(building.halfWidth, building.halfDepth) * 1.3, 1.4, 4),
      roofMaterial,
    );
    roof.position.set(building.x, building.height + 0.7, building.z);
    roof.rotation.y = Math.PI / 4;
    scene.add(roof);
  }

  const controller = new FirstPersonController({ colliders });

  const spawn = resolveSpawnCheckpoint(REGION_ID, options.startCheckpointId);
  controller.position.set(spawn.x, 0, spawn.z);
  controller.yaw = spawn.yaw;

  // Instanced crate cluster (roadmap performance-budget deliverable:
  // "instancing for repeated scenery") — one draw call for every crate
  // rather than one `Mesh` per crate.
  const crateGeometry = new BoxGeometry(0.6, 0.6, 0.6);
  const crateMaterial = new MeshStandardMaterial({ color: 0x8a5a34 });
  const crates = new InstancedMesh(crateGeometry, crateMaterial, SCENERY_CLUSTER.length);
  const crateTransform = new Object3D();
  SCENERY_CLUSTER.forEach((position, index) => {
    crateTransform.position.set(position.x, 0.3, position.z);
    crateTransform.rotation.y = index * 0.6;
    crateTransform.updateMatrix();
    crates.setMatrixAt(index, crateTransform.matrix);
  });
  crates.instanceMatrix.needsUpdate = true;
  scene.add(crates);

  // Pip, reusing the same placeholder GLB and animation the Phase 31
  // sandbox exercises — the same character, now placed in a real region.
  const npcPlaceholder = new Mesh(
    new BoxGeometry(0.4, 0.6, 0.2),
    new MeshStandardMaterial({ color: 0x2f8f4e }),
  );
  npcPlaceholder.position.set(NPC_SPOT.x, 0, NPC_SPOT.z);
  npcPlaceholder.visible = true;
  scene.add(npcPlaceholder);

  let npcMixer: AnimationMixer | null = null;
  let npcMesh: Object3D = npcPlaceholder;
  void loadPlaceholderNpc().then(({ scene: npcScene, clip }) => {
    npcScene.position.set(NPC_SPOT.x, 0, NPC_SPOT.z);
    npcScene.name = 'Pip';
    scene.add(npcScene);
    npcPlaceholder.visible = false;
    npcMesh = npcScene;
    npcMixer = new AnimationMixer(npcScene);
    npcMixer.clipAction(clip).play();
  });

  // The ambient gull: purely decorative environmental animation
  // (roadmap: "ambient creatures and environmental animation"), never
  // raycast-interactive and never emits a domain event.
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

  function interact(): void {
    raycaster.setFromCamera(new Vector2(0, 0), camera);
    const hits = raycaster.intersectObject(npcMesh, true);
    if (hits.length > 0) {
      bus.emit('ObjectInteracted', { entityId: NPC_ID, interactionId: `${NPC_ID}:talk` });
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
  let wasFocusedOnNpc = false;
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

    raycaster.setFromCamera(new Vector2(0, 0), camera);
    const focusedOnNpcNow = raycaster.intersectObject(npcMesh, true).length > 0;
    if (focusedOnNpcNow !== wasFocusedOnNpc) {
      bus.emit('InteractableFocused', { entityId: focusedOnNpcNow ? NPC_ID : null });
    }
    wasFocusedOnNpc = focusedOnNpcNow;

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
