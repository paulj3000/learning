import {
  AnimationMixer,
  BoxGeometry,
  CylinderGeometry,
  Group,
  LoopOnce,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  type AnimationAction,
  type BufferGeometry,
  type Material,
  type Object3D,
} from 'three';
import { cloneAssetScene } from '../../assets/cloneAsset';
import type { WorldExtension, WorldExtensionContext } from '../../runtime/extensionRegistry';
import { REGION_PLAY_EXTENSION_ID, type RegionPlayChestConfig } from '../../../../region-play/regionManifest';
import { tryParseRegionPlayConfig } from '../../../../region-play/regionPlayConfig';

/**
 * The scene half of `region-play` (TR-7): draws what a server-published
 * region's manifest leaves to it.
 *
 * - **Chests.** The catalogue model when the chest names one, held on its
 *   open clip's last frame when open; a built chest (a box with a hinged lid
 *   and gold inside) when it names none, the model fails to load, or the
 *   model has no open clip. Either way open and closed look different, and
 *   which one shows comes only from the child's server state: the config at
 *   build time, then `setChestOpen` from the companion after the play API
 *   says so. Interacting never opens a chest.
 * - **Figures.** A placeholder character for an NPC published without a
 *   model, so the region still renders and the NPC still talks.
 *
 * It decides nothing and records nothing. Focus, labels, and interaction
 * stay with the runtime, which owns these entities' roots.
 */

export interface RegionPlaySceneApi {
  setChestOpen(entityId: string, open: boolean): void;
  /** Whether a chest is drawn open, or undefined for an unknown chest. */
  isChestOpen(entityId: string): boolean | undefined;
}

const WOOD = 0x8a5a2b;
const TRIM = 0xd4a937;
const GOLD = 0xf2c94c;
const FIGURE = 0x2f8f4e;
/** How far a built lid swings back when open, in radians. */
export const OPEN_LID_ANGLE = -1.9;
/** How long a built lid takes to swing open when the server opens it mid-visit (TR-8). */
export const OPEN_SECONDS = 0.7;
/** How long the gold sparkles rise after opening. */
export const SPARKLE_SECONDS = 1.4;
const SPARKLE_COUNT = 10;

interface DrawnChest {
  open: boolean;
  /** `instant`: drawn in its state with no animation (entering, or a state read from the server). */
  show(open: boolean, instant: boolean): void;
  /** Advances any opening animation. */
  tick(deltaSeconds: number): void;
  dispose(): void;
}

export const regionPlaySceneExtension: WorldExtension = {
  id: REGION_PLAY_EXTENSION_ID,
  assetIds(config) {
    const parsed = tryParseRegionPlayConfig(config);
    if (!parsed) return [];
    return [...new Set(parsed.chests.flatMap((chest) => (chest.assetId ? [chest.assetId] : [])))];
  },
  mount(context: WorldExtensionContext) {
    const config = tryParseRegionPlayConfig(context.config);
    if (!config) {
      console.warn('[region-play] ignoring a binding with unreadable config');
      return;
    }
    const geometries: BufferGeometry[] = [];
    const materials: Material[] = [];
    const own = (geometry: BufferGeometry, color: number): Mesh => {
      const material = new MeshStandardMaterial({ color });
      geometries.push(geometry);
      materials.push(material);
      return new Mesh(geometry, material);
    };
    const mixers = new Set<AnimationMixer>();
    const chests = new Map<string, DrawnChest>();
    let disposed = false;

    for (const figure of config.figures) {
      const root = context.entityRoot(figure.entityId);
      if (!root) continue;
      const bodyHeight = figure.height * 0.7;
      const body = own(new CylinderGeometry(0.3, 0.35, bodyHeight, 12), FIGURE);
      body.position.y = bodyHeight / 2;
      const head = own(new SphereGeometry(figure.height * 0.15, 12, 8), FIGURE);
      head.position.y = bodyHeight + figure.height * 0.15;
      root.add(body, head);
    }

    for (const chest of config.chests) {
      const root = context.entityRoot(chest.entityId);
      if (!root) continue;
      let current: DrawnChest = builtChest(root, chest, own);
      current.show(chest.isOpen, true);
      chests.set(chest.entityId, current);
      if (!chest.assetId || !chest.openClip) continue;
      const openClip = chest.openClip;
      context
        .loadModel(chest.assetId)
        .then((asset) => {
          if (disposed) return;
          const clip = asset.animations.find((candidate) => candidate.name === openClip);
          if (!clip) return; // no way to show it open: keep the built chest
          const model = cloneAssetScene(asset.scene);
          model.scale.setScalar(chest.scale);
          const mixer = new AnimationMixer(model);
          const action = mixer.clipAction(clip);
          const open = current.open;
          current.dispose();
          root.add(model);
          mixers.add(mixer);
          current = modelChest(root, model, mixer, action, clip.duration, () => mixers.delete(mixer));
          current.show(open, true);
          chests.set(chest.entityId, current);
        })
        .catch(() => undefined); // a model that fails to load leaves the built chest
    }

    const stopFrames = context.onFrame((delta) => {
      for (const mixer of mixers) mixer.update(delta);
      for (const chest of chests.values()) chest.tick(delta);
    });

    const api: RegionPlaySceneApi = {
      setChestOpen(entityId, open) {
        const chest = chests.get(entityId);
        if (chest && chest.open !== open) chest.show(open, false);
      },
      isChestOpen(entityId) {
        return chests.get(entityId)?.open;
      },
    };

    return {
      api,
      dispose() {
        disposed = true;
        stopFrames();
        for (const chest of chests.values()) chest.dispose();
        for (const mixer of mixers) mixer.stopAllAction();
        for (const geometry of geometries) geometry.dispose();
        for (const material of materials) material.dispose();
      },
    };
  },
};

