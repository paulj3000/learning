import { describe, expect, it, vi } from 'vitest';
import { createPlayerAnimationDriver, playerAnimationState } from './playerAnimation';

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
