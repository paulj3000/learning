import {
  BoxGeometry,
  CapsuleGeometry,
  type Color,
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
  toAnimatorMap,
  withoutRootMotion,
  type PlayerAnimationController,
} from './playerAnimation';
import {
  effectivePlayerAnimationMap,
  NO_CUSTOMIZATION,
  type AttachmentSlot,
  type PlayerAvatarCustomization,
  type PlayerAvatarModel,
} from './playerAvatarCatalog';
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
 * 2. else the published model for the child's avatar identity (LAI-JMP-01c:
 *    Django Admin, Player avatars; served by `GET children/<child>/avatar/`);
 * 3. else a bundled model in `PLAYER_AVATAR_ASSET_IDS` (builds without Django);
 * 4. else, and whenever a model fails to load, a friendly placeholder built
 *    from the child's chosen avatar look (`avatarAppearance.ts`: the same
 *    colours and ears, antenna, fin or spikes the 2D island already draws).
 *
 * Models load through the location's own loader (`LocationEngineAssets`), so
 * the asset resolver and cache are the existing ones; a Django region
 * resolves through the asset library like every other model there.
 */

/**
 * Bundled 3D avatar models by `ChildProfile.avatarKey`, for builds without the
 * Django API only. Since LAI-JMP-01c, models are assigned and published in Django
 * Admin (Player avatars) and served by the play API; this stays empty.
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
  /** The model loader (asset resolver and cache). Absent: placeholder only. */
  loadModel?: (ref: string) => Promise<LoadedModel>;
  /**
   * LAI-JMP-01c: the published model for the child's avatar identity, from the play API
   * (`GET children/<child>/avatar/`). May arrive after the scene starts: the placeholder shows
   * until then, so nothing waits on it. `null` (or a rejected promise) keeps the placeholder.
   */
  published?: PlayerAvatarModel | null | Promise<PlayerAvatarModel | null>;
  /** Overrides the bundled avatarKey registry (tests). */
  assetIdFor?: (avatarKey: string) => string | undefined;
  reducedMotion: () => boolean;
}

export interface PlayerAvatar {
  /** Add this to the scene. Its position is the feet; its children are the visible model. */
  readonly root: Group;
  /**
   * Settles once the published answer has arrived and its model has loaded, or the placeholder
   * has been kept. Never rejects. The scene never waits for it.
   */
  readonly ready: Promise<void>;
  /** What is showing. */
  readonly source: () => 'placeholder' | 'model';
  /** The reference it loaded (`asset-id` or `asset-id@n`), once known. */
  readonly loadedRef: () => string | undefined;
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
  /** A celebration (a world change, a find), where the model has one. */
  celebrate(): void;
  /**
   * Where a cosmetic for `slot` would attach (LAI-JMP-01c, for future hats, backpacks, shoes):
   * the model's node named in its customization, or the placeholder's matching part.
   */
  attachPoint(slot: AttachmentSlot): Object3D | undefined;
  dispose(): void;
}

/**
 * The reference to load for this child here, if any: a location costume, else the published
 * model, else the bundled registry.
 */
export function avatarAssetIdFor(
  avatarKey: string | null | undefined,
  config: Pick<PlayerAvatarConfiguration, 'assetKey'>,
  registry: (key: string) => string | undefined = (key) =>
    PLAYER_AVATAR_ASSET_IDS[key as AvatarValue],
  published?: PlayerAvatarModel | null,
): string | undefined {
  if (config.assetKey) return config.assetKey;
  if (published) return published.ref;
  return avatarKey ? registry(avatarKey) : undefined;
}

/** The placeholder's parts standing in for each attachment slot. */
const PLACEHOLDER_ATTACH: Readonly<Record<AttachmentSlot, string>> = {
  head: 'head',
  back: 'body',
  hand_left: 'body',
  hand_right: 'body',
  feet: 'foot--1',
};

/**
 * Gives the materials `colorMaterials` names the child's avatar colours. Materials come from the
 * shared asset cache, so each is cloned before it changes: another child, an NPC or the next
 * visit using the same model never sees this child's colours. Returns the clones to dispose.
 */
