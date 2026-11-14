import {
  Box3,
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  RingGeometry,
  Vector3,
  type Object3D,
} from 'three';
import { createPathMotion, pathEnd } from './platformMotion';
import type { PlatformState, PlatformSystem } from './platformSystem';
import type { PlatformingSpec } from './platformSpec';

/**
 * How platforms, plates, checkpoints and destination markers look (presentation only; the
 * runtime owns positions and collision). Procedural blocks use one shared unit-box geometry and
 * one material per colour; a platform that names a model shows it fitted to its size instead.
 * Child-friendly: warm colours, a bright ring where a moving platform goes, a flag at every
 * checkpoint. A platform about to vanish blinks, or under reduced motion simply dims.
 */

export interface PlatformPresentation {
  readonly root: Group;
  /** Follows the runtime: positions, turntables, vanishing, plates pressed. */
  update(seconds: number): void;
  dispose(): void;
}

export interface PresentationOptions {
  reducedMotion?: boolean;
  /** Loads a model for a platform's `assetId` (the location's shared, cached loader). */
  loadModel?: (assetId: string) => Promise<{ scene: Object3D }>;
  /** Clones a loaded model before placing it (the engine's `cloneAssetScene`). */
  clone?: (source: Object3D) => Object3D;
  /** Tracks a load the scene's `ready` waits for. */
  track?: (work: Promise<void>, what: string) => void;
}

const COLOURS = {
  platform: 0xc58b4f,
  moving: 0x3fa7d6,
  bounce: 0xf26b8a,
  vanish: 0xa78bfa,
  plate: 0xf2c94c,
  platePressed: 0x6fcf97,
  marker: 0xffd166,
  flag: 0x27ae60,
  pole: 0x8d6e63,
} as const;

