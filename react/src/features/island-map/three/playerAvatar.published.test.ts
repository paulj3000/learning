import {
  AnimationClip,
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  NumberKeyframeTrack,
  Object3D,
} from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAvatarAppearance } from '../avatarAppearance';
import { applyAvatarColors, createPlayerAvatar, PLACEHOLDER_NAME } from './playerAvatar';
import { createPlayerAnimationController } from './playerAnimation';
import type { PlayerAvatarModel } from './playerAvatarCatalog';
import { resolvePlayerAvatar } from './playerPresentation';
import type { LoadedModel } from './runtime/extensionRegistry';

/** LAI-JMP-01c: the avatar renderer with a model published in Django Admin. */

const FRAME = 1 / 60;

/** A tiny "GLB" with a named Fur material, a Head node and the given clips. */
function glb(clips: string[] = ['HeroIdle', 'Walk', 'Jump']): LoadedModel {
  const scene = new Group();
  scene.name = 'Hero';
  const body = new Mesh(
    new BoxGeometry(0.5, 1.3, 0.4),
    new MeshStandardMaterial({ name: 'Fur', color: 0x777777 }),
  );
  body.name = 'Body';
  const head = new Object3D();
  head.name = 'Head';
  body.add(head);
  scene.add(body);
  return {
    scene,
    animations: clips.map(
      (name) =>
        new AnimationClip(name, 1, [new NumberKeyframeTrack('Body.scale[y]', [0, 1], [1, 1.02])]),
    ),
  };
}

function published(overrides: Partial<PlayerAvatarModel> = {}): PlayerAvatarModel {
  return {
    ref: 'player-fox@2',
    assetId: 'player-fox',
    version: 2,
    clips: ['HeroIdle', 'Walk', 'Jump'],
    scale: 1.5,
    rotationOffset: Math.PI / 2,
    animationMap: { idle: 'HeroIdle', walk: 'Walk', jump: 'Jump' },
    customization: { colorMaterials: { Fur: 'body' }, attachPoints: { head: 'Head' } },
    ...overrides,
  };
}

function avatarWith(
  options: {
    model?: PlayerAvatarModel | null | Promise<PlayerAvatarModel | null>;
    loadModel?: (ref: string) => Promise<LoadedModel>;
    config?: Parameters<typeof resolvePlayerAvatar>[0];
    avatarKey?: string;
  } = {},
) {
  return createPlayerAvatar({
    avatarKey: options.avatarKey ?? 'FOX',
    config: resolvePlayerAvatar(options.config ?? {}),
    published: options.model,
    loadModel: options.loadModel ?? (async () => glb()),
    reducedMotion: () => false,
    assetIdFor: () => undefined,
  });
}

afterEach(() => vi.restoreAllMocks());

