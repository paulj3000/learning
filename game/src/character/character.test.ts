import { AnimationClip, Bone, Group, Mesh, Object3D, VectorKeyframeTrack } from 'three';
import { describe, expect, it } from 'vitest';
import { createCapabilityRegistry } from '../core/capabilities';
import { createEntityWorld } from '../core/entities';
import { createSystemScheduler } from '../core/systems';
import {
  createPlayerTransform,
  PLAYER_ENTITY_ID,
  PlayerTransformComponent,
  type PlayerTransform,
} from '../contracts/player';
import { CameraRig } from '../camera/cameraRig';
import { createCameraSystem } from '../camera/cameraSystem';
import {
  angleDelta,
  AvatarEquipment,
  AvatarFacing,
  avatarPlacement,
  createAvatarController,
  validateAvatarDefinition,
  type AvatarDefinition,
  type AvatarLoaderPort,
} from './avatar';
import { createAvatarFollowSystem } from './avatarSystem';
import {
  animationDefinitionFromConfig,
  characterAnimationCapability,
  characterAvatarCapability,
  registerCharacterCapabilities,
} from './capabilities';

const definition: AvatarDefinition = {
  id: 'avatar.explorer',
  assetId: 'asset.explorer',
  scale: 1,
  rotationOffset: 0,
  eyeHeight: 1.1,
  footprintOffset: { x: 0, z: 0 },
  animationMap: { idle: 'Idle', walk: 'Walk', jump: 'Jump' },
  sockets: { head: 'HeadTop', 'hand.right': 'HandR', back: 'Spine' },
};

function transformAt(x: number, y: number, z: number, patch: Partial<PlayerTransform> = {}): PlayerTransform {
  return { ...createPlayerTransform({ x, y, z }, 0), ...patch };
}

/** Scene > Armature > Hips > Spine > HeadTop and HandR, with a walk clip that travels. */
function rigAsset() {
  const scene = new Group();
  scene.name = 'Scene';
  const armature = new Object3D();
  armature.name = 'Armature';
  const hips = new Bone();
  hips.name = 'Hips';
  hips.position.set(0, 1, 0);
  const spine = new Bone();
  spine.name = 'Spine';
  const head = new Bone();
  head.name = 'HeadTop';
  const hand = new Bone();
  hand.name = 'HandR';
  spine.add(head, hand);
  hips.add(spine);
  armature.add(hips);
  scene.add(armature, new Mesh());
  const walk = new AnimationClip('Walk', 1, [new VectorKeyframeTrack('Hips.position', [0, 1], [0, 1, 0, 0, 1, 5])]);
  const idle = new AnimationClip('Idle', 1, [new VectorKeyframeTrack('Spine.position', [0, 1], [0, 0, 0, 0, 0.1, 0])]);
  return { scene, animations: [walk, idle] };
}

const loader: AvatarLoaderPort = { load: async () => rigAsset() };

