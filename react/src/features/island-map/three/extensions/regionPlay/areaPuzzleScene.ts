import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Mesh,
  MeshStandardMaterial,
  Points,
  PointsMaterial,
  Vector3,
  type Object3D,
} from 'three';
import { prefersReducedMotion } from '../../../../../lib/motionPreference';
import type { WorldExtensionContext } from '../../runtime/extensionRegistry';
import type { Owned } from './areaStandIns';

/**
 * How 3D Area puzzles look (ADR-043 F, Firepeak FP-5 to FP-8). It draws, it never decides: the
 * React companion owns the child's arrangement and valve turns (and the server grades them), and
 * hands this module what to show. Only the crystal's discovery animation runs on its own clock.
 *
 * - **Stones and gaps** (`PLACE_PLATFORMS`): a stone is carried in front of the child, snapped
 *   into a gap, or back on the bank. Its length shows its size; a gap's outline shows its size
 *   when the band's parameters allow, and glows when the stone in it fits.
 * - **Valves** (`VALVE_SEQUENCE`): a turned valve's wheel is turned and lit.
 * - **The crystal** (`COLLECT_OBJECT`): glows, rises, sparkles, turns and flies to the child.
 */

export interface ArrangementView {
  /** Slot entity id -> stone entity id. */
  placements: Readonly<Record<string, string>>;
  carried: string | null;
  /** Stone entity id -> size (1 to 4), for its length. */
  stoneSizes: Readonly<Record<string, number>>;
  /** Slot entity id -> gap size: its physical length in the scene. */
  gapSizes: Readonly<Record<string, number>>;
  /** Slots whose stone fits (glow). */
  fits: readonly string[];
  /** Whether gaps show a glowing outline of their size (the band's `showOutlines`). */
  outlines: boolean;
}

export interface AreaPuzzleApi {
  showArrangement(view: ArrangementView): void;
  showValveTurns(valveEntityIds: readonly string[]): void;
  /** Plays the discovery animation, then hides the entity. Resolves when it ends. */
  discover(entityId: string): Promise<void>;
  setVisible(entityId: string, visible: boolean): void;
}

const UNIT = 0.8; // metres per size unit, along the crossing
const CARRY_DISTANCE = 1.6;
const DISCOVERY_SECONDS = 2.4;
const SPARKLES = 24;

interface Animation {
  entityId: string;
  root: Object3D;
  started: number;
  duration: number;
  origin: Vector3;
  sparkles: Points | null;
  resolve(): void;
}

