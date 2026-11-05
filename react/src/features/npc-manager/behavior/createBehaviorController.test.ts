import { describe, expect, it } from 'vitest';
import type {
  BehaviorControllerArgs,
  BehaviorControllerFactory,
  NpcEngineEvent,
  PlayerPose,
} from '../contracts/engine';
import type { BehaviorParameters, BehaviorSpec } from '../contracts/types';
import type { BehaviorType } from '../contracts/vocabulary';
import { isBlockedByRects } from './collision';
import { MAX_DELTA_SECONDS, REACTION_SECONDS, RUN_SPEED_THRESHOLD, TURN_RATE } from './constants';
import {
  behaviorControllerFactory,
  createBehaviorController,
  locomotionFor,
  type NpcBehaviorController,
  type NpcBehaviorFrame,
} from './createBehaviorController';

const HOME = { x: 10, z: -5, yaw: 0.5 };

function spec(type: BehaviorType, parameters: Partial<BehaviorParameters> = {}): BehaviorSpec {
  return {
    key: `${type}-test`,
    type,
    parameters: { boundsRadius: 15, reactions: {}, ...parameters },
  };
}

function controller(
  s: BehaviorSpec | null,
  extra: Partial<BehaviorControllerArgs> = {},
): NpcBehaviorController {
  return createBehaviorController({ placementKey: 'spot', spec: s, home: HOME, ...extra });
}

/** A seeded linear congruential generator in [0, 1). */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

interface Run {
  frames: NpcBehaviorFrame[];
  events: NpcEngineEvent[];
  last: NpcBehaviorFrame;
}

/** Advances a fake clock: `steps` is a list of frame durations (seconds). */
function runSteps(
  c: NpcBehaviorController,
  steps: number[],
  player: PlayerPose | null | ((t: number) => PlayerPose | null) = null,
): Run {
  const frames: NpcBehaviorFrame[] = [];
  let t = 0;
  for (const dt of steps) {
    t += dt;
    frames.push(c.update(dt, typeof player === 'function' ? player(t) : player));
  }
  return { frames, events: frames.flatMap((f) => f.events), last: frames[frames.length - 1] };
}

function run(c: NpcBehaviorController, seconds: number, dt = 1 / 60, player?: PlayerPose | null) {
  const n = Math.round(seconds / dt);
  return runSteps(
    c,
    Array.from({ length: n }, () => dt),
    player ?? null,
  );
}

const states = (events: NpcEngineEvent[]) =>
  events.flatMap((e) => (e.type === 'npc.behavior_changed' ? [e.state] : []));
const reachedIndexes = (events: NpcEngineEvent[]) =>
  events.flatMap((e) => (e.type === 'npc.waypoint_reached' ? [e.index] : []));

const distFromHome = (f: { x: number; z: number }) => Math.hypot(f.x - HOME.x, f.z - HOME.z);