export function createPlatformPresentation(
  system: PlatformSystem,
  spec: PlatformingSpec,
  options: PresentationOptions = {},
): PlatformPresentation {
  const root = new Group();
  root.name = 'platforming';
  const unitBox = new BoxGeometry(1, 1, 1);
  const disc = new CylinderGeometry(0.5, 0.5, 1, 24);
  const ring = new RingGeometry(0.45, 0.6, 32);
  const materials = new Map<number, MeshStandardMaterial>();
  const owned: MeshStandardMaterial[] = [];
  const material = (colour: number) => {
    let found = materials.get(colour);
    if (!found) {
      found = new MeshStandardMaterial({ color: colour, roughness: 0.8 });
      materials.set(colour, found);
    }
    return found;
  };

  interface View {
    state: PlatformState;
    node: Group;
    block: Mesh;
    /** Its own material when it can blink, so others are not affected. */
    fading: MeshStandardMaterial | null;
    model: Object3D | null;
  }
  const views: View[] = [];
  for (const state of system.platforms) {
    const platform = state.spec;
    const node = new Group();
    node.name = `platform:${platform.id}`;
    const colour =
      platform.color ??
      (platform.bounce ? COLOURS.bounce : platform.vanish ? COLOURS.vanish : platform.motion || platform.spin ? COLOURS.moving : COLOURS.platform);
    let fading: MeshStandardMaterial | null = null;
    if (platform.vanish) {
      fading = new MeshStandardMaterial({ color: colour, roughness: 0.8, transparent: true });
      owned.push(fading);
    }
    const block = new Mesh(unitBox, fading ?? material(colour));
    block.scale.set(platform.size.width, platform.size.height, platform.size.depth);
    block.position.y = platform.size.height / 2;
    node.add(block);
    root.add(node);
    const view: View = { state, node, block, fading, model: null };
    views.push(view);

    if (platform.assetId && options.loadModel) {
      const work = options.loadModel(platform.assetId).then(({ scene }) => {
        const model = options.clone ? options.clone(scene) : scene.clone(true);
        fitInto(model, platform.size);
        model.rotation.y = platform.rotationY ?? 0;
        node.add(model);
        view.model = model;
        block.visible = false;
      });
      options.track?.(work, `platform ${platform.id}`);
    }

    // Where a moving platform goes: a bright ring on the ground under its destination.
    if (platform.motion && platform.indicator !== false) {
      const end = pathEnd(createPathMotion(platform.motion.path, platform.motion.mode ?? 'PING_PONG'));
      const marker = new Mesh(ring, material(COLOURS.marker));
      marker.rotation.x = -Math.PI / 2;
      const size = Math.min(platform.size.width, platform.size.depth);
      marker.scale.set(size, size, 1);
      marker.position.set(platform.position.x + end.x, 0.03, platform.position.z + end.z);
      marker.name = `platform-destination:${platform.id}`;
      root.add(marker);
    }
  }

  const plates = system.plates.map((plate) => {
    const half = plate.spec.halfSize ?? 0.6;
    const mesh = new Mesh(unitBox, material(plate.spec.color ?? COLOURS.plate));
    mesh.scale.set(half * 2, 0.08, half * 2);
    mesh.position.set(plate.spec.position.x, 0.04, plate.spec.position.z);
    mesh.name = `pressure-plate:${plate.spec.id}`;
    root.add(mesh);
    return { plate, mesh };
  });

  for (const checkpoint of spec.checkpoints ?? []) {
    const flag = new Group();
    flag.name = `course-checkpoint:${checkpoint.id}`;
    const pole = new Mesh(disc, material(COLOURS.pole));
    pole.scale.set(0.08, 1.6, 0.08);
    pole.position.y = 0.8;
    const cloth = new Mesh(unitBox, material(COLOURS.flag));
    cloth.scale.set(0.5, 0.32, 0.04);
    cloth.position.set(0.25, 1.4, 0);
    flag.add(pole, cloth);
    flag.position.set(checkpoint.x + (checkpoint.halfSize ?? 1) * 0.8, 0, checkpoint.z);
    root.add(flag);
  }

  let clock = 0;
  return {
    root,
    update(seconds) {
      clock += Math.max(0, seconds);
      for (const view of views) {
        const { state, node } = view;
        node.visible = state.present;
        node.position.copy(state.position);
        node.rotation.y = state.spinAngle;
        if (view.fading) {
          const dim = options.reducedMotion ? 0.55 : 0.35 + 0.65 * Math.abs(Math.cos(clock * 6));
          view.fading.opacity = state.warning ? dim : 1;
        }
      }
      for (const { plate, mesh } of plates) {
        mesh.material = material(plate.pressed ? COLOURS.platePressed : (plate.spec.color ?? COLOURS.plate));
        mesh.scale.y = plate.pressed ? 0.03 : 0.08;
        mesh.position.y = plate.pressed ? 0.015 : 0.04;
      }
    },
    dispose() {
      root.removeFromParent();
      unitBox.dispose();
      disc.dispose();
      ring.dispose();
      for (const each of materials.values()) each.dispose();
      for (const each of owned) each.dispose();
    },
  };
}

/** Scales and centres a model so it fills the platform's box, standing on its bottom. */
function fitInto(model: Object3D, size: { width: number; height: number; depth: number }): void {
  model.updateMatrixWorld(true);
  const bounds = new Box3().setFromObject(model);
  if (bounds.isEmpty()) return;
  const measured = bounds.getSize(new Vector3());
  const scale = Math.min(
    size.width / Math.max(measured.x, 1e-3),
    size.height / Math.max(measured.y, 1e-3),
    size.depth / Math.max(measured.z, 1e-3),
  );
  model.scale.multiplyScalar(scale);
  model.updateMatrixWorld(true);
  const fitted = new Box3().setFromObject(model);
  const centre = fitted.getCenter(new Vector3());
  model.position.x -= centre.x;
  model.position.z -= centre.z;
  model.position.y -= fitted.min.y;
}
