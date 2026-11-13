import { describe, expect, it, vi } from 'vitest';
import { clipSpeed, createPlayerAnimationController, playerAnimationMap } from './playerAnimation';
import type { MovementState } from './firstPersonController';

const target = () => ({ setBase: vi.fn(), play: vi.fn(() => true), setTimeScale: vi.fn() });

/** Drives a sequence of (state, speed) and returns the animator states set. */
function drive(map: Record<string, string>, steps: [MovementState, number][]) {
  const animator = target();
  const controller = createPlayerAnimationController(animator, map);
  for (const [state, speed] of steps) controller.update(state, speed, 4, 5.5);
  return { states: animator.setBase.mock.calls.map(([s]) => s), animator };
}

const JOURNEY: [MovementState, number][] = [
  ['IDLE', 0],
  ['WALK', 3],
  ['RUN', 5.5],
  ['WALK', 4],
  ['RUN', 5.5],
  ['JUMP_START', 5.5],
  ['AIRBORNE', 5.5],
  ['FALLING', 5.5],
  ['LANDING', 5.5],
  ['RUN', 5.5],
  ['LANDING', 3],
  ['WALK', 3],
];

describe('player animation: running & sprinting', () => {
  it('plays Idle, Walk, Run, Jump, Fall, Land and back to Run with a full set of clips', () => {
    const { states } = drive(
      playerAnimationMap(['Idle', 'Walk', 'Run', 'Jump', 'Fall', 'Land']),
      JOURNEY,
    );
    expect(states).toEqual([
      'idle',
      'walk',
      'run',
      'walk',
      'run',
      'jump',
      'fall',
      'land',
      'run',
      'land',
      'walk',
    ]);
  });

  it('without a Run clip, running shows the walk cycle (never a gesture or celebration)', () => {
    const { states } = drive(
      playerAnimationMap(['Idle', 'Walk', 'Jump', 'Celebrate', 'Wave']),
      JOURNEY,
    );
    expect(states).toEqual(['idle', 'walk', 'jump', 'walk']);
    expect(states).not.toContain('celebrate');
  });

  it('plays a run clip at its speed, and a stand-in walk faster but bounded', () => {
    expect(clipSpeed('run', 5.5, 4, 5.5)).toBe(1);
    expect(clipSpeed('run', 6.5, 4, 5.5)).toBeCloseTo(6.5 / 5.5);
    expect(clipSpeed('run', 20, 4, 5.5)).toBe(1.3);
    expect(clipSpeed('walk', 4, 4, 5.5)).toBe(1);
    expect(clipSpeed('walk', 6.5, 4, 5.5)).toBeCloseTo(1.625);
    expect(clipSpeed('walk', 20, 4, 5.5)).toBe(1.7);
    expect(clipSpeed('walk', 4.1, 4, 5.5)).toBe(1.025);
    expect(clipSpeed('jump', 6.5, 4, 5.5)).toBe(1);
  });

  it('speeds the walk clip up when it stands in for a sprint', () => {
    const { animator } = drive(playerAnimationMap(['Idle', 'Walk']), [
      ['WALK', 4],
      ['SPRINT', 6.5],
    ]);
    expect(animator.setTimeScale).toHaveBeenLastCalledWith(1.625);
  });
});