describe('avatar placement (the avatar mirrors the canonical transform)', () => {
  it('is exactly the interpolated position and yaw, nothing else', () => {
    const base = createPlayerTransform({ x: 0, y: 0, z: 0 }, 0);
    const t: PlayerTransform = { ...base, previousPosition: { x: 0, y: 0, z: 0 }, position: { x: 4, y: 2, z: -2 }, yaw: 0.5 };
    const placement = avatarPlacement(t, 0.25, 'controller');
    expect(placement.position).toEqual({ x: 1, y: 0.5, z: -0.5 });
    expect(placement.yaw).toBe(0.5);
    expect(avatarPlacement(t, 0, 'threejs').yaw).toBeCloseTo(0.5 + Math.PI);
  });

  it('follow sets the root and leaves the model offset inside it', async () => {
    const controller = createAvatarController({
      definition: { ...definition, footprintOffset: { x: 0.2, z: -0.1 }, rotationOffset: 1 },
      loader,
      yawConvention: 'threejs',
    });
    await controller.ready;
    controller.follow(transformAt(3, 1, 4, { yaw: 0.3 }), 1);
    expect(controller.root.position.toArray()).toEqual([3, 1, 4]);
    expect(controller.root.rotation.y).toBeCloseTo(0.3 + Math.PI);
    const inner = controller.root.children[0]!;
    expect(inner.position.x).toBeCloseTo(0.2);
    expect(inner.position.z).toBeCloseTo(-0.1);
    expect(inner.rotation.y).toBe(1);
  });

  it('does not drift when blocked: a walk animation never moves the root', async () => {
    const controller = createAvatarController({ definition, loader, yawConvention: 'controller' });
    await controller.ready;
    expect(controller.source()).toBe('model');
    const blocked = transformAt(5, 0, 5, { state: 'WALK', velocity: { x: 0, y: 0, z: 0 } });
    for (let i = 0; i < 120; i += 1) {
      controller.follow(blocked, 1, 1 / 60);
      controller.animate(1 / 60, blocked, { walkSpeed: 2 });
    }
    expect(controller.root.position.toArray()).toEqual([5, 0, 5]);
  });

  it('strips the hips travel from the loaded clips', async () => {
    const asset = rigAsset();
    const controller = createAvatarController({ definition, loader: { load: async () => asset }, yawConvention: 'controller' });
    await controller.ready;
    controller.animate(0.1, transformAt(0, 0, 0, { state: 'WALK', velocity: { x: 2, y: 0, z: 0 } }), { walkSpeed: 2 });
    // The loaded clip is untouched (it belongs to the cache); the driver got a corrected copy.
    expect(asset.animations[0]!.tracks[0]!.values[5]).toBe(5);
    const hips = asset.scene.getObjectByName('Hips')!;
    expect(hips.position.z).toBe(0);
  });

  it('keeps a placeholder when the model fails to load, and never rejects', async () => {
    const controller = createAvatarController({ definition, loader: { load: async () => Promise.reject(new Error('404')) } });
    await expect(controller.ready).resolves.toBeUndefined();
    expect(controller.source()).toBe('placeholder');
    expect(controller.root.getObjectByName('player-avatar:placeholder')).toBeDefined();
    controller.animate(0.1, transformAt(0, 0, 0), { walkSpeed: 2 });
    expect(controller.gesture('celebrate')).toBe(false);
  });

  it('ignores a model that arrives after dispose', async () => {
    let release!: () => void;
    const slow: AvatarLoaderPort = { load: () => new Promise((resolve) => (release = () => resolve(rigAsset()))) };
    const controller = createAvatarController({ definition, loader: slow });
    controller.dispose();
    release();
    await controller.ready;
    expect(controller.source()).toBe('placeholder');
    controller.follow(transformAt(1, 1, 1), 1);
    expect(controller.root.position.toArray()).toEqual([0, 0, 0]);
  });

  it('faces the achieved velocity when asked, the short way round', () => {
    expect(angleDelta(3, -3)).toBeCloseTo(2 * Math.PI - 6);
    const facing = new AvatarFacing(0);
    expect(facing.update(1, { x: 0, z: 0 })).toBe(0);
    for (let i = 0; i < 100; i += 1) facing.update(0.05, { x: 3, z: 0 });
    expect(facing.yaw).toBeCloseTo(Math.PI / 2, 2);
  });
});

describe('equipment', () => {
  it('attaches to the named socket bone, replaces, detaches and records', async () => {
    const controller = createAvatarController({ definition, loader });
    await controller.ready;
    const hat = new Object3D();
    const crown = new Object3D();
    expect(controller.equipment.equip({ id: 'hat.cap', socket: 'head', object: hat })).toBe(true);
    expect(hat.parent?.name).toBe('HeadTop');
    expect(controller.equipment.equip({ id: 'hat.crown', socket: 'head', object: crown })).toBe(true);
    expect(hat.parent).toBeNull();
    expect(controller.equipment.items().map((i) => i.id)).toEqual(['hat.crown']);
    expect(controller.equipment.unequip('hat.crown')?.object).toBe(crown);
    expect(crown.parent).toBeNull();
    expect(controller.equipment.items()).toEqual([]);
  });

  it('refuses a socket the model does not have, and records nothing', async () => {
    const controller = createAvatarController({ definition, loader });
    await controller.ready;
    const glove = new Object3D();
    expect(controller.equipment.equip({ id: 'glove', socket: 'hand.left', object: glove })).toBe(false);
    expect(controller.equipment.items()).toEqual([]);
  });

  it('re-attaches worn items after a model swap and drops those without a socket', () => {
    const a = new Object3D();
    a.name = 'A';
    const b = new Object3D();
    b.name = 'B';
    const equipment = new AvatarEquipment((s) => (s === 'head' ? a : undefined));
    const hat = new Object3D();
    equipment.equip({ id: 'hat', socket: 'head', object: hat });
    equipment.rebind((s) => (s === 'head' ? b : undefined));
    expect(hat.parent).toBe(b);
    equipment.rebind(() => undefined);
    expect(equipment.items()).toEqual([]);
  });
});

