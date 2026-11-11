import { describe, expect, it } from 'vitest';
import type { BehaviorSpec } from '../contracts/types';
import { BEHAVIOR_DEFAULTS, parseReactions, resolveBehavior } from './parameters';

/** Deliberately malformed data, as a corrupt or hand-edited release might carry. */
function raw(type: string, parameters: unknown): BehaviorSpec {
  return { key: 'k', type, parameters } as unknown as BehaviorSpec;
}

describe('resolveBehavior (LAI-NPC-019 parameter parsing)', () => {
  it('resolves each type with the runtime_parameters defaults', () => {
    for (const type of [
      'stationary',
      'reactive',
      'wander',
      'patrol',
      'follow',
      'guide',
      'scripted',
    ]) {
      const r = resolveBehavior(raw(type, { boundsRadius: 15, reactions: {} }), 0, 0);
      expect(r.kind).toBe(type);
      expect(r.boundsRadius).toBe(15);
      expect(r.speed).toBe(BEHAVIOR_DEFAULTS.speed);
      expect(r.loop).toBe(true);
      expect(r.facePlayer).toBe(type === 'stationary');
    }
  });

  it('treats a null spec and an unknown type as stationary (null never faces the player)', () => {
    expect(resolveBehavior(null, 0, 0)).toMatchObject({ kind: 'stationary', facePlayer: false });
    expect(resolveBehavior(raw('teleport', {}), 0, 0)).toMatchObject({
      kind: 'stationary',
      facePlayer: true,
    });
  });

  it('offsets waypoints from home and clamps them into boundsRadius', () => {
    const r = resolveBehavior(
      raw('patrol', {
        boundsRadius: 5,
        speed: 2,
        waypoints: [
          { x: 3, z: 0, pauseSeconds: 2 },
          { x: 0, z: 50 },
        ],
      }),
      10,
      -5,
    );
    expect(r.points).toEqual([
      { x: 13, z: -5, pause: 2 },
      { x: 10, z: 0, pause: 0 },
    ]);
  });

  it('never throws on malformed data and drops what it cannot use', () => {
    const r = resolveBehavior(
      raw('scripted', {
        boundsRadius: 'far',
        speed: Number.POSITIVE_INFINITY,
        pauseSeconds: 'soon',
        waypoints: 'none',
        steps: [
          { action: 'moveTo', x: 1, z: Number.NaN },
          { action: 'play', state: 'moonwalk' },
          { action: 'explode' },
          null,
          { action: 'wait', seconds: 999 },
          { action: 'face', yaw: 1 },
        ],
        reactions: ['celebrate'],
      }),
      0,
      0,
    );
    expect(r.boundsRadius).toBe(BEHAVIOR_DEFAULTS.boundsRadius);
    expect(r.speed).toBe(BEHAVIOR_DEFAULTS.speed);
    expect([r.pauseMin, r.pauseMax]).toEqual([1, 3]);
    expect(r.points).toEqual([]);
    expect(r.steps).toEqual([
      { action: 'wait', seconds: 30 },
      { action: 'face', yaw: 1 },
    ]);
    expect(r.reactions).toEqual({});
    expect(() => resolveBehavior(raw('wander', null), 0, 0)).not.toThrow();
  });

  it('caps speed and keeps the wander radius and stop distance consistent', () => {
    const r = resolveBehavior(
      raw('follow', { speed: 40, stopDistance: 90, giveUpDistance: 10, radius: 99 }),
      0,
      0,
    );
    expect(r.speed).toBe(6);
    expect(r.stopDistance).toBe(10);
    expect(r.radius).toBe(BEHAVIOR_DEFAULTS.boundsRadius);
    const w = resolveBehavior(raw('wander', { pauseSeconds: [4, 2] }), 0, 0);
    expect([w.pauseMin, w.pauseMax]).toEqual([2, 4]);
  });

  it('keeps only known adventure event to animation state reactions', () => {
    expect(
      parseReactions({
        'treasure.found': 'celebrate',
        'answer.incorrect': 'cry',
        'made.up': 'wave',
      }),
    ).toEqual({ 'treasure.found': 'celebrate' });
    expect(parseReactions(null)).toEqual({});
  });
});