describe('createBehaviorController (LAI-NPC-019)', () => {
  it('is the contract factory', () => {
    const factory: BehaviorControllerFactory = behaviorControllerFactory;
    expect(factory({ placementKey: 'a', spec: null, home: HOME }).state()).toBe('idle');
  });

  it('spec null: stationary at home facing home.yaw, never turning to the player', () => {
    const c = controller(null);
    const { last, events } = run(c, 2, 1 / 60, { x: HOME.x + 2, z: HOME.z });
    expect(last).toMatchObject({ x: HOME.x, z: HOME.z, yaw: HOME.yaw, locomotion: 'idle' });
    expect(events).toEqual([]);
    expect(c.state()).toBe('idle');
  });

  it('stationary with facePlayer turns toward a nearby player at a bounded rate, then back', () => {
    const c = controller(spec('stationary', { facePlayer: true }));
    const player = { x: HOME.x - 3, z: HOME.z }; // yaw -PI/2 from home
    const first = c.update(0.05, player);
    expect(Math.abs(first.yaw - HOME.yaw)).toBeCloseTo(TURN_RATE * 0.05);
    expect(run(c, 1, 1 / 60, player).last.yaw).toBeCloseTo(-Math.PI / 2);
    expect(run(c, 1, 1 / 60, { x: HOME.x + 50, z: HOME.z }).last.yaw).toBeCloseTo(HOME.yaw);
    expect(c.state()).toBe('idle');
  });

  it('stationary without facePlayer and reactive keep home.yaw', () => {
    const player = { x: HOME.x + 1, z: HOME.z };
    for (const s of [spec('stationary', { facePlayer: false }), spec('reactive')]) {
      const { last } = run(controller(s), 1, 1 / 60, player);
      expect(last).toMatchObject({ x: HOME.x, z: HOME.z, yaw: HOME.yaw, locomotion: 'idle' });
    }
  });

  it('patrol walks the waypoints (offsets from home) in order with pauses and loops', () => {
    const c = controller(
      spec('patrol', {
        speed: 2,
        loop: true,
        waypoints: [
          { x: 2, z: 0, pauseSeconds: 1 },
          { x: 2, z: 2 },
        ],
      }),
    );
    // home -> wp0: 1 s; pause 1 s; wp0 -> wp1: 1 s; wp1 -> wp0: 1 s; pause ...
    const { events, frames } = run(c, 4.5, 1 / 60);
    expect(reachedIndexes(events)).toEqual([0, 1, 0]);
    expect(states(events)).toEqual(['moving', 'paused', 'moving', 'paused']);
    const after1 = frames[Math.round(1.5 * 60) - 1];
    expect(after1).toMatchObject({ locomotion: 'idle' });
    expect(after1.x).toBeCloseTo(HOME.x + 2);
    expect(after1.z).toBeCloseTo(HOME.z);
    expect(frames[30].locomotion).toBe('walk');
  });

  it('patrol with loop false walks back along the route (ping-pong)', () => {
    const c = controller(
      spec('patrol', {
        speed: 4,
        loop: false,
        waypoints: [
          { x: 1, z: 0 },
          { x: 2, z: 0 },
          { x: 3, z: 0 },
        ],
      }),
    );
    const { events } = run(c, 2, 1 / 60);
    expect(reachedIndexes(events).slice(0, 7)).toEqual([0, 1, 2, 1, 0, 1, 2]);
  });

  it('turns smoothly toward the travel direction', () => {
    const c = controller(
      spec('patrol', {
        speed: 1,
        waypoints: [
          { x: -5, z: 0 },
          { x: 0, z: 0 },
        ],
      }),
    );
    const first = c.update(1 / 60, null);
    expect(Math.abs(first.yaw - HOME.yaw)).toBeCloseTo(TURN_RATE / 60);
    expect(run(c, 1, 1 / 60).last.yaw).toBeCloseTo(-Math.PI / 2);
  });

  it('reports run above the documented speed threshold and walk below it', () => {
    expect(locomotionFor(0, 5)).toBe('idle');
    expect(locomotionFor(0.1, RUN_SPEED_THRESHOLD)).toBe('walk');
    expect(locomotionFor(0.1, RUN_SPEED_THRESHOLD + 0.1)).toBe('run');
    const fast = controller(
      spec('patrol', {
        speed: 4,
        waypoints: [
          { x: 5, z: 0 },
          { x: 0, z: 0 },
        ],
      }),
    );
    expect(fast.update(0.1, null).locomotion).toBe('run');
  });

  it('wander stays within its radius and is deterministic for the same seed', () => {
    const params = { radius: 3, speed: 1.5, pauseSeconds: [0.2, 0.5] as [number, number] };
    const a = run(controller(spec('wander', params), { random: seeded(7) }), 20, 1 / 60);
    const b = run(controller(spec('wander', params), { random: seeded(7) }), 20, 1 / 60);
    const other = run(controller(spec('wander', params), { random: seeded(8) }), 20, 1 / 60);
    expect(a.frames.map((f) => [f.x, f.z, f.yaw])).toEqual(b.frames.map((f) => [f.x, f.z, f.yaw]));
    expect(a.last.x).not.toBeCloseTo(other.last.x, 3);
    for (const f of a.frames) expect(distFromHome(f)).toBeLessThanOrEqual(3 + 1e-6);
    const s = states(a.events);
    expect(s[0]).toBe('moving');
    expect(s.filter((x) => x === 'paused').length).toBeGreaterThan(2);
  });

  it('wander and patrol are frame-rate independent', () => {
    const wander = () =>
      controller(spec('wander', { radius: 4, speed: 2, pauseSeconds: [0.3, 0.9] }), {
        random: seeded(42),
      });
    const patrol = () =>
      controller(
        spec('patrol', {
          speed: 1.7,
          waypoints: [
            { x: 3, z: 1, pauseSeconds: 0.4 },
            { x: -2, z: 4 },
            { x: 0, z: -3, pauseSeconds: 0.25 },
          ],
        }),
      );
    for (const make of [wander, patrol]) {
      const steady = run(make(), 12, 1 / 60);
      const coarse = run(make(), 12, 1 / 20);
      const jittery = seeded(3);
      const uneven: number[] = [];
      let total = 0;
      while (total < 12 - 1e-9) {
        const dt = Math.min(0.005 + jittery() * 0.2, 12 - total);
        uneven.push(dt);
        total += dt;
      }
      const mixed = runSteps(make(), uneven);
      for (const other of [coarse, mixed]) {
        expect(other.last.x).toBeCloseTo(steady.last.x, 6);
        expect(other.last.z).toBeCloseTo(steady.last.z, 6);
        expect(other.last.yaw).toBeCloseTo(steady.last.yaw, 6);
        expect(reachedIndexes(other.events)).toEqual(reachedIndexes(steady.events));
        expect(states(other.events)).toEqual(states(steady.events));
      }
    }
  });

  it('clamps a huge frame so the NPC does not teleport', () => {
    const c = controller(
      spec('patrol', {
        speed: 2,
        waypoints: [
          { x: 10, z: 0 },
          { x: 0, z: 0 },
        ],
      }),
    );
    const f = c.update(5, null);
    expect(distFromHome(f)).toBeCloseTo(2 * MAX_DELTA_SECONDS);
  });

  it('ignores zero, negative and NaN frame times', () => {
    const c = controller(
      spec('patrol', {
        speed: 2,
        waypoints: [
          { x: 3, z: 0 },
          { x: 0, z: 0 },
        ],
      }),
    );
    for (const dt of [0, -1, Number.NaN]) {
      expect(c.update(dt, null)).toMatchObject({ x: HOME.x, z: HOME.z, events: [] });
    }
  });
});

