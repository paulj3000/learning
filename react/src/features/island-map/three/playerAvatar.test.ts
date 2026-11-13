import {
  AnimationClip,
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  NumberKeyframeTrack,
  VectorKeyframeTrack,
} from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  angleDelta,
  AvatarFacing,
  avatarAssetIdFor,
  createPlayerAvatar,
  meshesUnder,
  PLACEHOLDER_HEIGHT,
  PLACEHOLDER_NAME,
  PLAYER_AVATAR_ASSET_IDS,
} from './playerAvatar';
import { DEFAULT_PLAYER_AVATAR, resolvePlayerAvatar } from './playerPresentation';
import type { LoadedModel } from './runtime/extensionRegistry';

const FRAME = 1 / 60;

/** A tiny "GLB": one box, with the named clips (each just nudges a scale). */
function model(clipNames: string[]): LoadedModel {
  const scene = new Group();
  scene.name = 'Avatar';
  const body = new Mesh(new BoxGeometry(0.5, 1.4, 0.4), new MeshBasicMaterial());
  body.name = 'Body';
  scene.add(body);
  const animations = clipNames.map(
    (name) =>
      new AnimationClip(name, 1, [new NumberKeyframeTrack('Body.scale[y]', [0, 1], [1, 1.02])]),
  );
  return { scene, animations };
}

const avatarFor = (
  avatarKey: string | null,
  overrides = {},
  loadModel?: (id: string) => Promise<LoadedModel>,
) =>
  createPlayerAvatar({
    avatarKey,
    config: resolvePlayerAvatar(overrides),
    loadModel,
    reducedMotion: () => false,
    assetIdFor: (key) => (key === 'FOX' ? 'avatar-fox' : undefined),
  });

afterEach(() => vi.restoreAllMocks());

