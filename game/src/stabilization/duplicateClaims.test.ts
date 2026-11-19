import { describe, expect, it } from 'vitest';
import { signalBoard } from '../components/common';
import { PuzzlesService } from '../components/puzzles';
import { validateGameplayEvent, GAMEPLAY_EVENT_TYPES, type AnyGameplayEvent } from '../contracts/gameplayEvents';
import type { CapabilityRequest } from '../core/capabilities';
import type { EventMap } from '../core/eventBus';
import { createEngineRuntime } from '../core/runtime';
import { createStandardEngine, type StandardEngineHandle } from '../engine/standardEngine';
import { loadAdventure } from '../sdk/lifecycle';
import { createTestRegistry, validAdventure } from '../sdk/testFixtures';

/**
 * Wave 2 stabilization, areas 8 and 9 (engine side): every claim a component emits passes
 * validateGameplayEvent, and each collectible, checkpoint, puzzle, jump challenge, course goal
 * and adventure completion claims at most once per visit, across pause and resume, zone
 * re-entry and repeated hazard recoveries. Event ids are unique. The default (random) id
 * factory is used, so uniqueness is real, not a counter.
 */

const DT = 1 / 60;
const alt = { alternativeActionId: 'action.skip.by.button' };

const REQUESTS: CapabilityRequest[] = [
  { id: 'movement.locomotion' },
  {
    id: 'gameplay.checkpoints',
    config: {
      checkpoints: [
        { id: 'cp.a', courseId: 'course.a', position: { x: 2, y: 0, z: 0 }, label: 'the dock' },
        { id: 'cp.b', courseId: 'course.a', position: { x: 20, y: 0, z: 0 }, label: 'the bridge' },
      ],
      goals: [{ id: 'goal.a', courseId: 'course.a', rect: { minX: 30, maxX: 32, minZ: -1, maxZ: 1 } }],
    },
  },
  { id: 'gameplay.collectibles', config: { collectibles: [{ id: 'coin.a', position: { x: 6, y: 0, z: 0 }, setId: 'set.coins' }, { id: 'coin.b', position: { x: 8.5, y: 0, z: 0 } }] } },
  { id: 'gameplay.puzzles', config: { puzzles: [{ id: 'puz.seq', kind: 'SEQUENCE', steps: ['p1', 'p2'], ...alt }] } },
  {
    id: 'gameplay.jumpChallenges',
    config: {
      challenges: [
        {
          challengeId: 'jc.river',
          routes: [
            { routeId: 'route.stones', kind: 'JUMP', start: { minX: 9, maxX: 10, minZ: -1, maxZ: 1 }, goal: { minX: 12, maxX: 13, minZ: -1, maxZ: 1 } },
            { routeId: 'route.bridge', kind: 'ACCESSIBLE', start: { minX: 9, maxX: 10, minZ: 4, maxZ: 6 }, goal: { minX: 12, maxX: 13, minZ: 4, maxZ: 6 } },
          ],
        },
      ],
    },
  },
  {
    id: 'gameplay.hazards',
    config: { hazards: [{ id: 'pond', kind: 'WATER', rect: { minX: 15, maxX: 18, minZ: -3, maxZ: 3 }, checkpointId: 'cp.a', messageKey: 'hazard.water.splash' }], recoveryCooldownSeconds: 0.5 },
  },
];

async function visit() {
  const handle: StandardEngineHandle = await createStandardEngine({
    id: 'dup-claims',
    requests: REQUESTS,
    input: () => ({ move: { forward: 0, strafe: 0 } }),
    startPosition: { x: -5, y: 0, z: 0 },
    claims: { context: { realmId: 'realm.t', adventureId: 'adv.t', areaId: 'area.t', sessionRef: null } },
  }).catch((error: { details?: unknown }) => {
    throw new Error(`visit failed to start: ${JSON.stringify(error.details)}`);
  });
  const claims: AnyGameplayEvent[] = [];
  const recoveries: unknown[] = [];
  handle.runtime.events.on('gameplay.event' as never, ((e: AnyGameplayEvent) => claims.push(e)) as never);
  handle.runtime.events.on('HazardRecoveryRequested' as never, ((e: unknown) => recoveries.push(e)) as never);
  const at = (x: number, z = 0, steps = 3) => {
    handle.controller.teleportTo(x, z, 0);
    for (let i = 0; i < steps; i += 1) handle.runtime.tick(DT);
  };
  const count = (type: string, predicate: (e: AnyGameplayEvent) => boolean = () => true) => claims.filter((c) => c.type === type && predicate(c)).length;
  return { handle, claims, recoveries, at, count };
}

describe('claim validity and uniqueness', () => {
  it('every claim a full visit emits validates, and every eventId is unique', async () => {
    const v = await visit();
    for (const x of [2, 6, 8.5, 11, 12.5, 20, 31]) v.at(x);
    signalBoard(v.handle.runtime).set('p1', true);
    signalBoard(v.handle.runtime).set('p2', true);
    v.at(16);
    v.at(16);
    expect(v.claims.length).toBeGreaterThan(7);
    for (const claim of v.claims) {
      expect(validateGameplayEvent(claim).issues, claim.type).toEqual([]);
      expect(GAMEPLAY_EVENT_TYPES).toContain(claim.type);
      expect(claim).toMatchObject({ realmId: 'realm.t', adventureId: 'adv.t', areaId: 'area.t' });
    }
    const ids = v.claims.map((c) => c.eventId);
    expect(new Set(ids).size).toBe(ids.length);
    v.handle.dispose();
  });
});

