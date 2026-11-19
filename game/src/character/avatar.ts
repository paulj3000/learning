/**
 * The avatar contract and controller (GE-030). Engine-side, pure of React, Django and the
 * child-profile and NPC features the island-map avatar (`playerAvatar.ts`) still imports.
 *
 * The avatar only *shows* the player. Its root is placed exactly at the interpolated canonical
 * `PlayerTransform` position and yaw every frame, and nothing it does (animation, equipment,
 * offsets) feeds back: that is the avatar-drift fix. The inner model carries the authored
 * scale, facing correction and footprint offset; the root carries only the transform.
 *
 * Assets load through an injected `AvatarLoaderPort` (the host's resolver and cache). Clips
 * lose their root motion (`rootMotion.ts`) so an animation can never carry the body anywhere.
 */

import {
  AnimationMixer,
  CapsuleGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  type AnimationClip,
  type BufferGeometry,
  type Material,
  type Object3D,
} from 'three';
import { interpolatePlayerPosition, type PlayerTransform, type Vec3Like } from '../contracts/player';
import { AnimationStateMachine, type AnimationMachineDefinition, type AnimationMap } from '../animation/animationStateMachine';
import { withoutRootMotionFor, type RootMotionOptions } from '../animation/rootMotion';
import { createThreeAnimationDriver, type ThreeAnimationDriver } from '../animation/threeAnimationDriver';
import { AVATAR_LIMITS } from '../camera/playerPresentation';
import { toControllerYaw, type YawConvention } from '../camera/yaw';
import { num, validateConfig } from '../camera/validation';
import { validationFailed, type ValidationResult } from '../core/errors';

export const AVATAR_SOCKETS = ['head', 'hand.left', 'hand.right', 'back'] as const;
export type AvatarSocket = (typeof AVATAR_SOCKETS)[number];

export const AVATAR_EYE_HEIGHT_LIMITS = Object.freeze({ min: 0.5, max: 2.2 });
export const FOOTPRINT_OFFSET_LIMIT = 0.5;

export interface AvatarDefinition {
  /** Semantic id of this avatar (`avatar.explorer`). */
  readonly id: string;
  /** The asset to load through the loader port. */
  readonly assetId: string;
  /** Uniform scale applied to the loaded model. */
  readonly scale: number;
  /** Radians added to the model's facing, for a model authored facing another way. */
  readonly rotationOffset: number;
  /** Eye height above the feet at scale 1, metres (first-person and the camera follow point). */
  readonly eyeHeight: number;
  /**
   * Where the model sits relative to the collision footprint centre, metres, in avatar space
   * (x right, z forward), so a model authored off-centre still stands inside its footprint.
   * The root itself is never offset.
   */
  readonly footprintOffset: Readonly<{ x: number; z: number }>;
  /** Role (`idle`, `walk`, `jump`...) to the model's own clip name. */
  readonly animationMap: AnimationMap;
  /** Equipment socket to the bone or node name in the model. */
  readonly sockets: Readonly<Partial<Record<AvatarSocket, string>>>;
}

/** The result of loading an avatar asset. */
export interface LoadedAvatarAsset {
  /** The model. The controller clones nothing: the loader port hands over a private copy. */
  readonly scene: Object3D;
  readonly animations: readonly AnimationClip[];
}