describe('interruption and cancellation (LAI-NPC-020)', () => {
  const patrolSpec = spec('patrol', {
    speed: 2,
    waypoints: [
      { x: 4, z: 0, pauseSeconds: 2 },
      { x: 4, z: 4 },
    ],
  });

  it('freezes mid-path and resumes exactly where it stopped', () => {
    const reference = controller(patrolSpec);
    const interrupted = controller(patrolSpec);
    run(reference, 1);
    run(interrupted, 1);
    interrupted.interrupt('dialogue');
    const during = run(interrupted, 3, 1 / 60, { x: HOME.x, z: HOME.z });
    expect(states(during.events)).toEqual(['interrupted']);
    for (const f of during.frames) {
      expect(f.locomotion).toBe('idle');
      expect(f.x).toBe(during.frames[0].x);
    }
    interrupted.resume();
    expect(interrupted.state()).toBe('moving');
    const a = run(reference, 4);
    const b = run(interrupted, 4);
    expect(b.last.x).toBeCloseTo(a.last.x, 9);
    expect(b.last.z).toBeCloseTo(a.last.z, 9);
    expect(reachedIndexes(b.events)).toEqual(reachedIndexes(a.events));
    expect(states(b.events)).toEqual(['moving', ...states(a.events)]);
  });

  it('remembers the remaining pause when interrupted mid-pause', () => {
    const c = controller(patrolSpec);
    run(c, 2.5); // arrived at wp0 (4 m at 2 m/s) after 2 s, so 0.5 s into a 2 s pause
    expect(c.state()).toBe('paused');
    c.interrupt('scripted');
    run(c, 10);
    c.resume();
    expect(c.state()).toBe('paused');
    const tail = run(c, 1.4);
    expect(states(tail.events)).toEqual(['paused']); // the resume event only
    const next = run(c, 0.2);
    expect(states(next.events)).toEqual(['moving']);
  });

  it('ignores resume without interrupt and a second interrupt', () => {
    const c = controller(patrolSpec);
    run(c, 0.5);
    c.resume();
    expect(c.state()).toBe('moving');
    c.interrupt('dialogue');
    c.interrupt('scripted');
    c.resume();
    expect(c.state()).toBe('moving');
  });

  it('dispose stops everything and makes later calls no-ops', () => {
    const c = controller(
      spec('patrol', { ...patrolSpec.parameters, reactions: { 'treasure.found': 'celebrate' } }),
    );
    const before = run(c, 0.5).last;
    c.dispose();
    const after = c.update(1, null);
    expect(after).toMatchObject({ x: before.x, z: before.z, locomotion: 'idle', events: [] });
    c.interrupt('dialogue');
    c.resume();
    expect(c.react('treasure.found')).toBeNull();
    expect(c.state()).toBe('moving');
    c.dispose();
  });
});