function builtChest(
  root: Object3D,
  chest: RegionPlayChestConfig,
  own: (geometry: BufferGeometry, color: number) => Mesh,
): DrawnChest {
  const { width, height, depth } = chest.placeholder;
  const group = new Group();
  group.name = 'region-play:built-chest';
  group.scale.setScalar(chest.scale);
  const baseHeight = height * 0.6;
  const base = own(new BoxGeometry(width, baseHeight, depth), WOOD);
  base.position.y = baseHeight / 2;
  const trim = own(new BoxGeometry(width * 1.02, baseHeight * 0.12, depth * 1.02), TRIM);
  trim.position.y = baseHeight * 0.85;
  const gold = own(new BoxGeometry(width * 0.8, baseHeight * 0.1, depth * 0.8), GOLD);
  gold.position.y = baseHeight;
  gold.name = 'region-play:gold';
  // The lid hinges along the back edge: a pivot there, the lid offset forward from it.
  const hinge = new Group();
  hinge.name = 'region-play:lid-hinge';
  hinge.position.set(0, baseHeight, -depth / 2);
  const lidHeight = height - baseHeight;
  const lid = own(new BoxGeometry(width, lidHeight, depth), WOOD);
  lid.position.set(0, lidHeight / 2, depth / 2);
  hinge.add(lid);
  // Gold sparkles that rise out of the chest as it opens: the moment of reward in the world.
  const sparkles = new Group();
  sparkles.name = 'region-play:sparkles';
  sparkles.visible = false;
  for (let index = 0; index < SPARKLE_COUNT; index += 1) {
    const sparkle = own(new SphereGeometry(0.06, 6, 4), GOLD);
    const angle = (index / SPARKLE_COUNT) * Math.PI * 2;
    sparkle.userData.drift = { x: Math.cos(angle) * width * 0.35, z: Math.sin(angle) * depth * 0.35 };
    sparkles.add(sparkle);
  }
  group.add(base, trim, gold, hinge, sparkles);
  root.add(group);

  let opening = 0; // seconds into the lid swing; 0 when not animating
  let sparkling = 0; // seconds into the sparkle rise; 0 when not animating
  const place = (lidProgress: number) => {
    hinge.rotation.x = OPEN_LID_ANGLE * lidProgress;
    gold.position.y = baseHeight + baseHeight * 0.15 * lidProgress;
  };

  const drawn: DrawnChest = {
    open: false,
    show(open, instant) {
      drawn.open = open;
      gold.visible = open;
      if (!open || instant) {
        opening = 0;
        sparkling = 0;
        sparkles.visible = false;
        place(open ? 1 : 0);
        return;
      }
      opening = Number.EPSILON;
      sparkling = Number.EPSILON;
      sparkles.visible = true;
      place(0);
    },
    tick(delta) {
      if (opening > 0) {
        opening = Math.min(opening + delta, OPEN_SECONDS);
        const t = opening / OPEN_SECONDS;
        place(1 - (1 - t) ** 3); // ease out: a quick pop, then settling back
        if (opening >= OPEN_SECONDS) opening = 0;
      }
      if (sparkling > 0) {
        sparkling = Math.min(sparkling + delta, SPARKLE_SECONDS);
        const t = sparkling / SPARKLE_SECONDS;
        for (const sparkle of sparkles.children) {
          const drift = sparkle.userData.drift as { x: number; z: number };
          sparkle.position.set(drift.x * t, baseHeight + t * height * 1.6, drift.z * t);
          sparkle.scale.setScalar(Math.max(0.01, 1 - t));
        }
        if (sparkling >= SPARKLE_SECONDS) {
          sparkling = 0;
          sparkles.visible = false;
        }
      }
    },
    dispose() {
      root.remove(group);
    },
  };
  return drawn;
}

function modelChest(
  root: Object3D,
  model: Object3D,
  mixer: AnimationMixer,
  action: AnimationAction,
  duration: number,
  release: () => void,
): DrawnChest {
  action.setLoop(LoopOnce, 1);
  action.clampWhenFinished = true;
  const drawn: DrawnChest = {
    open: false,
    show(open, instant) {
      drawn.open = open;
      action.reset();
      if (!open) {
        action.stop();
        mixer.setTime(0);
        return;
      }
      action.play();
      if (instant) {
        action.time = duration;
        mixer.update(0);
      }
    },
    tick() {
      // The mixer is advanced with every other mixer in the frame loop.
    },
    dispose() {
      mixer.stopAllAction();
      release();
      root.remove(model);
    },
  };
  return drawn;
}