/** The host's asset resolver and cache, injected. Rejects when the asset cannot load. */
export interface AvatarLoaderPort {
  load(assetId: string): Promise<LoadedAvatarAsset>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validates an authored avatar definition. Never throws; unknown keys are issues. */
export function validateAvatarDefinition(input: unknown): ValidationResult<AvatarDefinition> {
  try {
    if (!isRecord(input)) {
      return validationFailed([{ path: '', message: 'must be an object' }]);
    }
    const { animationMap, sockets, footprintOffset, ...flat } = input;
    const issues: { path: string; message: string }[] = [];
    const base = validateConfig<{ id: string; assetId: string; scale: number; rotationOffset: number; eyeHeight: number }>(
      flat,
      { id: '', assetId: '', scale: 1, rotationOffset: 0, eyeHeight: 1.1 },
      {
        id: { kind: 'string' },
        assetId: { kind: 'string' },
        scale: num(AVATAR_LIMITS.scale),
        rotationOffset: num(AVATAR_LIMITS.rotationOffset),
        eyeHeight: num(AVATAR_EYE_HEIGHT_LIMITS),
      },
    );
    if (!base.ok) {
      issues.push(...base.issues);
    }
    if (flat.id === undefined) issues.push({ path: 'id', message: 'is required' });
    if (flat.assetId === undefined) issues.push({ path: 'assetId', message: 'is required' });

    const offset = { x: 0, z: 0 };
    if (footprintOffset !== undefined) {
      if (!isRecord(footprintOffset)) {
        issues.push({ path: 'footprintOffset', message: 'must be an object' });
      } else {
        for (const key of Object.keys(footprintOffset)) {
          const value = footprintOffset[key];
          if (key !== 'x' && key !== 'z') {
            issues.push({ path: `footprintOffset.${key}`, message: 'is not an offset axis' });
          } else if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > FOOTPRINT_OFFSET_LIMIT) {
            issues.push({ path: `footprintOffset.${key}`, message: `must be a number within ${FOOTPRINT_OFFSET_LIMIT}` });
          } else {
            offset[key] = value;
          }
        }
      }
    }

    const map: Record<string, string> = {};
    if (animationMap !== undefined) {
      if (!isRecord(animationMap)) {
        issues.push({ path: 'animationMap', message: 'must be an object' });
      } else {
        for (const [role, clip] of Object.entries(animationMap)) {
          if (typeof clip !== 'string' || clip.trim() === '') {
            issues.push({ path: `animationMap.${role}`, message: 'must be a clip name' });
          } else {
            map[role] = clip;
          }
        }
      }
    }

    const socketMap: Partial<Record<AvatarSocket, string>> = {};
    if (sockets !== undefined) {
      if (!isRecord(sockets)) {
        issues.push({ path: 'sockets', message: 'must be an object' });
      } else {
        for (const [socket, node] of Object.entries(sockets)) {
          if (!(AVATAR_SOCKETS as readonly string[]).includes(socket)) {
            issues.push({ path: `sockets.${socket}`, message: `is not a socket (${AVATAR_SOCKETS.join(', ')})` });
          } else if (typeof node !== 'string' || node.trim() === '') {
            issues.push({ path: `sockets.${socket}`, message: 'must be a bone or node name' });
          } else {
            socketMap[socket as AvatarSocket] = node;
          }
        }
      }
    }

    if (issues.length > 0 || !base.ok) {
      return validationFailed(issues);
    }
    return {
      ok: true,
      issues: [],
      value: Object.freeze({
        ...base.value,
        footprintOffset: Object.freeze(offset),
        animationMap: Object.freeze(map),
        sockets: Object.freeze(socketMap),
      }),
    };
  } catch (error) {
    return validationFailed([{ path: '', message: `could not be validated: ${error instanceof Error ? error.message : 'unknown error'}` }]);
  }
}

// --- facing --------------------------------------------------------------------------------

/** Shortest signed angle from `from` to `to`, radians. */
export function angleDelta(from: number, to: number): number {
  const twoPi = Math.PI * 2;
  let delta = (to - from) % twoPi;
  if (delta > Math.PI) delta -= twoPi;
  if (delta < -Math.PI) delta += twoPi;
  return delta;
}

const TURN_RATE = 12;
const FACING_MIN_SPEED = 0.3;

/**
 * Optional velocity-led facing: toward the **achieved** horizontal velocity, turned smoothly the
 * short way round; standing still keeps the last facing. Yaw is in the controller convention.
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
    if (Math.hypot(velocity.x, velocity.z) < FACING_MIN_SPEED) {
      return this.current;
    }
    const target = Math.atan2(velocity.x, velocity.z);
    this.current += angleDelta(this.current, target) * (1 - Math.exp(-TURN_RATE * dt));
    return this.current;
  }

  snap(yaw: number): void {
    this.current = yaw;
  }
}

// --- the follow rule -----------------------------------------------------------------------

export interface AvatarPlacement {
  readonly position: Vec3Like;
  /** Yaw in the controller convention (forward at 0 is +Z), what `root.rotation.y` takes. */
  readonly yaw: number;
}

/**
 * Where the avatar root goes this frame: exactly the interpolated canonical position and the
 * canonical yaw. This is the only placement rule; there is no independent avatar position.
 */