describe('at most one claim per source record per visit', () => {
  it('re-entering a checkpoint, collectible, jump route and goal zone any number of times claims once', async () => {
    const v = await visit();
    for (let round = 0; round < 6; round += 1) {
      for (const x of [2, 6, 8.5, 11, 12.5, 31]) {
        v.at(x);
        v.at(-5);
      }
    }
    expect(v.count('course.checkpoint.reached', (c) => (c.payload as { checkpointId: string }).checkpointId === 'cp.a')).toBe(1);
    expect(v.count('collectible.collected', (c) => (c.payload as { collectibleId: string }).collectibleId === 'coin.a')).toBe(1);
    expect(v.count('collectible.collected', (c) => (c.payload as { collectibleId: string }).collectibleId === 'coin.b')).toBe(1);
    expect(v.count('jump.challenge.started')).toBe(1);
    expect(v.count('jump.challenge.completed')).toBe(1);
    expect(v.count('course.completed')).toBe(1);
    v.handle.dispose();
  });

  it('the accessible route and the jump route together still complete the challenge once', async () => {
    const v = await visit();
    v.at(12.5);
    v.at(5);
    v.at(12.5, 5);
    v.at(12.5);
    expect(v.count('jump.challenge.completed')).toBe(1);
    v.handle.dispose();
  });

  it('pause and resume neither replay nor lose a claim, and nothing is emitted while paused', async () => {
    const v = await visit();
    v.at(2);
    expect(v.count('course.checkpoint.reached')).toBe(1);
    v.handle.runtime.pause();
    v.handle.controller.teleportTo(6, 0, 0);
    for (let i = 0; i < 30; i += 1) v.handle.runtime.tick(DT);
    expect(v.count('collectible.collected')).toBe(0); // paused: the world is frozen
    v.handle.runtime.resume();
    for (let i = 0; i < 10; i += 1) v.handle.runtime.tick(DT);
    expect(v.count('collectible.collected')).toBe(1);
    for (let round = 0; round < 3; round += 1) {
      v.handle.runtime.pause();
      v.handle.runtime.resume();
      v.at(2);
      v.at(6);
    }
    expect(v.count('course.checkpoint.reached')).toBe(1);
    expect(v.count('collectible.collected', (c) => (c.payload as { collectibleId: string }).collectibleId === 'coin.a')).toBe(1);
    v.handle.dispose();
  });

  it('a puzzle claims once however often its signals toggle and even after the alternative action', async () => {
    const v = await visit();
    const board = signalBoard(v.handle.runtime);
    for (let round = 0; round < 4; round += 1) {
      board.set('p1', true);
      board.set('p2', true);
      board.set('p1', false);
      board.set('p2', false);
    }
    expect(v.count('puzzle.completed')).toBe(1);
    v.handle.runtime.services.require(PuzzlesService).completeViaAlternative('puz.seq', 'action.skip.by.button');
    expect(v.count('puzzle.completed')).toBe(1);
    v.handle.dispose();
  });

  it('repeated hazard recoveries recover each time but never repeat a checkpoint claim', async () => {
    const v = await visit();
    v.at(2); // cp.a
    for (let i = 0; i < 8; i += 1) {
      v.at(16, 0, 12); // into the pond: recovered to cp.a (a position near x 2)
    }
    expect(v.recoveries.length).toBeGreaterThanOrEqual(2);
    expect(v.count('course.checkpoint.reached')).toBe(1);
    expect(v.claims.map((c) => c.type).filter((t) => t !== 'course.checkpoint.reached')).toEqual([]);
    v.handle.dispose();
  });

  it('a recovery through a later checkpoint does not re-claim the earlier one', async () => {
    const v = await visit();
    v.at(2);
    v.at(20);
    v.at(16, 0, 12);
    v.at(2);
    v.at(20);
    expect(v.count('course.checkpoint.reached')).toBe(2);
    v.handle.dispose();
  });
});

describe('adventure lifecycle claims', () => {
  async function session() {
    const runtime = createEngineRuntime<EventMap>({ id: 'demo-adventure', capabilities: createTestRegistry() });
    const events: AnyGameplayEvent[] = [];
    runtime.events.on('gameplay.event', (e) => events.push(e as AnyGameplayEvent));
    const s = await loadAdventure(validAdventure(), runtime, runtime.services, { ageBand: 'EXPLORER' });
    return { runtime, events, s };
  }

  it('adventure.started and adventure.completed are each emitted once, across pause and resume', async () => {
    const { runtime, events, s } = await session();
    s.pause();
    expect(s.complete()).toBe(false); // not while paused
    s.resume();
    expect(s.complete()).toBe(true);
    expect(s.complete()).toBe(false);
    s.pause();
    s.resume();
    expect(s.complete()).toBe(false);
    expect(events.filter((e) => e.type === 'adventure.started')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'adventure.completed')).toHaveLength(1);
    for (const e of events) expect(validateGameplayEvent(e).ok).toBe(true);
    expect(new Set(events.map((e) => e.eventId)).size).toBe(events.length);
    s.dispose();
    expect(runtime.state).toBe('disposed');
  });

  it('completing after dispose emits nothing', async () => {
    const { events, s } = await session();
    s.dispose();
    expect(s.complete()).toBe(false);
    expect(events.filter((e) => e.type === 'adventure.completed')).toHaveLength(0);
  });

  it('re-entering the same area does not repeat exploration.area.entered', async () => {
    const { events, s } = await session();
    const area = s.definition.areas[0]!;
    s.enterArea(area);
    s.enterArea(area);
    s.enterArea(area);
    expect(events.filter((e) => e.type === 'exploration.area.entered')).toHaveLength(1);
    s.dispose();
  });
});