describe('follow and guide (LAI-NPC-022)', () => {
  const followSpec = spec('follow', {
    stopDistance: 2,
    speed: 3,
    giveUpDistance: 10,
    boundsRadius: 15,
  });

  it('follows to stopDistance, idles facing the player, and runs above the threshold', () => {
    const c = controller(followSpec);
    const player = { x: HOME.x + 6, z: HOME.z };
    const first = c.update(0.1, player);
    expect(first.locomotion).toBe('run');
    const { last, events } = run(c, 3, 1 / 60, player);
    expect(states([...first.events, ...events])).toEqual(['following', 'idle']);
    expect(Math.hypot(player.x - last.x, player.z - last.z)).toBeCloseTo(2, 1);
    expect(last.locomotion).toBe('idle');
    expect(last.yaw).toBeCloseTo(Math.PI / 2);
  });

  it('gives up beyond giveUpDistance and returns home', () => {
    const c = controller(followSpec);
    run(c, 2, 1 / 60, { x: HOME.x + 6, z: HOME.z });
    const gone = run(c, 6, 1 / 60, { x: HOME.x + 40, z: HOME.z });
    expect(states(gone.events)).toEqual(['returning', 'idle']);
    expect(gone.last).toMatchObject({ x: HOME.x, z: HOME.z });
    expect(run(c, 1, 1 / 60, { x: HOME.x + 40, z: HOME.z }).last.yaw).toBeCloseTo(HOME.yaw);
  });

  it('returns home when the player disappears', () => {
    const c = controller(followSpec);
    run(c, 1, 1 / 60, { x: HOME.x + 6, z: HOME.z });
    expect(states(run(c, 6, 1 / 60, null).events)).toEqual(['returning', 'idle']);
  });

  it('never follows outside its bounds circle', () => {
    const c = controller({
      ...followSpec,
      parameters: { ...followSpec.parameters, boundsRadius: 3 },
    });
    const { frames } = run(c, 4, 1 / 60, { x: HOME.x + 8, z: HOME.z });
    for (const f of frames) expect(distFromHome(f)).toBeLessThanOrEqual(3 + 1e-6);
    expect(c.state()).toBe('following');
  });

  it('guide waits for a far player, then walks on and stops at the last waypoint', () => {
    const c = controller(
      spec('guide', {
        speed: 2,
        waitForPlayerDistance: 3,
        waypoints: [
          { x: 4, z: 0 },
          { x: 8, z: 0 },
        ],
      }),
    );
    const waiting = run(c, 1, 1 / 60, { x: HOME.x - 10, z: HOME.z });
    expect(states(waiting.events)).toEqual(['waiting_for_player']);
    expect(waiting.last).toMatchObject({ x: HOME.x, z: HOME.z, locomotion: 'idle' });
    // The player walks just behind the guide.
    const together = run(c, 5, 1 / 60, null);
    expect(c.state()).toBe('waiting_for_player'); // null player: wait
    let x = waiting.last.x;
    const walkFrames: NpcBehaviorFrame[] = [];
    for (let i = 0; i < 300; i += 1) {
      const f = c.update(1 / 60, { x: x - 1, z: HOME.z });
      x = f.x;
      walkFrames.push(f);
    }
    const walk = { events: walkFrames.flatMap((f) => f.events), last: walkFrames[299] };
    expect(together.events).toEqual([]);
    expect(reachedIndexes(walk.events)).toEqual([0, 1]);
    expect(states(walk.events)).toEqual(['moving', 'idle']);
    expect(walk.last.x).toBeCloseTo(HOME.x + 8);
  });

  it('guide stops and waits when the player falls behind mid-route', () => {
    const c = controller(
      spec('guide', { speed: 2, waitForPlayerDistance: 3, waypoints: [{ x: 8, z: 0 }] }),
    );
    run(c, 1, 1 / 60, { x: HOME.x, z: HOME.z });
    const left = run(c, 2, 1 / 60, { x: HOME.x, z: HOME.z });
    expect(states(left.events)).toEqual(['waiting_for_player']);
    expect(left.last.x - HOME.x).toBeGreaterThan(3 - 0.1);
    expect(left.last.x - HOME.x).toBeLessThan(3 + 0.1);
  });
});