describe('avatar definition validation', () => {
  it('accepts a good definition and freezes the result', () => {
    const result = validateAvatarDefinition({ id: 'a.b', assetId: 'x', scale: 1.2, sockets: { head: 'Head' }, animationMap: { idle: 'Idle' }, footprintOffset: { x: 0.1 } });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.footprintOffset).toEqual({ x: 0.1, z: 0 });
      expect(Object.isFrozen(result.value)).toBe(true);
    }
  });

  it('reports the missing, the out of range and the unknown', () => {
    const result = validateAvatarDefinition({ scale: 99, eyeHeight: 0, sockets: { tail: 'T', head: '' }, animationMap: { idle: 4 }, footprintOffset: { y: 1, x: 9 }, extra: true });
    expect(result.ok).toBe(false);
    const paths = result.issues.map((i) => i.path);
    for (const expected of ['id', 'assetId', 'scale', 'eyeHeight', 'sockets.tail', 'sockets.head', 'animationMap.idle', 'footprintOffset.y', 'footprintOffset.x', 'extra']) {
      expect(paths).toContain(expected);
    }
  });

  it('never throws', () => {
    for (const input of [null, undefined, 3, 'x', [], { sockets: null }, { animationMap: [] }, Object.create(null)]) {
      expect(() => validateAvatarDefinition(input)).not.toThrow();
      expect(validateAvatarDefinition(input).ok).toBe(false);
    }
  });
});

describe('character capabilities', () => {
  it('register, resolve and require the avatar for animation', () => {
    const registry = createCapabilityRegistry();
    registerCharacterCapabilities(registry);
    const resolution = registry.resolve([{ id: 'character.animation' }]);
    expect(resolution.ok).toBe(true);
    expect(resolution.order.map((r) => r.definition.id)).toEqual(['character.avatar', 'character.animation']);
  });

  it('validates limits, unknown keys and enums without throwing', () => {
    expect(characterAvatarCapability.validate({ scale: 0.1 }).ok).toBe(false);
    expect(characterAvatarCapability.validate({ scale: 6 }).ok).toBe(false);
    expect(characterAvatarCapability.validate({ scale: 2, facing: 'velocity' }).ok).toBe(true);
    expect(characterAvatarCapability.validate({ facing: 'spin' }).ok).toBe(false);
    expect(characterAvatarCapability.validate({ assetKey: '' }).ok).toBe(false);
    expect(characterAvatarCapability.validate({ colour: 'red' }).issues[0]?.path).toBe('colour');
    expect(characterAnimationCapability.validate({ defaultFade: 5 }).ok).toBe(false);
    for (const input of [null, 4, [], 'x']) {
      expect(() => characterAvatarCapability.validate(input)).not.toThrow();
      expect(() => characterAnimationCapability.validate(input)).not.toThrow();
    }
  });

  it('turns a resolved animation config into a machine definition', () => {
    expect(animationDefinitionFromConfig({ defaultFade: 0.5 }).defaultFade).toBe(0.5);
  });
});

describe('avatar and camera systems on the shared transform', () => {
  it('both read the player entity through the scheduler, avatar first', async () => {
    const world = createEntityWorld();
    const player = world.create(PLAYER_ENTITY_ID);
    world.add(player, PlayerTransformComponent, transformAt(2, 0, 3, { yaw: 0 }));
    const controller = createAvatarController({ definition, loader, yawConvention: 'threejs' });
    await controller.ready;
    const rig = new CameraRig({ config: { defaultMode: 'first-person' } });
    const order: string[] = [];
    const frames: number[] = [];
    const scheduler = createSystemScheduler();
    scheduler.add(createCameraSystem({ world, rig, onFrame: (f) => { order.push('camera'); frames.push(f.position.x); } }));
    scheduler.add(createAvatarFollowSystem({ world, avatar: controller, speeds: () => ({ walkSpeed: 2 }) }));
    scheduler.runFrame({ frameSeconds: 1 / 60, alpha: 1, time: 0 });
    expect(controller.root.position.toArray()).toEqual([2, 0, 3]);
    expect(frames[0]).toBeCloseTo(2);
    expect(scheduler.ids('presentation')).toEqual(['character.avatarFollow', 'camera.rig']);
    scheduler.disposeAll();
    expect(controller.root.parent).toBeNull();
  });

  it('does nothing when the player entity has no transform yet', () => {
    const world = createEntityWorld();
    const controller = createAvatarController({ definition });
    const scheduler = createSystemScheduler();
    scheduler.add(createAvatarFollowSystem({ world, avatar: controller, speeds: () => ({ walkSpeed: 2 }) }));
    expect(() => scheduler.runFrame({ frameSeconds: 1 / 60, alpha: 1, time: 0 })).not.toThrow();
    expect(controller.root.position.toArray()).toEqual([0, 0, 0]);
  });
});
