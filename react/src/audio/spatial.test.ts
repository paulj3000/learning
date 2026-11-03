import { describe, expect, it } from 'vitest';
import { distanceBetween, isVec3, resolveSpatial, spatialDefaultsProblem } from './spatial';

describe('spatial configuration', () => {
  it('accepts a sensible configuration and rejects each kind of bad value', () => {
    expect(spatialDefaultsProblem(undefined)).toBeUndefined();
    expect(spatialDefaultsProblem({ refDistance: 2, maxDistance: 25 })).toBeUndefined();
    expect(spatialDefaultsProblem({ refDistance: 0 })).toMatch(/refDistance/);
    expect(spatialDefaultsProblem({ refDistance: -1 })).toMatch(/refDistance/);
    expect(spatialDefaultsProblem({ maxDistance: NaN })).toMatch(/maxDistance/);
    expect(spatialDefaultsProblem({ refDistance: 30, maxDistance: 25 })).toMatch(/greater/);
    expect(spatialDefaultsProblem({ refDistance: 5, maxDistance: 5 })).toMatch(/greater/);
    expect(spatialDefaultsProblem({ rolloffFactor: -0.1 })).toMatch(/rolloff/);
    expect(spatialDefaultsProblem({ distanceModel: 'cubic' as never })).toMatch(/distanceModel/);
    expect(spatialDefaultsProblem({ coneInnerAngle: 400 })).toMatch(/coneInnerAngle/);
    expect(spatialDefaultsProblem({ coneInnerAngle: 90, coneOuterAngle: 45 })).toMatch(/Outer/);
    expect(spatialDefaultsProblem({ coneOuterGain: 2 })).toMatch(/coneOuterGain/);
  });

  it('recognises a position', () => {
    expect(isVec3([1, 2, 3])).toBe(true);
    expect(isVec3([1, 2])).toBe(false);
    expect(isVec3([1, NaN, 3])).toBe(false);
    expect(isVec3('x')).toBe(false);
  });

  it('measures distance in three dimensions', () => {
    expect(distanceBetween([0, 0, 0], [3, 4, 12])).toBe(13);
  });
});

describe('resolveSpatial', () => {
  it('is plain without play-time options, and when staff forbid positional playback', () => {
    expect(resolveSpatial({ enabled: true }, undefined)).toEqual({ kind: 'plain' });
    expect(resolveSpatial({ enabled: false }, { position: [1, 2, 3] })).toEqual({ kind: 'plain' });
  });

  it('fills the defaults and lets the game override staff distances', () => {
    const plain = resolveSpatial(undefined, { position: [1, 2, 3] });
    expect(plain).toMatchObject({
      kind: 'spatial',
      params: { refDistance: 2, maxDistance: 25, rolloffFactor: 1, distanceModel: 'inverse' },
    });
    const staff = resolveSpatial({ refDistance: 4, maxDistance: 40 }, { position: [0, 0, 0] });
    expect(staff).toMatchObject({ params: { refDistance: 4, maxDistance: 40 } });
    const game = resolveSpatial(
      { refDistance: 4, maxDistance: 40 },
      { position: [0, 0, 0], maxDistance: 10 },
    );
    expect(game).toMatchObject({ params: { refDistance: 4, maxDistance: 10 } });
  });

  it('reports a bad position or bad numbers instead of throwing', () => {
    expect(resolveSpatial(undefined, { position: [1, 2] as never })).toMatchObject({
      kind: 'invalid',
    });
    expect(resolveSpatial(undefined, { position: [0, 0, 0], refDistance: 0 })).toMatchObject({
      kind: 'invalid',
    });
    expect(
      resolveSpatial(undefined, { position: [0, 0, 0], orientation: ['x'] as never }),
    ).toMatchObject({ kind: 'invalid' });
  });

  it('gives a directional sound a default facing', () => {
    const result = resolveSpatial(undefined, {
      position: [0, 0, 0],
      coneInnerAngle: 60,
      coneOuterAngle: 180,
    });
    expect(result).toMatchObject({ params: { orientation: [0, 0, -1], coneOuterAngle: 180 } });
  });
});