describe('scripted', () => {
  it('runs moveTo, play, wait and face steps in order and loops', () => {
    const c = controller(
      spec('scripted', {
        speed: 1,
        loop: true,
        steps: [
          { action: 'moveTo', x: 1, z: 0 },
          { action: 'play', state: 'wave' },
          { action: 'wait', seconds: 1 },
          { action: 'face', yaw: Math.PI },
          { action: 'moveTo', x: 0, z: 0 },
        ],
      }),
    );
    // One lap: moveTo 1 s, wait 1 s, face (PI/2 at TURN_RATE), moveTo back 1 s; then lap two.
    const { frames, events } = run(c, 4.5, 1 / 60);
    expect(frames.filter((f) => f.animation === 'wave')).toHaveLength(2);
    expect(reachedIndexes(events)).toEqual([0, 4, 0]);
    expect(states(events).slice(0, 5)).toEqual(['moving', 'idle', 'paused', 'idle', 'moving']);
  });

  it('stops at the end when loop is false', () => {
    const c = controller(
      spec('scripted', {
        loop: false,
        steps: [
          { action: 'moveTo', x: 1, z: 0 },
          { action: 'face', yaw: 0 },
        ],
      }),
    );
    run(c, 5);
    expect(c.state()).toBe('idle');
    const { last } = run(c, 2);
    expect(last).toMatchObject({ x: HOME.x + 1, z: HOME.z, yaw: 0, locomotion: 'idle' });
  });

  it('does not spin forever on a loop with no time-taking step', () => {
    const c = controller(spec('scripted', { steps: [{ action: 'play', state: 'wave' }] }));
    expect(c.update(0.1, null).animation).toBe('wave');
  });
});