export function applyAvatarColors(
  model: Object3D,
  colorMaterials: PlayerAvatarCustomization['colorMaterials'],
  look: AvatarAppearance,
): Material[] {
  const owned: Material[] = [];
  if (Object.keys(colorMaterials).length === 0) return owned;
  model.traverse((node) => {
    const mesh = node as Mesh;
    if (!mesh.isMesh) return;
    const recolour = (material: Material): Material => {
      const role = colorMaterials[material.name];
      const coloured = material as Material & { color?: Color };
      if (!role || !coloured.color) return material;
      const copy = material.clone() as Material & { color: Color };
      copy.color.setHex(role === 'body' ? look.body : look.accent);
      owned.push(copy);
      return copy;
    };
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map(recolour)
      : recolour(mesh.material);
  });
  return owned;
}

export function createPlayerAvatar(options: PlayerAvatarOptions): PlayerAvatar {
  const { config } = options;
  const look = getAvatarAppearance(options.avatarKey);
  const root = new Group();
  root.name = AVATAR_ROOT_NAME;
  // The facing turns `root`; the model's own authored facing is corrected inside `facing`.
  const facing = new Group();
  facing.rotation.y = config.rotationOffset;
  root.add(facing);

  const ownedGeometries: BufferGeometry[] = [];
  const ownedMaterials: Material[] = [];
  let disposed = false;
  let source: 'placeholder' | 'model' = 'placeholder';
  let loadedRef: string | undefined;
  let attach: (slot: AttachmentSlot) => Object3D | undefined;

  const placeholder = buildPlaceholder(look, ownedGeometries, ownedMaterials);
  placeholder.scale.setScalar(config.scale);
  facing.add(placeholder);
  attach = (slot) => placeholder.getObjectByName(PLACEHOLDER_ATTACH[slot]);

  let animator: NpcAnimator = createNpcAnimator({
    root: placeholder,
    clips: [],
    animationMap: {},
    reducedMotion: options.reducedMotion,
  });
  let animation: PlayerAnimationController = createPlayerAnimationController(animator, {});

  function disposeOwned(): void {
    for (const geometry of ownedGeometries.splice(0)) geometry.dispose();
    for (const material of ownedMaterials.splice(0)) material.dispose();
  }

  function swapIn(loaded: LoadedModel, published: PlayerAvatarModel | null): void {
    const model = cloneAssetScene(loaded.scene);
    // A location costume keeps its own facing and scale; a published model adds its own.
    model.scale.multiplyScalar(config.scale * (published?.scale ?? 1));
    model.rotation.y += published?.rotationOffset ?? 0;
    const rootNames = new Set<string>([model.name, ...model.children.map((child) => child.name)]);
    const clips = withoutRootMotion(loaded.animations, rootNames);
    const playerMap = effectivePlayerAnimationMap(
      published?.animationMap ?? {},
      clips.map((clip) => clip.name),
    );
    const customization = published?.customization ?? NO_CUSTOMIZATION;
    animator.dispose();
    facing.remove(placeholder);
    disposeOwned();
    ownedMaterials.push(...applyAvatarColors(model, customization.colorMaterials, look));
    facing.add(model);
    animator = createNpcAnimator({
      root: model,
      clips,
      animationMap: toAnimatorMap(playerMap),
      reducedMotion: options.reducedMotion,
    });
    animation = createPlayerAnimationController(animator, playerMap);
    attach = (slot) => {
      const node = customization.attachPoints[slot];
      return node ? model.getObjectByName(node) : undefined;
    };
    source = 'model';
  }

  async function load(): Promise<void> {
    let published: PlayerAvatarModel | null = null;
    try {
      published = (await options.published) ?? null;
    } catch {
      published = null; // the answer failed: the placeholder stays
    }
    if (disposed || !options.loadModel) return;
    const ref = avatarAssetIdFor(options.avatarKey, config, options.assetIdFor, published);
    if (!ref) return;
    loadedRef = ref;
    try {
      const loaded = await options.loadModel(ref);
      if (disposed) return;
      // A location costume is not the published model: it gets none of its tuning.
      swapIn(loaded, config.assetKey ? null : published);
    } catch (error: unknown) {
      // The placeholder stays: a missing or broken avatar never stops play.
      console.warn(`[player avatar] could not load ${ref}; using the placeholder`, error);
    }
  }

  const ready = load();

  return {
    root,
    ready,
    source: () => source,
    loadedRef: () => loadedRef,
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
    celebrate() {
      if (!disposed) animation.celebrate();
    },
    attachPoint: (slot) => (disposed ? undefined : attach(slot)),
    dispose() {
      if (disposed) return;
      disposed = true;
      animator.dispose();
      root.parent?.remove(root);
      // Only what this avatar made (placeholder primitives, recoloured material copies): a
      // loaded model's geometry, textures and original materials belong to the shared cache.
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
