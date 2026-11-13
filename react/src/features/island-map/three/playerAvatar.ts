import {
  BoxGeometry,
  CapsuleGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  type BufferGeometry,
  type Material,
  type Object3D,
} from 'three';
import type { AvatarValue } from '../../child-profile/constants';
import { createNpcAnimator, type NpcAnimator } from '../../npc-manager/animation/npcAnimator';
import { getAvatarAppearance, type AvatarAppearance } from '../avatarAppearance';
import { cloneAssetScene } from './assets/cloneAsset';
import type { MovementState } from './firstPersonController';
import {
  createPlayerAnimationController,
  playerAnimationMap,
  withoutRootMotion,
  type PlayerAnimationController,
} from './playerAnimation';
import type { PlayerAvatarConfiguration } from './playerPresentation';
import type { LoadedModel } from './runtime/extensionRegistry';

/**
 * The child's avatar in the 3D world (LAI-JMP-01a): one reusable renderer for
 * every location. It only *shows* the player. Where it stands and which way
 * it faces are copied from the shared movement controller every frame; it
 * never feeds anything back, and its animations carry no root motion, so
 * collision and progression are exactly what the controller decides.
 *
 * Which model:
 * 1. the location's `player.avatar.assetKey` (a costume a location needs);
 * 2. else the 3D model registered for the child's `avatarKey`
 *    (`PLAYER_AVATAR_ASSET_IDS`);
 * 3. else, and whenever a model fails to load, a friendly placeholder built
 *    from the child's chosen avatar look (`avatarAppearance.ts`: the same
 *    colours and ears, antenna, fin or spikes the 2D island already draws).
 *
 * Models load through the location's own loader (`LocationEngineAssets`), so
 * the asset resolver and cache are the existing ones; a Django region
 * resolves through the asset library like every other model there.
 */

/**
 * 3D avatar models by `ChildProfile.avatarKey`. Empty today: no avatar has a
 * GLB yet, so every child gets the placeholder in their own colours (follow-up
 * card LAI-JMP-01c). Filling a row is the whole job of adding one.
 */
export const PLAYER_AVATAR_ASSET_IDS: Readonly<Partial<Record<AvatarValue, string>>> = {};

/** The placeholder's height, metres: a child-sized explorer under the 1.5 m follow point. */
export const PLACEHOLDER_HEIGHT = 1.39;
export const PLACEHOLDER_NAME = 'player-avatar:placeholder';
export const AVATAR_ROOT_NAME = 'player-avatar';

/** Per second: how quickly the avatar turns to face where it is going. */
const TURN_RATE = 12;
/** Under this speed (m/s) the avatar keeps facing the way it last went. */
const FACING_MIN_SPEED = 0.3;

/** Shortest signed angle from `from` to `to`, radians. */
export function angleDelta(from: number, to: number): number {
  const twoPi = Math.PI * 2;
  let delta = (to - from) % twoPi;
  if (delta > Math.PI) delta -= twoPi;
  if (delta < -Math.PI) delta += twoPi;
  return delta;
}

/**
 * Which way the avatar faces: toward its horizontal velocity, turned
 * smoothly the short way round. Standing still keeps the last facing.
 */
export class AvatarFacing {
  private current: number;

  constructor(initialYaw: number) {
    this.current = initialYaw;
  }

  get yaw(): number {
    return this.current;
  }

  update(deltaSeconds: number, velocity: { x: number; z: number }): number {
    const dt = Number.isFinite(deltaSeconds) && deltaSeconds > 0 ? deltaSeconds : 0;
    if (Math.hypot(velocity.x, velocity.z) < FACING_MIN_SPEED) return this.current;
    // Forward at yaw 0 is +Z, as for the movement controller.
    const target = Math.atan2(velocity.x, velocity.z);
    const step = angleDelta(this.current, target) * (1 - Math.exp(-TURN_RATE * dt));
    this.current += step;
    return this.current;
  }

  snap(yaw: number): void {
    this.current = yaw;
  }
}