describe('reactions (LAI-NPC-023)', () => {
  const reactions = { 'treasure.found': 'celebrate', 'answer.incorrect': 'think' } as const;

  it('returns the configured state for any behaviour type and null when unconfigured', () => {
    for (const type of ['stationary', 'reactive', 'wander', 'follow'] as const) {
      const c = controller(spec(type, { reactions, radius: 2, speed: 1, stopDistance: 1 }));
      expect(c.react('treasure.found')).toBe('celebrate');
      expect(c.react('quest.completed')).toBeNull();
    }
    expect(controller(null).react('treasure.found')).toBeNull();
  });

  it('pauses movement while reacting, then carries on where it was', () => {
    const c = controller(
      spec('patrol', {
        speed: 2,
        reactions,
        waypoints: [
          { x: 6, z: 0 },
          { x: 0, z: 0 },
        ],
      }),
    );
    const before = run(c, 0.5).last;
    expect(c.react('answer.incorrect')).toBe('think');
    expect(c.state()).toBe('reacting');
    const during = run(c, REACTION_SECONDS - 0.1);
    for (const f of during.frames) expect(f).toMatchObject({ x: before.x, locomotion: 'idle' });
    const after = run(c, 0.5);
    expect(states([...during.events, ...after.events])).toEqual(['reacting', 'moving']);
    expect(after.last.x).toBeGreaterThan(before.x);
  });

  it('a reaction during an interruption plays without leaving it', () => {
    const c = controller(spec('stationary', { reactions }));
    c.interrupt('dialogue');
    expect(c.react('treasure.found')).toBe('celebrate');
    expect(c.state()).toBe('interrupted');
    c.resume();
    expect(c.state()).toBe('idle');
  });
});

describe('collision and boundaries (LAI-NPC-024)', () => {
  it('clamps waypoints outside boundsRadius onto the circle', () => {
    const c = controller(
      spec('patrol', {
        speed: 5,
        boundsRadius: 4,
        waypoints: [
          { x: 10, z: 0 },
          { x: -10, z: 0 },
        ],
      }),
    );
    const { frames, events } = run(c, 6);
    for (const f of frames) expect(distFromHome(f)).toBeLessThanOrEqual(4 + 1e-6);
    expect(reachedIndexes(events).slice(0, 2)).toEqual([0, 1]);
  });

  it('never steps into a blocked point and skips an unreachable waypoint', () => {
    // A box around waypoint 1 (offset 4, 0): unreachable, so the patrol skips to waypoint 2.
    const isBlocked = isBlockedByRects([
      { minX: HOME.x + 3, maxX: HOME.x + 5, minZ: HOME.z - 1, maxZ: HOME.z + 1 },
    ]);
    const c = controller(
      spec('patrol', {
        speed: 2,
        waypoints: [
          { x: 0, z: 3 },
          { x: 4, z: 0 },
          { x: 0, z: -3 },
        ],
      }),
      { isBlocked },
    );
    const { frames, events } = run(c, 12);
    for (const f of frames) expect(isBlocked(f.x, f.z)).toBe(false);
    const reached = reachedIndexes(events);
    expect(reached).toContain(0);
    expect(reached).toContain(2);
    expect(reached).not.toContain(1);
  });

  it('slides around a wall on the way to a waypoint', () => {
    // A wall between home and waypoint 0 that leaves the far side open.
    const isBlocked = isBlockedByRects([
      { minX: HOME.x + 1.5, maxX: HOME.x + 2, minZ: HOME.z - 1, maxZ: HOME.z + 1 },
    ]);
    const c = controller(
      spec('patrol', {
        speed: 2,
        waypoints: [
          { x: 4, z: 2 },
          { x: 0, z: 0 },
        ],
      }),
      {
        isBlocked,
      },
    );
    const { frames, events } = run(c, 6);
    for (const f of frames) expect(isBlocked(f.x, f.z)).toBe(false);
    expect(reachedIndexes(events)[0]).toBe(0);
  });

  it('wander picks targets away from blocked ground', () => {
    const isBlocked = (x: number) => x > HOME.x;
    const c = controller(spec('wander', { radius: 3, speed: 2, pauseSeconds: [0.1, 0.2] }), {
      isBlocked,
      random: seeded(11),
    });
    const { frames } = run(c, 20);
    for (const f of frames) expect(isBlocked(f.x)).toBe(false);
    expect(new Set(frames.map((f) => f.x.toFixed(2))).size).toBeGreaterThan(10);
  });
});
