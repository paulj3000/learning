import {
  AmbientLight,
  AnimationMixer,
  Box3,
  BoxGeometry,
  Clock,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  Scene,
  SphereGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { ThreeEngineHandle } from './ThreeGameContainer';
import { FirstPersonController } from './firstPersonController';
import { attachPointerControls } from './pointerControls';
import { loadPlaceholderNpc } from './placeholderNpcGltf';
import { hasApproached, isInRange, isInsideZone } from './sandboxTriggers';
import { SANDBOX_NPC_ID, type WorldEngineEventBus } from './worldEngineEvents';

const COLLECTIBLE_ID = 'sandbox-collectible-1';
const COLLECTIBLE_INTERACTION_ID = 'sandbox-collectible-1:collect';
const BUILD_SPOT_ID = 'sandbox-build-spot-1';
const SHRINE_ZONE_ID = 'sandbox-shrine-zone';
const APPROACH_RANGE_METERS = 2.5;
const RAYCAST_RANGE_METERS = 4;
const EYE_HEIGHT = 1.6;

const NPC_POSITION = new Vector3(0, 0, -5);
const COLLECTIBLE_POSITION = new Vector3(3, 0.6, -3);
const BUILD_SPOT_POSITION = new Vector3(-3, 0, -3);
const SHRINE_ZONE = new Box3(new Vector3(-1.5, -1, -9.5), new Vector3(1.5, 3, -6.5));

const BOUNDARY_COLLIDERS = [
  new Box3(new Vector3(-10, -1, 9), new Vector3(10, 3, 10)), // north wall
  new Box3(new Vector3(-10, -1, -10), new Vector3(10, 3, -9)), // south wall
  new Box3(new Vector3(9, -1, -10), new Vector3(10, 3, 10)), // east wall
  new Box3(new Vector3(-10, -1, -10), new Vector3(-9, 3, 10)), // west wall
  new Box3(new Vector3(1.5, -1, -6.5), new Vector3(2.5, 3, -5.5)), // one obstacle pillar
];

export interface SandboxEngine extends ThreeEngineHandle {
  /** Raycasts from the camera center and fires the matching event, if anything is in range. */
  interact(): void;
}

/**
 * The Phase 31 sandbox scene: movement + collision, GLB loading, an
 * animated NPC, `Raycaster` interaction, and desktop/touch controls, all
 * emitting through `worldEngineEvents.ts` (`docs/ROADMAP.md` Phase 31).
 * This is rendering glue and, like every existing `scenes/*.ts` Phaser
 * scene, is not unit tested — the logic it depends on
 * (`firstPersonController.ts`, `sandboxTriggers.ts`, `placeholderNpcGltf.ts`,
 * `worldEngineEvents.ts`) is, independently.
 */
export function createSandboxEngine(
  parent: HTMLDivElement,
  bus: WorldEngineEventBus,
): SandboxEngine {
  const scene = new Scene();
  scene.background = new Color(0x1c3a52);

  const camera = new PerspectiveCamera(70, parent.clientWidth / parent.clientHeight, 0.1, 100);
  camera.rotation.order = 'YXZ';

  const renderer = new WebGLRenderer({ antialias: true });
  renderer.setSize(parent.clientWidth, parent.clientHeight);
  parent.appendChild(renderer.domElement);

  scene.add(new AmbientLight(0xffffff, 0.6));
  const sun = new DirectionalLight(0xffffff, 0.8);
  sun.position.set(5, 10, 5);
  scene.add(sun);

  const floor = new Mesh(new PlaneGeometry(20, 20), new MeshStandardMaterial({ color: 0x2f5d3a }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  const collectibleMesh = new Mesh(
    new SphereGeometry(0.4, 16, 16),
    new MeshStandardMaterial({ color: 0xf4d35e }),
  );
  collectibleMesh.position.copy(COLLECTIBLE_POSITION);
  scene.add(collectibleMesh);

  const buildSpotMesh = new Mesh(
    new CylinderGeometry(0.6, 0.6, 0.05, 24),
    new MeshStandardMaterial({ color: 0x8a5a34, opacity: 0.6, transparent: true }),
  );
  buildSpotMesh.position.copy(BUILD_SPOT_POSITION);
  scene.add(buildSpotMesh);

  const npcPlaceholder = new Mesh(
    new BoxGeometry(0.4, 0.6, 0.2),
    new MeshStandardMaterial({ color: 0x2f8f4e }),
  );
  npcPlaceholder.position.copy(NPC_POSITION);
  npcPlaceholder.visible = false; // swapped for the real placeholder once it loads
  scene.add(npcPlaceholder);

  let npcMixer: AnimationMixer | null = null;
  void loadPlaceholderNpc().then(({ scene: npcScene, clip }) => {
    npcScene.position.copy(NPC_POSITION);
    npcScene.name = 'Pip';
    scene.add(npcScene);
    npcPlaceholder.visible = false;
    npcMixer = new AnimationMixer(npcScene);
    npcMixer.clipAction(clip).play();
  });

  const controller = new FirstPersonController({
    colliders: BOUNDARY_COLLIDERS,
    startPosition: new Vector3(0, 0, 3),
  });

  const raycaster = new Raycaster();
  raycaster.far = RAYCAST_RANGE_METERS;

  function interact(): void {
    raycaster.setFromCamera(new Vector2(0, 0), camera);
    const hits = raycaster.intersectObjects([collectibleMesh, buildSpotMesh], false);
    const hit = hits[0]?.object;
    if (hit === collectibleMesh) {
      bus.emit('ObjectInteracted', {
        entityId: COLLECTIBLE_ID,
        interactionId: COLLECTIBLE_INTERACTION_ID,
      });
      bus.emit('CollectiblePickedUp', { entityId: COLLECTIBLE_ID });
      scene.remove(collectibleMesh);
    } else if (hit === buildSpotMesh) {
      bus.emit('ObjectInteracted', {
        entityId: BUILD_SPOT_ID,
        interactionId: `${BUILD_SPOT_ID}:build`,
      });
      bus.emit('BuildActionRequested', { entityId: BUILD_SPOT_ID });
    }
  }
  const pointerControls = attachPointerControls(renderer, controller, { onInteract: interact });

  const unsubscribeNpcStateChanged = bus.on('NpcStateChanged', ({ entityId }) => {
    if (entityId !== SANDBOX_NPC_ID) return;
    const target = scene.getObjectByName('Pip') ?? npcPlaceholder;
    // A one-shot visual acknowledgment that the domain layer confirmed the
    // meeting (Phase 31's inbound-direction proof), not a state machine.
    target.scale.setScalar(1.3);
    window.setTimeout(() => target.scale.setScalar(1), 200);
  });

  let wasNearNpc = false;
  let wasInShrineZone = false;
  const clock = new Clock();

  function frame(): void {
    const delta = Math.min(clock.getDelta(), 0.1);

    pointerControls.update(delta);

    camera.position.set(controller.position.x, EYE_HEIGHT, controller.position.z);
    // The controller's forward axis (+Z at yaw 0) is the opposite of a
    // Three.js camera's default forward (-Z at yaw 0); the +PI offset
    // reconciles the two without changing the controller's own convention.
    camera.rotation.y = controller.yaw + Math.PI;
    camera.rotation.x = controller.pitch;

    npcMixer?.update(delta);

    const npcNearNow = isInRange(controller.position, NPC_POSITION, APPROACH_RANGE_METERS);
    if (hasApproached(controller.position, NPC_POSITION, APPROACH_RANGE_METERS, wasNearNpc)) {
      bus.emit('NpcApproached', { entityId: SANDBOX_NPC_ID });
    }
    wasNearNpc = npcNearNow;

    const inZoneNow = isInsideZone(controller.position, SHRINE_ZONE);
    if (inZoneNow && !wasInShrineZone) {
      bus.emit('PlayerEnteredZone', { zoneId: SHRINE_ZONE_ID });
    }
    wasInShrineZone = inZoneNow;

    renderer.render(scene, camera);
    animationFrameId = requestAnimationFrame(frame);
  }

  let animationFrameId = requestAnimationFrame(frame);

  function dispose(): void {
    cancelAnimationFrame(animationFrameId);
    pointerControls.dispose();
    unsubscribeNpcStateChanged();
    renderer.dispose();
    parent.removeChild(renderer.domElement);
  }

  return { dispose, interact };
}
