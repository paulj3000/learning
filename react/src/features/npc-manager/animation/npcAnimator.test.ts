import { AnimationClip, Group, NumberKeyframeTrack, Object3D } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { ANIMATION_PRIORITY } from '../contracts/vocabulary';
import {
  CROSSFADE_SECONDS,
  PROCEDURAL_ONE_SHOT_SECONDS,
  createNpcAnimator,
  type NpcAnimatorOptions,
} from './npcAnimator';

function clip(name: string, duration = 1): AnimationClip {
  return new AnimationClip(name, duration, [
    new NumberKeyframeTrack('Body.position[x]', [0, duration], [0, 1]),
  ]);
}

function model(): Object3D {
  const root = new Group();
  const body = new Object3D();
  body.name = 'Body';
  root.add(body);
  return root;
}

const CLIPS = [clip('Idle'), clip('Walk'), clip('Wave', 0.5), clip('Talk')];
const MAP = { idle: 'Idle', walk: 'Walk', wave: 'Wave', talk: 'Talk' } as const;

function setup(overrides: Partial<NpcAnimatorOptions> = {}) {
  const onFinished = vi.fn();
  const root = overrides.root ?? model();
  const animator = createNpcAnimator({
    root,
    clips: CLIPS,
    animationMap: MAP,
    reducedMotion: () => false,
    onFinished,
    ...overrides,
  });
  return { animator, onFinished, root };
}

/** Steps a fake clock in small frames, like a render loop. */
function run(animator: { update(dt: number): void }, seconds: number, frame = 1 / 30) {
  for (let t = 0; t < seconds - 1e-9; t += frame) animator.update(Math.min(frame, seconds - t));
}

describe('state to clip resolution', () => {
  it('uses the map, then the fallbacks, then idle', () => {
    const { animator } = setup();
    expect(animator.resolveClip('wave')?.name).toBe('Wave');
    expect(animator.resolveClip('point')?.name).toBe('Wave'); // point -> wave
    expect(animator.resolveClip('run')?.name).toBe('Walk'); // run -> walk
    expect(animator.resolveClip('laugh')?.name).toBe('Talk'); // laugh -> celebrate, talk
    expect(animator.resolveClip('sad')?.name).toBe('Idle');
  });

  it('ignores a map entry naming a clip the model does not have', () => {
    const { animator } = setup({ animationMap: { idle: 'Idle', wave: 'Missing' } });
    expect(animator.resolveClip('wave')?.name).toBe('Idle');
  });

  it('starts on the idle clip', () => {
    const { animator } = setup();
    expect(animator.snapshot()).toEqual({ base: 'idle', overlay: null, clip: 'Idle' });
  });
});

describe('base locomotion and overlays', () => {
  it('crossfades the base between locomotion states', () => {
    const { animator } = setup();
    run(animator, 0.5);
    animator.setBase('walk');
    expect(animator.snapshot().clip).toBe('Walk');
    run(animator, CROSSFADE_SECONDS / 2);
    // Mid crossfade both are weighted.
    animator.update(CROSSFADE_SECONDS);
    expect(animator.snapshot()).toMatchObject({ base: 'walk', clip: 'Walk' });
  });

  it('a one-shot returns to the base and reports animation finished', () => {
    const { animator, onFinished } = setup();
    expect(animator.play('wave', { priority: ANIMATION_PRIORITY.reaction })).toBe(true);
    expect(animator.snapshot()).toMatchObject({
      overlay: { state: 'wave', mode: 'once', priority: 1 },
      clip: 'Wave',
    });
    run(animator, 0.6);
    expect(onFinished).toHaveBeenCalledWith('wave');
    expect(animator.snapshot()).toMatchObject({ overlay: null, clip: 'Idle' });
  });

  it('returns to the current base, not the one when the overlay began', () => {
    const { animator } = setup();
    animator.play('wave');
    animator.setBase('walk');
    expect(animator.snapshot().clip).toBe('Wave');
    run(animator, 0.6);
    expect(animator.snapshot().clip).toBe('Walk');
  });

  it('a higher band preempts; a lower one is ignored while it plays', () => {
    const { animator, onFinished } = setup();
    animator.play('talk', { priority: ANIMATION_PRIORITY.dialogue });
    expect(animator.play('wave', { priority: ANIMATION_PRIORITY.reaction })).toBe(false);
    expect(animator.snapshot().overlay?.state).toBe('talk');
    expect(animator.play('wave', { priority: ANIMATION_PRIORITY.scripted })).toBe(true);
    expect(animator.snapshot().overlay).toMatchObject({ state: 'wave', priority: 3 });
    run(animator, 0.6);
    expect(onFinished).toHaveBeenCalledTimes(1);
    expect(animator.snapshot().overlay).toBeNull();
  });

  it('a behaviour-band request only changes the base', () => {
    const { animator } = setup();
    animator.play('talk');
    expect(animator.play('walk', { priority: ANIMATION_PRIORITY.behavior })).toBe(true);
    expect(animator.snapshot()).toMatchObject({ base: 'walk', overlay: { state: 'talk' } });
  });

  it('loops talk until its band is stopped; stopping another band does nothing', () => {
    const { animator, onFinished } = setup();
    animator.play('talk', { priority: ANIMATION_PRIORITY.dialogue });
    run(animator, 3);
    expect(animator.snapshot().overlay?.state).toBe('talk');
    animator.stop(ANIMATION_PRIORITY.reaction);
    expect(animator.snapshot().overlay?.state).toBe('talk');
    animator.stop(ANIMATION_PRIORITY.dialogue);
    expect(animator.snapshot()).toMatchObject({ overlay: null, clip: 'Idle' });
    expect(onFinished).not.toHaveBeenCalled();
  });

  it('stopping the behaviour band resets the base to idle', () => {
    const { animator } = setup();
    animator.setBase('walk');
    animator.stop(ANIMATION_PRIORITY.behavior);
    expect(animator.snapshot()).toMatchObject({ base: 'idle', clip: 'Idle' });
  });

  it('honours an explicit mode', () => {
    const { animator, onFinished } = setup();
    animator.play('wave', { mode: 'loop' });
    run(animator, 2);
    expect(animator.snapshot().overlay).toMatchObject({ state: 'wave', mode: 'loop' });
    expect(onFinished).not.toHaveBeenCalled();
  });

  it('repeating an identical request does not restart it', () => {
    const { animator, onFinished } = setup();
    animator.play('wave');
    run(animator, 0.3);
    animator.play('wave');
    run(animator, 0.25);
    expect(onFinished).toHaveBeenCalledTimes(1);
  });

  it('times a one-shot that falls back to the clip the base already plays', () => {
    const { animator, onFinished } = setup();
    animator.play('sad'); // sad -> idle, the base clip
    expect(animator.snapshot().clip).toBe('Idle');
    run(animator, 0.9);
    expect(onFinished).not.toHaveBeenCalled();
    run(animator, 0.2);
    expect(onFinished).toHaveBeenCalledWith('sad');
    expect(animator.snapshot().base).toBe('idle');
  });
});

