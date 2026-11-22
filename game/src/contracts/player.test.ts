import { createPlayerTransform, interpolatePlayerPosition, PLAYER_MOVEMENT_STATES } from './player';
import { NEUTRAL_ENVIRONMENT } from './physics';

describe('player transform contract', () => {
  it('starts idle and grounded at the given feet position', () => {
    const t = createPlayerTransform({ x: 1, y: 0, z: 2 }, 0.5);
    expect(t).toMatchObject({
      yaw: 0.5,
      grounded: true,
      state: 'IDLE',
      gait: 'idle',
      supportId: null,
    });
    expect(Object.isFrozen(t.position)).toBe(true);
  });

  it('interpolates between the previous and current step for rendering', () => {
    const t = {
      ...createPlayerTransform(),
      previousPosition: { x: 0, y: 0, z: 0 },
      position: { x: 2, y: 1, z: -2 },
    };
    expect(interpolatePlayerPosition(t, 0.5)).toEqual({ x: 1, y: 0.5, z: -1 });
    expect(interpolatePlayerPosition(t, 7)).toEqual({ x: 2, y: 1, z: -2 });
  });

  it('lists every movement state once', () => {
    expect(new Set(PLAYER_MOVEMENT_STATES).size).toBe(PLAYER_MOVEMENT_STATES.length);
  });

  it('has a neutral environment with normal ground and nothing else', () => {
    expect(NEUTRAL_ENVIRONMENT.surfaceAt(0, 0, 0)).toMatchObject({
      friction: 1,
      speedMultiplier: 1,
    });
    expect(NEUTRAL_ENVIRONMENT.forcesAt(0, 0, 0)).toEqual([]);
    expect(NEUTRAL_ENVIRONMENT.mediumAt(0, 0, 0)).toBe('AIR');
    expect(NEUTRAL_ENVIRONMENT.climbableAt(0, 0, 0)).toBeNull();
  });
});