export function avatarPlacement(transform: PlayerTransform, alpha: number, convention: YawConvention = 'threejs'): AvatarPlacement {
  return { position: interpolatePlayerPosition(transform, alpha), yaw: toControllerYaw(transform.yaw, convention) };
}

// --- equipment -----------------------------------------------------------------------------

export interface EquipmentItem {
  /** Semantic id (`hat.captain`). */
  readonly id: string;
  readonly socket: AvatarSocket;
  /** The object to attach; its local transform is relative to the socket. */
  readonly object: Object3D;
}

/**
 * Equipment bookkeeping plus the Three.js attach: one item per socket, attached under the
 * socket's node (looked up by bone name). An item with no socket on this model is refused and
 * not recorded.
 */
export class AvatarEquipment {
  private readonly worn = new Map<AvatarSocket, EquipmentItem>();
  private resolveSocket: (socket: AvatarSocket) => Object3D | undefined;

  constructor(resolveSocket: (socket: AvatarSocket) => Object3D | undefined) {
    this.resolveSocket = resolveSocket;
  }

  /** Points at a new model's sockets (after a model swap) and re-attaches what is worn. */
  rebind(resolveSocket: (socket: AvatarSocket) => Object3D | undefined): void {
    this.resolveSocket = resolveSocket;
    for (const [socket, item] of this.worn) {
      item.object.parent?.remove(item.object);
      const node = resolveSocket(socket);
      if (node) {
        node.add(item.object);
      } else {
        this.worn.delete(socket);
      }
    }
  }

  /** Attaches an item, replacing whatever the socket held. Returns false with no such socket. */
  equip(item: EquipmentItem): boolean {
    const node = this.resolveSocket(item.socket);
    if (!node) {
      return false;
    }
    this.unequipSocket(item.socket);
    node.add(item.object);
    this.worn.set(item.socket, item);
    return true;
  }

  unequipSocket(socket: AvatarSocket): EquipmentItem | undefined {
    const item = this.worn.get(socket);
    if (item) {
      item.object.parent?.remove(item.object);
      this.worn.delete(socket);
    }
    return item;
  }

  unequip(id: string): EquipmentItem | undefined {
    for (const [socket, item] of this.worn) {
      if (item.id === id) {
        return this.unequipSocket(socket);
      }
    }
    return undefined;
  }

  itemAt(socket: AvatarSocket): EquipmentItem | undefined {
    return this.worn.get(socket);
  }

  items(): EquipmentItem[] {
    return [...this.worn.values()];
  }

  clear(): void {
    for (const socket of [...this.worn.keys()]) {
      this.unequipSocket(socket);
    }
  }
}

// --- the controller ------------------------------------------------------------------------

export interface AvatarControllerOptions {
  definition: AvatarDefinition;
  /** Absent: the placeholder only. */
  loader?: AvatarLoaderPort;
  yawConvention?: YawConvention;
  /** `'transform'` (default) faces the canonical yaw; `'velocity'` turns toward achieved velocity. */
  facing?: 'transform' | 'velocity';
  animationDefinition?: AnimationMachineDefinition;
  rootMotion?: RootMotionOptions;
}

export interface AvatarAnimationSpeeds {
  walkSpeed: number;
  runSpeed?: number;
}

export interface AvatarController {
  /** Add this to the scene. Its position is the feet; it is only ever set from the transform. */
  readonly root: Group;
  /** Settles once the model has loaded or failed (placeholder kept). Never rejects. */
  readonly ready: Promise<void>;
  readonly source: () => 'placeholder' | 'model';
  readonly equipment: AvatarEquipment;
  /** Places the root at the interpolated canonical transform and yaw. Once per frame. */
  follow(transform: PlayerTransform, alpha: number, deltaSeconds?: number): void;
  /** Drives the animation from the transform's movement state and achieved speed. */
  animate(deltaSeconds: number, transform: PlayerTransform, speeds: AvatarAnimationSpeeds): void;
  /** A one-shot gesture (`interact`, `celebrate`) if the model has the clip. */
  gesture(role: string): boolean;
  setVisible(visible: boolean): void;
  dispose(): void;
}

export const AVATAR_ROOT_NAME = 'player-avatar';
export const PLACEHOLDER_NAME = 'player-avatar:placeholder';