describe('shared clips', () => {
  it('a one-shot sharing a clip with the next base leaves it looping, not clamped', () => {
    // run falls back to the Walk clip; the base then becomes walk while run plays once.
    const { animator, onFinished } = setup();
    animator.play('run', { mode: 'once', priority: ANIMATION_PRIORITY.reaction });
    animator.setBase('walk');
    run(animator, 1.1);
    expect(onFinished).toHaveBeenCalledWith('run');
    expect(animator.snapshot()).toMatchObject({ base: 'walk', overlay: null, clip: 'Walk' });
    run(animator, 2);
    expect(animator.snapshot().clip).toBe('Walk');
    expect(onFinished).toHaveBeenCalledTimes(1);
  });

  it('restarts a clip when a new one-shot resolves to the playing one', () => {
    const { animator, onFinished } = setup();
    animator.play('wave');
    run(animator, 0.4);
    animator.play('point'); // point -> Wave, the same clip: plays from the start again
    run(animator, 0.3);
    expect(onFinished).not.toHaveBeenCalled();
    run(animator, 0.3);
    expect(onFinished).toHaveBeenCalledWith('point');
  });
});

describe('models without clips', () => {
  it('bobs when the map names none of the model clips', () => {
    const { animator, root } = setup({ animationMap: { idle: 'Missing' } });
    expect(animator.snapshot().clip).toBeNull();
    run(animator, 0.4);
    expect(root.position.y).not.toBe(0);
  });

  it('bobs procedurally and still finishes one-shots on time', () => {
    const { animator, onFinished, root } = setup({ clips: [] });
    run(animator, 0.4);
    expect(root.position.y).not.toBe(0);
    animator.play('celebrate');
    expect(animator.snapshot().clip).toBeNull();
    run(animator, PROCEDURAL_ONE_SHOT_SECONDS + 0.05);
    expect(onFinished).toHaveBeenCalledWith('celebrate');
  });

  it('keeps still under reduced motion', () => {
    const { animator, onFinished, root } = setup({ clips: [], reducedMotion: () => true });
    animator.play('wave');
    run(animator, 1);
    expect(root.position.y).toBe(0);
    expect(onFinished).toHaveBeenCalledWith('wave');
  });
});

describe('dispose', () => {
  it('stops, uncaches and becomes a no-op', () => {
    const root = model();
    root.position.y = 0.5;
    const { animator, onFinished } = setup({ root, clips: [] });
    run(animator, 0.3);
    animator.play('wave');
    animator.dispose();
    animator.dispose();
    expect(root.position.y).toBe(0.5);
    run(animator, 2);
    expect(animator.play('wave')).toBe(false);
    expect(onFinished).not.toHaveBeenCalled();
  });

  it('releases clip actions', () => {
    const { animator } = setup();
    animator.play('wave');
    run(animator, 0.1);
    animator.dispose();
    expect(animator.snapshot()).toMatchObject({ overlay: null, clip: null });
  });
});