describe('player avatar (LAI-JMP-01a)', () => {
  it('ships no hard-coded avatar model: every avatar key falls back to the placeholder today', () => {
    expect(PLAYER_AVATAR_ASSET_IDS).toEqual({});
    expect(avatarAssetIdFor('FOX', DEFAULT_PLAYER_AVATAR)).toBeUndefined();
  });

  it('picks a location costume over the child’s registered model', () => {
    const registry = (key: string) => (key === 'FOX' ? 'avatar-fox' : undefined);
    expect(avatarAssetIdFor('FOX', { assetKey: 'costume' }, registry)).toBe('costume');
    expect(avatarAssetIdFor('FOX', {}, registry)).toBe('avatar-fox');
    expect(avatarAssetIdFor(null, {}, registry)).toBeUndefined();
  });

  it('draws a child-sized placeholder in the child’s avatar colours, feet on the ground', async () => {
    const avatar = avatarFor('OWL');
    await avatar.ready;
    expect(avatar.source()).toBe('placeholder');
    const placeholder = avatar.root.getObjectByName(PLACEHOLDER_NAME);
    expect(placeholder).toBeDefined();
    // OWL has ears; ROBOT has an antenna instead.
    expect(avatar.root.getObjectByName('ear-1')).toBeDefined();
    expect(avatarFor('ROBOT').root.getObjectByName('antenna')).toBeDefined();
    expect(PLACEHOLDER_HEIGHT).toBeLessThan(1.5);
  });

  it('draws an unknown or missing avatar key with the default look, never nothing', async () => {
    for (const key of [null, 'UNICORN']) {
      const avatar = avatarFor(key);
      await avatar.ready;
      expect(meshesUnder(avatar.root).length).toBeGreaterThan(4);
    }
  });

  it('loads the child’s model through the location’s loader and swaps it in', async () => {
    const loadModel = vi.fn(async () => model(['Idle', 'Walk', 'Jump']));
    const avatar = avatarFor('FOX', {}, loadModel);
    await avatar.ready;
    expect(loadModel).toHaveBeenCalledWith('avatar-fox');
    expect(avatar.source()).toBe('model');
    expect(avatar.root.getObjectByName(PLACEHOLDER_NAME)).toBeUndefined();
    expect(avatar.root.getObjectByName('Body')).toBeDefined();
  });

  it('keeps the placeholder when the model cannot be loaded', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const avatar = avatarFor('FOX', {}, async () => {
      throw new Error('404');
    });
    await expect(avatar.ready).resolves.toBeUndefined();
    expect(avatar.source()).toBe('placeholder');
    expect(avatar.root.getObjectByName(PLACEHOLDER_NAME)).toBeDefined();
  });

  it('applies the configured scale and facing offset', async () => {
    const avatar = avatarFor('FOX', { scale: 2, rotationOffset: Math.PI }, async () =>
      model(['Idle']),
    );
    await avatar.ready;
    expect(avatar.root.getObjectByName('Avatar')?.scale.x).toBe(2);
    expect(avatar.root.children[0]?.rotation.y).toBeCloseTo(Math.PI);
  });

  it('copies the controller’s feet position and the facing, nothing more', () => {
    const avatar = avatarFor('FOX');
    avatar.setPose({ x: 3, y: 0.8, z: -2 }, 1.2);
    expect(avatar.root.position.toArray()).toEqual([3, 0.8, -2]);
    expect(avatar.root.rotation.y).toBe(1.2);
    avatar.setVisible(false);
    expect(avatar.root.visible).toBe(false);
  });

  it('animates without throwing through every movement state, with or without clips', async () => {
    for (const clips of [[], ['Idle', 'Walk'], ['Idle', 'Walk', 'Jump', 'Wave']]) {
      const avatar = avatarFor('FOX', {}, async () => model(clips));
      await avatar.ready;
      for (const state of [
        'IDLE',
        'WALK',
        'JUMP_START',
        'AIRBORNE',
        'FALLING',
        'LANDING',
      ] as const) {
        expect(() => avatar.animate(FRAME, state, 2, 4)).not.toThrow();
      }
      expect(() => avatar.interact()).not.toThrow();
    }
  });

  it('frees its placeholder primitives on dispose, and leaves a loaded model’s cached geometry alone', async () => {
    const avatar = avatarFor('OWL');
    const parent = new Group();
    parent.add(avatar.root);
    const geometries = meshesUnder(avatar.root).map((mesh) => mesh.geometry);
    const disposed = geometries.map((geometry) => vi.spyOn(geometry, 'dispose'));
    avatar.dispose();
    expect(avatar.root.parent).toBeNull();
    for (const spy of disposed) expect(spy).toHaveBeenCalled();

    const cached = model(['Idle']);
    const cachedGeometry = (cached.scene.children[0] as Mesh).geometry;
    const keep = vi.spyOn(cachedGeometry, 'dispose');
    const loaded = avatarFor('FOX', {}, async () => cached);
    await loaded.ready;
    loaded.dispose();
    expect(keep).not.toHaveBeenCalled();
  });

  it('does not swap a model into an avatar disposed while it loaded', async () => {
    let release!: (value: LoadedModel) => void;
    const loading = vi.fn(() => new Promise<LoadedModel>((resolve) => (release = resolve)));
    const avatar = avatarFor('FOX', {}, loading);
    await vi.waitFor(() => expect(loading).toHaveBeenCalled());
    avatar.dispose();
    release(model(['Idle']));
    await avatar.ready;
    expect(avatar.source()).toBe('placeholder');
  });

  it('strips root motion from a loaded model’s clips', async () => {
    const withRootMotion = model([]);
    withRootMotion.animations = [
      new AnimationClip('Walk', 1, [
        new VectorKeyframeTrack('Avatar.position', [0, 1], [0, 0, 0, 0, 0, 2]),
        new NumberKeyframeTrack('Body.scale[y]', [0, 1], [1, 1.02]),
      ]),
    ];
    const avatar = avatarFor('FOX', {}, async () => withRootMotion);
    await avatar.ready;
    for (let i = 0; i < 60; i += 1) avatar.animate(FRAME, 'WALK', 4, 4);
    expect(avatar.root.getObjectByName('Avatar')?.position.z).toBe(0);
  });
});

describe('AvatarFacing', () => {
  it('turns smoothly toward where the player is going, the short way round', () => {
    const facing = new AvatarFacing(0);
    const first = facing.update(FRAME, { x: 4, z: 0 }); // heading +X: yaw PI/2
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(Math.PI / 2);
    for (let i = 0; i < 120; i += 1) facing.update(FRAME, { x: 4, z: 0 });
    expect(facing.yaw).toBeCloseTo(Math.PI / 2, 3);
  });

  it('faces the camera when walking toward it (moving back)', () => {
    const facing = new AvatarFacing(0);
    for (let i = 0; i < 240; i += 1) facing.update(FRAME, { x: 0, z: -4 });
    expect(Math.abs(angleDelta(facing.yaw, Math.PI))).toBeLessThan(1e-3);
  });

  it('keeps its facing when standing still', () => {
    const facing = new AvatarFacing(1);
    expect(facing.update(FRAME, { x: 0.05, z: 0 })).toBe(1);
  });

  it('takes the short way across the ±PI seam', () => {
    expect(angleDelta(3, -3)).toBeCloseTo(2 * Math.PI - 6, 6);
    expect(angleDelta(-3, 3)).toBeCloseTo(-(2 * Math.PI - 6), 6);
  });
});
