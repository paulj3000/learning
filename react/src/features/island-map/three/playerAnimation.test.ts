import { describe, expect, it, vi } from 'vitest';
import { AnimationClip, QuaternionKeyframeTrack, VectorKeyframeTrack } from 'three';
import {
  createPlayerAnimationController,
  createPlayerAnimationDriver,
  playerAnimationMap,
  playerAnimationState,
  withoutRootMotion,
} from './playerAnimation';

const WITH_JUMP = { horizontalSpeed: 0, hasJumpClip: true };
const NO_JUMP = { horizontalSpeed: 0, hasJumpClip: false };

describe('player animation states (LAI-JMP-01)', () => {
  it('maps movement to the shared animation vocabulary', () => {
    expect(playerAnimationState('IDLE', WITH_JUMP)).toBe('idle');
    expect(playerAnimationState('WALK', WITH_JUMP)).toBe('walk');
    expect(playerAnimationState('JUMP_START', WITH_JUMP)).toBe('jump');
    expect(playerAnimationState('AIRBORNE', WITH_JUMP)).toBe('jump');
    expect(playerAnimationState('FALLING', WITH_JUMP)).toBe('jump');
    expect(playerAnimationState('LANDING', WITH_JUMP)).toBe('idle');
    expect(playerAnimationState('LANDING', { ...WITH_JUMP, horizontalSpeed: 3 })).toBe('walk');
  });

  it('keeps the ground clip for an avatar with no jump clip, never a celebration', () => {
    expect(playerAnimationState('JUMP_START', NO_JUMP)).toBe('idle');
    expect(playerAnimationState('FALLING', { ...NO_JUMP, horizontalSpeed: 3 })).toBe('walk');
  });

  it('drives the animator only when the state changes', () => {
    const setBase = vi.fn();
    const driver = createPlayerAnimationDriver({ setBase });
    driver.update('IDLE', WITH_JUMP);
    driver.update('IDLE', WITH_JUMP);
    driver.update('JUMP_START', WITH_JUMP);
    driver.update('AIRBORNE', WITH_JUMP);
    driver.update('LANDING', WITH_JUMP);
    expect(setBase.mock.calls.map(([state]) => state)).toEqual(['idle', 'jump', 'idle']);
  });
});

describe('player animation controller (LAI-JMP-01a)', () => {
  const target = () => ({ setBase: vi.fn(), play: vi.fn(() => true), setTimeScale: vi.fn() });

  it('maps GLB clip names onto player states by the standard names (LAI-JMP-01c)', () => {
    expect(playerAnimationMap(['Idle', 'Walk', 'Jump', 'Celebrate', 'Wave'])).toEqual({
      idle: 'Idle',
      walk: 'Walk',
      jump: 'Jump',
      interact: 'Wave',
      celebrate: 'Celebrate',
    });
    expect(playerAnimationMap([])).toEqual({});
  });

  it('plays the jump clip through jump start, airborne and falling, then lands back to idle', () => {
    const animator = target();
    const controller = createPlayerAnimationController(
      animator,
      playerAnimationMap(['Idle', 'Walk', 'Jump']),
    );
    for (const state of ['IDLE', 'JUMP_START', 'AIRBORNE', 'FALLING', 'LANDING', 'IDLE'] as const) {
      controller.update(state, 0, 4);
    }
    expect(animator.setBase.mock.calls.map(([s]) => s)).toEqual(['idle', 'jump', 'idle']);
  });

  it('keeps walking (no celebration) for an avatar with no jump clip', () => {
    const animator = target();
    const controller = createPlayerAnimationController(
      animator,
      playerAnimationMap(['Idle', 'Walk', 'Celebrate']),
    );
    controller.update('WALK', 4, 4);
    controller.update('JUMP_START', 4, 4);
    controller.update('FALLING', 4, 4);
    expect(animator.setBase.mock.calls.map(([s]) => s)).toEqual(['walk']);
  });

  it('slows the walk cycle when creeping and does not touch the mixer every frame', () => {
    const animator = target();
    const controller = createPlayerAnimationController(animator, playerAnimationMap(['Walk']));
    controller.update('WALK', 4, 4);
    controller.update('WALK', 4, 4);
    expect(animator.setTimeScale).not.toHaveBeenCalled();
    controller.update('WALK', 1, 4);
    expect(animator.setTimeScale).toHaveBeenLastCalledWith(0.6);
    controller.update('IDLE', 0, 4);
    expect(animator.setTimeScale).toHaveBeenLastCalledWith(1);
  });

  it('gestures on interact only where the avatar has a gesture clip', () => {
    const none = target();
    expect(createPlayerAnimationController(none, playerAnimationMap(['Idle'])).interact()).toBe(
      false,
    );
    expect(none.play).not.toHaveBeenCalled();
    const waving = target();
    createPlayerAnimationController(waving, playerAnimationMap(['Idle', 'Wave'])).interact();
    // Interact plays through the animator's `point` state, mapped to the avatar's Wave clip.
    expect(waving.play).toHaveBeenCalledWith('point', { mode: 'once', priority: 1 });
  });

  it('removes root motion but keeps bone animation', () => {
    const clip = new AnimationClip('Walk', 1, [
      new VectorKeyframeTrack('Root.position', [0, 1], [0, 0, 0, 0, 0, 1]),
      new VectorKeyframeTrack('Hips.position', [0, 1], [0, 1, 0, 0, 1.02, 0]),
      new QuaternionKeyframeTrack('Root.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]),
    ]);
    const [cleaned] = withoutRootMotion([clip], new Set(['Root']));
    expect(cleaned?.tracks.map((track) => track.name)).toEqual([
      'Hips.position',
      'Root.quaternion',
    ]);
    const untouched = new AnimationClip('Idle', 1, []);
    expect(withoutRootMotion([untouched], new Set(['Root']))[0]).toBe(untouched);
  });
});