export interface PlayerAvatarOptions {
  /** The child's `ChildProfile.avatarKey`; unknown or missing gets the default look. */
  avatarKey: string | null | undefined;
  config: PlayerAvatarConfiguration;
  /** The location's model loader (asset resolver and cache). Absent: placeholder only. */
  loadModel?: (assetId: string) => Promise<LoadedModel>;
  /** Overrides the avatarKey registry (tests, a future Django-served registry). */
  assetIdFor?: (avatarKey: string) => string | undefined;
  reducedMotion: () => boolean;
}

export interface PlayerAvatar {
  /** Add this to the scene. Its position is the feet; its children are the visible model. */
  readonly root: Group;
  /** Settles once the model has loaded or the placeholder has been kept. Never rejects. */
  readonly ready: Promise<void>;
  /** What is showing. */
  readonly source: () => 'placeholder' | 'model';
  /** The asset id it tried to load, if any. */
  readonly assetId: string | undefined;
  /** Copies the controller's feet position and the facing to the visible model. */
  setPose(feet: { x: number; y: number; z: number }, facingYaw: number): void;
  setVisible(visible: boolean): void;
  /** Once per frame. */
  animate(
    deltaSeconds: number,
    movement: MovementState,
    horizontalSpeed: number,
    walkSpeed: number,
  ): void;
  /** A short gesture on interacting, where the model has one. */
  interact(): void;
  dispose(): void;
}

/** The asset id to load for this child here, if any. */
export function avatarAssetIdFor(
  avatarKey: string | null | undefined,
  config: Pick<PlayerAvatarConfiguration, 'assetKey'>,
  registry: (key: string) => string | undefined = (key) =>
    PLAYER_AVATAR_ASSET_IDS[key as AvatarValue],
): string | undefined {
  if (config.assetKey) return config.assetKey;
  return avatarKey ? registry(avatarKey) : undefined;
}

export function createPlayerAvatar(options: PlayerAvatarOptions): PlayerAvatar {
  const { config } = options;
  const root = new Group();
  root.name = AVATAR_ROOT_NAME;
  // The facing turns this group; the model's own authored facing is corrected inside it.
  const facing = new Group();
  facing.rotation.y = config.rotationOffset;
  root.add(facing);

  const ownedGeometries: BufferGeometry[] = [];
  const ownedMaterials: Material[] = [];
  let disposed = false;
  let source: 'placeholder' | 'model' = 'placeholder';

  const placeholder = buildPlaceholder(
    getAvatarAppearance(options.avatarKey),
    ownedGeometries,
    ownedMaterials,
  );
  placeholder.scale.setScalar(config.scale);
  facing.add(placeholder);

  let animator: NpcAnimator = createNpcAnimator({
    root: placeholder,
    clips: [],
    animationMap: {},
    reducedMotion: options.reducedMotion,
  });
  let animation: PlayerAnimationController = createPlayerAnimationController(animator, {});

  const assetId = avatarAssetIdFor(options.avatarKey, config, options.assetIdFor);

  const ready: Promise<void> =
    assetId && options.loadModel
      ? options
          .loadModel(assetId)
          .then(({ scene, animations }) => {
            if (disposed) return;
            const model = cloneAssetScene(scene);
            model.scale.multiplyScalar(config.scale);
            const rootNames = new Set<string>([model.name, ...model.children.map((c) => c.name)]);
            const clips = withoutRootMotion(animations, rootNames);
            const map = playerAnimationMap(clips.map((clip) => clip.name));
            animator.dispose();
            facing.remove(placeholder);
            disposeOwned();
            facing.add(model);
            animator = createNpcAnimator({
              root: model,
              clips,
              animationMap: map,
              reducedMotion: options.reducedMotion,
            });
            animation = createPlayerAnimationController(animator, map);
            source = 'model';
          })
          .catch((error: unknown) => {
            // The placeholder stays: a missing avatar never stops play.
            console.warn(`[player avatar] could not load ${assetId}; using the placeholder`, error);
          })
      : Promise.resolve();

  function disposeOwned(): void {
    for (const geometry of ownedGeometries.splice(0)) geometry.dispose();
    for (const material of ownedMaterials.splice(0)) material.dispose();
  }

  return {
    root,
    ready,
    source: () => source,
    assetId,
    setPose(feet, facingYaw) {
      root.position.set(feet.x, feet.y, feet.z);
      root.rotation.y = facingYaw;
    },
    setVisible(visible) {
      root.visible = visible;
    },
    animate(deltaSeconds, movement, horizontalSpeed, walkSpeed) {
      if (disposed) return;
      animation.update(movement, horizontalSpeed, walkSpeed);
      animator.update(deltaSeconds);
    },
    interact() {
      if (!disposed) animation.interact();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      animator.dispose();
      root.parent?.remove(root);
      // Only the placeholder's own primitives: a loaded model's geometry belongs to the cache.
      disposeOwned();
    },
  };
}