export function mountAreaPuzzles(
  context: WorldExtensionContext,
  owned: Owned,
): { api: AreaPuzzleApi; dispose(): void } {
  const reducedMotion = prefersReducedMotion();
  const homes = new Map<string, Vector3>();
  const rootOf = (entityId: string): Object3D | undefined => {
    const root = context.entityRoot(entityId);
    if (root && !homes.has(entityId)) homes.set(entityId, root.position.clone());
    return root;
  };
  let carried: string | null = null;
  let lastValves = new Set<string>();
  const animations: Animation[] = [];

  const glow = (root: Object3D, intensity: number) => {
    root.traverse((child) => {
      const material = (child as Mesh).material;
      if (material instanceof MeshStandardMaterial) material.emissiveIntensity = intensity;
    });
  };

  const forward = new Vector3();
  const stopFrames = context.onFrame((delta) => {
    if (carried) {
      const root = rootOf(carried);
      if (root) {
        context.camera.getWorldDirection(forward);
        forward.y = 0;
        forward.normalize();
        const camera = context.camera.position;
        root.position.set(
          camera.x + forward.x * CARRY_DISTANCE,
          0.7,
          camera.z + forward.z * CARRY_DISTANCE,
        );
      }
    }
    const now = context.now();
    for (const animation of [...animations]) {
      const t = Math.min((now - animation.started) / (animation.duration * 1000), 1);
      const { root, origin } = animation;
      if (reducedMotion) {
        root.scale.setScalar(1 - t);
      } else if (t < 0.25) {
        glow(root, 0.8 + t * 8); // 1. it begins glowing
      } else if (t < 0.6) {
        const rise = (t - 0.25) / 0.35;
        root.position.y = origin.y + rise * 0.9; // 2. it rises
        root.rotation.y += delta * 4; // 4. it turns
        if (animation.sparkles) animation.sparkles.visible = true; // 3. light particles
      } else {
        const fly = (t - 0.6) / 0.4; // 5. it moves toward the child
        const camera = context.camera.position;
        root.position.lerpVectors(
          new Vector3(origin.x, origin.y + 0.9, origin.z),
          new Vector3(camera.x, camera.y - 0.3, camera.z),
          fly,
        );
        root.rotation.y += delta * 6;
        root.scale.setScalar(Math.max(0.05, 1 - fly));
      }
      if (animation.sparkles?.visible) {
        animation.sparkles.position.copy(root.position);
        animation.sparkles.rotation.y += delta * 2;
      }
      if (t >= 1) {
        root.visible = false;
        if (animation.sparkles) animation.sparkles.visible = false;
        animations.splice(animations.indexOf(animation), 1);
        animation.resolve(); // 6. the companion shows the discovery message
      }
    }
  });

  const api: AreaPuzzleApi = {
    showArrangement(view) {
      const placedStones = new Set(Object.values(view.placements));
      for (const [stone, size] of Object.entries(view.stoneSizes)) {
        const root = rootOf(stone);
        if (!root) continue;
        root.scale.z = size;
        if (stone === view.carried) continue;
        if (!placedStones.has(stone)) {
          const home = homes.get(stone);
          if (home) root.position.copy(home);
          context.setFocusable(stone, true);
        }
      }
      for (const [slot, stone] of Object.entries(view.placements)) {
        const slotRoot = rootOf(slot);
        const stoneRoot = rootOf(stone);
        if (!slotRoot || !stoneRoot) continue;
        stoneRoot.position.set(slotRoot.position.x, 0.02, slotRoot.position.z);
        context.setFocusable(stone, true);
      }
      for (const slot of new Set([
        ...Object.keys(view.gapSizes),
        ...Object.keys(view.placements),
      ])) {
        const root = rootOf(slot);
        if (!root) continue;
        const gap = view.gapSizes[slot];
        root.scale.set(1, 1, gap ? (gap * UNIT) / 1.6 : 1);
        glow(root, view.fits.includes(slot) ? 1.6 : view.outlines ? 0.5 : 0.05);
      }
      if (carried && carried !== view.carried) context.setFocusable(carried, true);
      carried = view.carried;
      if (carried) context.setFocusable(carried, false);
    },
    showValveTurns(turned) {
      const on = new Set(turned);
      for (const entityId of turned.concat([...lastValves].filter((id) => !on.has(id)))) {
        const root = rootOf(entityId);
        if (!root) continue;
        const wheel = root.getObjectByName('valve-wheel');
        if (wheel) wheel.rotation.z = on.has(entityId) ? Math.PI / 2 : 0;
        glow(root, on.has(entityId) ? 1.2 : 0);
      }
      lastValves = on;
    },
    discover(entityId) {
      const root = rootOf(entityId);
      if (!root || !root.visible) return Promise.resolve();
      let sparkles: Points | null = null;
      if (!reducedMotion) {
        const positions = new Float32Array(SPARKLES * 3);
        for (let index = 0; index < SPARKLES; index += 1) {
          const angle = (index / SPARKLES) * Math.PI * 2;
          positions[index * 3] = Math.cos(angle) * 0.6;
          positions[index * 3 + 1] = (index % 4) * 0.15;
          positions[index * 3 + 2] = Math.sin(angle) * 0.6;
        }
        const geometry = new BufferGeometry();
        geometry.setAttribute('position', new BufferAttribute(positions, 3));
        const material = new PointsMaterial({
          color: 0xbff4ff,
          size: 0.12,
          transparent: true,
          depthWrite: false,
          blending: AdditiveBlending,
        });
        owned.geometries.push(geometry);
        owned.materials.push(material);
        sparkles = new Points(geometry, material);
        sparkles.visible = false;
        context.scene.add(sparkles);
      }
      return new Promise<void>((resolve) => {
        animations.push({
          entityId,
          root,
          started: context.now(),
          duration: reducedMotion ? 0.4 : DISCOVERY_SECONDS,
          origin: root.position.clone(),
          sparkles,
          resolve,
        });
      });
    },
    setVisible(entityId, visible) {
      const root = rootOf(entityId);
      if (!root) return;
      root.visible = visible;
      context.setFocusable(entityId, visible);
    },
  };

  return {
    api,
    dispose() {
      stopFrames();
      for (const animation of animations) {
        if (animation.sparkles) context.scene.remove(animation.sparkles);
        animation.resolve();
      }
      animations.length = 0;
    },
  };
}