export function createAvatarController(options: AvatarControllerOptions): AvatarController {
  const { definition } = options;
  const convention = options.yawConvention ?? 'threejs';
  const root = new Group();
  root.name = AVATAR_ROOT_NAME;
  // The model sits in `inner`: authored facing correction, scale and footprint offset live
  // here, never on `root`.
  const inner = new Group();
  inner.rotation.y = definition.rotationOffset;
  inner.position.set(definition.footprintOffset.x, 0, definition.footprintOffset.z);
  root.add(inner);

  const ownedGeometries: BufferGeometry[] = [];
  const ownedMaterials: Material[] = [];
  let model: Object3D | null = null;
  let mixer: AnimationMixer | null = null;
  let driver: ThreeAnimationDriver | null = null;
  let machine: AnimationStateMachine | null = null;
  let clipByName = new Map<string, AnimationClip>();
  let disposed = false;
  let source: 'placeholder' | 'model' = 'placeholder';
  let facing: AvatarFacing | null = null;

  const placeholder = (() => {
    const height = Math.max(0.5, definition.eyeHeight * 0.9);
    const radius = Math.min(0.27, height * 0.2);
    const geometry = new CapsuleGeometry(radius, Math.max(0.05, height - radius * 2), 4, 12);
    const material = new MeshStandardMaterial({ color: 0x6aa6d8, roughness: 0.7 });
    ownedGeometries.push(geometry);
    ownedMaterials.push(material);
    const mesh = new Mesh(geometry, material);
    mesh.name = PLACEHOLDER_NAME;
    mesh.position.y = height / 2;
    mesh.scale.setScalar(definition.scale);
    inner.add(mesh);
    return mesh;
  })();

  const socketNode = (socket: AvatarSocket): Object3D | undefined => {
    const name = definition.sockets[socket];
    if (!model || !name) {
      return undefined;
    }
    return model.getObjectByName(name) ?? undefined;
  };
  const equipment = new AvatarEquipment(socketNode);

  const ready: Promise<void> = (async () => {
    if (!options.loader) {
      return;
    }
    try {
      const loaded = await options.loader.load(definition.assetId);
      if (disposed) {
        return;
      }
      model = loaded.scene;
      model.scale.multiplyScalar(definition.scale);
      const clips = withoutRootMotionFor(loaded.animations, model, options.rootMotion);
      clipByName = new Map(clips.map((clip) => [clip.name, clip]));
      inner.remove(placeholder);
      inner.add(model);
      mixer = new AnimationMixer(model);
      driver = createThreeAnimationDriver(mixer, clips);
      machine = new AnimationStateMachine(definition.animationMap, options.animationDefinition);
      source = 'model';
      equipment.rebind(socketNode);
    } catch {
      // The placeholder stays: a missing model never blocks play.
    }
  })();

  return {
    root,
    ready,
    source: () => source,
    equipment,
    follow(transform, alpha, deltaSeconds = 0) {
      if (disposed) {
        return;
      }
      const placement = avatarPlacement(transform, alpha, convention);
      root.position.set(placement.position.x, placement.position.y, placement.position.z);
      if (options.facing === 'velocity') {
        facing ??= new AvatarFacing(placement.yaw);
        root.rotation.y = facing.update(deltaSeconds, transform.velocity);
      } else {
        root.rotation.y = placement.yaw;
      }
    },
    animate(deltaSeconds, transform, speeds) {
      if (disposed || !machine || !driver) {
        return;
      }
      const frame = machine.update(
        { movement: transform.state, horizontalSpeed: Math.hypot(transform.velocity.x, transform.velocity.z), walkSpeed: speeds.walkSpeed, runSpeed: speeds.runSpeed },
        deltaSeconds,
      );
      driver.apply(frame);
      driver.update(deltaSeconds);
    },
    gesture(role) {
      if (disposed || !machine) {
        return false;
      }
      const clip = clipByName.get(definition.animationMap[role] ?? '');
      return clip ? machine.playGesture(role, clip.duration) : false;
    },
    setVisible(visible) {
      root.visible = visible;
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      equipment.clear();
      driver?.dispose();
      mixer?.stopAllAction();
      root.parent?.remove(root);
      // Only what this controller made: a loaded model belongs to the loader's cache.
      for (const geometry of ownedGeometries.splice(0)) geometry.dispose();
      for (const material of ownedMaterials.splice(0)) material.dispose();
    },
  };
}