/**
 * A friendly explorer from primitives, in the child's avatar colours: body,
 * head, face, eyes and the avatar's accessory. Feet at y = 0, facing +Z.
 */
function buildPlaceholder(
  look: AvatarAppearance,
  geometries: BufferGeometry[],
  materials: Material[],
): Group {
  const group = new Group();
  group.name = PLACEHOLDER_NAME;
  const material = (color: number) => {
    const made = new MeshStandardMaterial({ color, roughness: 0.7 });
    materials.push(made);
    return made;
  };
  const mesh = (geometry: BufferGeometry, color: number, name: string): Mesh => {
    geometries.push(geometry);
    const made = new Mesh(geometry, material(color));
    made.name = name;
    group.add(made);
    return made;
  };

  const body = mesh(new CapsuleGeometry(0.27, 0.42, 4, 12), look.body, 'body');
  body.position.y = 0.27 + 0.21;
  const head = mesh(new SphereGeometry(0.25, 16, 12), look.body, 'head');
  head.position.y = 1.14;
  const face = mesh(new SphereGeometry(0.16, 12, 8), look.accent, 'face');
  face.position.set(0, 1.1, 0.14);
  face.scale.set(1, 0.85, 0.6);
  const belly = mesh(new SphereGeometry(0.2, 12, 8), look.accent, 'belly');
  belly.position.set(0, 0.5, 0.13);
  belly.scale.set(1, 1.2, 0.5);
  for (const side of [-1, 1]) {
    const eye = mesh(
      new SphereGeometry(0.035, 8, 6),
      0x1d1d1d,
      `eye-${side < 0 ? 'left' : 'right'}`,
    );
    eye.position.set(side * 0.08, 1.17, 0.235);
    const foot = mesh(new BoxGeometry(0.14, 0.08, 0.22), look.accent, `foot-${side}`);
    foot.position.set(side * 0.12, 0.04, 0.04);
  }

  switch (look.accessory) {
    case 'EARS':
      for (const side of [-1, 1]) {
        const ear = mesh(new ConeGeometry(0.08, 0.2, 8), look.body, `ear-${side}`);
        ear.position.set(side * 0.15, 1.38, 0);
        ear.rotation.z = -side * 0.35;
      }
      break;
    case 'ANTENNA': {
      const stalk = mesh(new CylinderGeometry(0.015, 0.015, 0.2, 6), look.accent, 'antenna');
      stalk.position.y = 1.47;
      const tip = mesh(new SphereGeometry(0.045, 8, 6), look.accent, 'antenna-tip');
      tip.position.y = 1.58;
      break;
    }
    case 'FIN': {
      const fin = mesh(new ConeGeometry(0.12, 0.3, 4), look.accent, 'fin');
      fin.position.set(0, 0.55, -0.3);
      fin.rotation.x = -Math.PI / 2.4;
      break;
    }
    case 'SPIKES':
      for (const [index, y] of [0.95, 0.75, 0.55].entries()) {
        const spike = mesh(new ConeGeometry(0.06, 0.16, 6), look.accent, `spike-${index}`);
        spike.position.set(0, y, -0.27);
        spike.rotation.x = -Math.PI / 2;
      }
      break;
    case 'NONE':
      break;
  }
  return group;
}

/** Every mesh under an object, e.g. to check what the avatar draws. */
export function meshesUnder(object: Object3D): Mesh[] {
  const found: Mesh[] = [];
  object.traverse((child) => {
    if ((child as Mesh).isMesh) found.push(child as Mesh);
  });
  return found;
}