describe('the published avatar model (LAI-JMP-01c)', () => {
  it('loads the published reference (a pinned version) and shows it', async () => {
    const loadModel = vi.fn(async () => glb());
    const avatar = avatarWith({ model: published(), loadModel });
    await avatar.ready;
    expect(loadModel).toHaveBeenCalledWith('player-fox@2');
    expect(avatar.source()).toBe('model');
    expect(avatar.loadedRef()).toBe('player-fox@2');
    expect(avatar.root.getObjectByName(PLACEHOLDER_NAME)).toBeUndefined();
  });

  it('applies the published scale and facing on top of the location’s', async () => {
    const avatar = avatarWith({ model: published(), config: { scale: 2 } });
    await avatar.ready;
    const hero = avatar.root.getObjectByName('Hero')!;
    expect(hero.scale.x).toBeCloseTo(3);
    expect(hero.rotation.y).toBeCloseTo(Math.PI / 2);
  });

  it('shows the placeholder until a slow answer arrives, then swaps', async () => {
    let answer!: (model: PlayerAvatarModel) => void;
    const avatar = avatarWith({ model: new Promise((resolve) => (answer = resolve)) });
    expect(avatar.source()).toBe('placeholder');
    avatar.animate(FRAME, 'IDLE', 0, 4); // the scene runs meanwhile
    answer(published());
    await avatar.ready;
    expect(avatar.source()).toBe('model');
  });

  it('keeps the placeholder when there is no published model, the answer fails, or the GLB fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const loadModel = vi.fn(async () => glb());
    const none = avatarWith({ model: null, loadModel });
    await none.ready;
    expect(none.source()).toBe('placeholder');
    expect(loadModel).not.toHaveBeenCalled();

    const failedAnswer = avatarWith({ model: Promise.reject(new Error('down')) });
    await failedAnswer.ready;
    expect(failedAnswer.source()).toBe('placeholder');

    const brokenFile = avatarWith({
      model: published(),
      loadModel: async () => {
        throw new Error('not a GLB');
      },
    });
    await brokenFile.ready;
    expect(brokenFile.source()).toBe('placeholder');
  });

  it('lets a location costume win, without the published tuning', async () => {
    const loadModel = vi.fn(async () => glb());
    const avatar = avatarWith({
      model: published(),
      loadModel,
      config: { assetKey: 'costume-pirate' },
    });
    await avatar.ready;
    expect(loadModel).toHaveBeenCalledWith('costume-pirate');
    expect(avatar.root.getObjectByName('Hero')!.scale.x).toBeCloseTo(1);
  });

  it('gives named materials the child’s colours on a copy, never on the shared cached model', async () => {
    const cached = glb();
    const original = (cached.scene.getObjectByName('Body') as Mesh)
      .material as MeshStandardMaterial;
    const fox = avatarWith({ model: published(), loadModel: async () => cached, avatarKey: 'FOX' });
    const robot = avatarWith({
      model: published(),
      loadModel: async () => cached,
      avatarKey: 'ROBOT',
    });
    await Promise.all([fox.ready, robot.ready]);
    const furOf = (avatar: typeof fox) =>
      (
        (avatar.root.getObjectByName('Body') as Mesh).material as MeshStandardMaterial
      ).color.getHex();
    expect(furOf(fox)).toBe(getAvatarAppearance('FOX').body);
    expect(furOf(robot)).toBe(getAvatarAppearance('ROBOT').body);
    expect(original.color.getHex()).toBe(0x777777);

    const copy = (fox.root.getObjectByName('Body') as Mesh).material as MeshStandardMaterial;
    const disposeCopy = vi.spyOn(copy, 'dispose');
    const disposeOriginal = vi.spyOn(original, 'dispose');
    fox.dispose();
    expect(disposeCopy).toHaveBeenCalled();
    expect(disposeOriginal).not.toHaveBeenCalled();
  });

  it('leaves materials alone when the avatar names none', () => {
    const model = glb().scene;
    expect(applyAvatarColors(model, {}, getAvatarAppearance('FOX'))).toEqual([]);
  });

  it('finds attachment points on the model, and stand-ins on the placeholder', async () => {
    const placeholder = avatarWith({ model: null });
    expect(placeholder.attachPoint('head')?.name).toBe('head');
    const avatar = avatarWith({ model: published() });
    await avatar.ready;
    expect(avatar.attachPoint('head')?.name).toBe('Head');
    expect(avatar.attachPoint('back')).toBeUndefined();
    avatar.dispose();
    expect(avatar.attachPoint('head')).toBeUndefined();
  });

  it('animates every state with the published clips, and celebrates or gestures only with a clip', async () => {
    const avatar = avatarWith({
      model: published({ clips: ['HeroIdle'], animationMap: { idle: 'HeroIdle' } }),
      loadModel: async () => glb(['HeroIdle']),
    });
    await avatar.ready;
    for (const state of ['IDLE', 'WALK', 'JUMP_START', 'AIRBORNE', 'FALLING', 'LANDING'] as const) {
      expect(() => avatar.animate(FRAME, state, 2, 4)).not.toThrow();
    }
    expect(() => avatar.celebrate()).not.toThrow();
    expect(() => avatar.interact()).not.toThrow();
  });
});

describe('player animation with fall, land and celebrate clips (LAI-JMP-01c)', () => {
  const target = () => ({ setBase: vi.fn(), play: vi.fn(() => true), setTimeScale: vi.fn() });

  it('plays fall while falling and land on landing, when the avatar has them', () => {
    const animator = target();
    const controller = createPlayerAnimationController(animator, {
      idle: 'Idle',
      jump: 'Jump',
      fall: 'Fall',
      land: 'Land',
    });
    for (const state of ['IDLE', 'JUMP_START', 'AIRBORNE', 'FALLING', 'LANDING', 'IDLE'] as const) {
      controller.update(state, 0, 4);
    }
    expect(animator.setBase.mock.calls.map(([s]) => s)).toEqual([
      'idle',
      'jump',
      'fall',
      'land',
      'idle',
    ]);
  });

  it('falls with the jump clip when there is no fall clip, and lands straight to idle', () => {
    const animator = target();
    const controller = createPlayerAnimationController(animator, { idle: 'Idle', jump: 'Jump' });
    for (const state of ['IDLE', 'FALLING', 'LANDING'] as const) controller.update(state, 0, 4);
    expect(animator.setBase.mock.calls.map(([s]) => s)).toEqual(['idle', 'jump', 'idle']);
  });

  it('celebrates only with a Celebrate clip', () => {
    const without = target();
    expect(createPlayerAnimationController(without, { idle: 'Idle' }).celebrate()).toBe(false);
    expect(without.play).not.toHaveBeenCalled();
    const withClip = target();
    expect(createPlayerAnimationController(withClip, { celebrate: 'Celebrate' }).celebrate()).toBe(
      true,
    );
    expect(withClip.play).toHaveBeenCalledWith('celebrate', { mode: 'once', priority: 1 });
  });
});
