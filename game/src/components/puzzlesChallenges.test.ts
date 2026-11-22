import { describe, expect, it } from 'vitest';
import { signalBoard } from './common';
import { validateJumpChallengesConfig } from './jumpChallenges';
import { PuzzlesService, validatePuzzlesConfig } from './puzzles';
import {
  GAMEPLAY_CAPABILITIES,
  GAMEPLAY_CAPABILITY_IDS,
  registerGameplayComponents,
} from './registerGameplayComponents';
import { createHarness } from './testHarness';
import { ensureWorldObject } from './triggers';

const harness = () => createHarness(registerGameplayComponents);
const alt = { alternativeActionId: 'action.skip.by.button' };

describe('puzzles', () => {
  it('SEQUENCE completes in order, resets gently on a wrong step, and claims once', async () => {
    const h = harness();
    await h.start([
      {
        id: 'gameplay.puzzles',
        config: {
          puzzles: [{ id: 'puz.seq', kind: 'SEQUENCE', steps: ['p1', 'p2', 'p3'], ...alt }],
        },
      },
    ]);
    const board = signalBoard(h.runtime);
    const api = h.runtime.services.require(PuzzlesService);
    board.set('p1', true);
    board.set('p3', true);
    expect(api.progressOf('puz.seq')).toEqual({ progress: 0, total: 3 });
    expect(h.eventsNamed('PuzzleReset')).toHaveLength(1);
    board.set('p1', false);
    board.set('p3', false);
    board.set('p1', true);
    board.set('p2', true);
    expect(api.progressOf('puz.seq')?.progress).toBe(2);
    board.set('p3', true);
    expect(api.isCompleted('puz.seq')).toBe(true);
    expect(board.get('puzzle.puz.seq')).toBe(true);
    expect(h.claimsOfType('puzzle.completed').map((c) => c.payload)).toEqual([
      { puzzleId: 'puz.seq' },
    ]);
    board.set('p1', false);
    board.set('p1', true);
    expect(h.claimsOfType('puzzle.completed')).toHaveLength(1);
    h.dispose();
  });

  it('ALL_HELD needs every signal at once (and an optional short hold)', async () => {
    const h = harness();
    await h.start([
      {
        id: 'gameplay.puzzles',
        config: {
          puzzles: [
            { id: 'puz.held', kind: 'ALL_HELD', signalIds: ['a', 'b'], holdSeconds: 0.5, ...alt },
          ],
        },
      },
    ]);
    const board = signalBoard(h.runtime);
    board.set('a', true);
    h.advance(1);
    expect(h.claims).toHaveLength(0);
    board.set('b', true);
    h.advance(0.3);
    board.set('b', false);
    h.advance(0.1);
    board.set('b', true);
    h.advance(0.3);
    expect(h.claims).toHaveLength(0);
    h.advance(0.4);
    expect(h.claimsOfType('puzzle.completed')).toHaveLength(1);
    h.dispose();
  });

  it('SOCKETS completes when every object sits in its socket', async () => {
    const h = harness();
    const sockets = [
      { id: 's1', x: 0, z: 0, accepts: 'crate.red' },
      { id: 's2', x: 5, z: 0, accepts: 'crate.blue' },
    ];
    await h.start([
      {
        id: 'gameplay.puzzles',
        config: { puzzles: [{ id: 'puz.sock', kind: 'SOCKETS', sockets, ...alt }] },
      },
    ]);
    ensureWorldObject(h.runtime, 'crate.red', { x: 0.2, y: 0, z: 0 });
    ensureWorldObject(h.runtime, 'crate.blue', { x: 0.2, y: 0, z: 0 });
    h.advance(0.1);
    expect(h.runtime.services.require(PuzzlesService).progressOf('puz.sock')?.progress).toBe(1);
    ensureWorldObject(h.runtime, 'crate.blue', { x: 5.1, y: 0, z: 0 });
    h.advance(0.1);
    expect(h.claimsOfType('puzzle.completed')).toHaveLength(1);
    h.dispose();
  });

  it('can be completed without movement through the declared alternative, with the same claim', async () => {
    const h = harness();
    await h.start([
      {
        id: 'gameplay.puzzles',
        config: { puzzles: [{ id: 'puz.seq', kind: 'SEQUENCE', steps: ['p1', 'p2'], ...alt }] },
      },
    ]);
    const api = h.runtime.services.require(PuzzlesService);
    expect(api.completeViaAlternative('puz.seq', 'wrong.action')).toBe(false);
    expect(api.completeViaAlternative('puz.seq', 'action.skip.by.button')).toBe(true);
    expect(h.claimsOfType('puzzle.completed').map((c) => c.payload)).toEqual([
      { puzzleId: 'puz.seq' },
    ]);
    expect(h.eventsNamed('PuzzleCompleted')).toEqual([
      { puzzleId: 'puz.seq', viaAlternative: true },
    ]);
    expect(api.completeViaAlternative('puz.seq', 'action.skip.by.button')).toBe(true);
    expect(h.claimsOfType('puzzle.completed')).toHaveLength(1);
    h.dispose();
  });

  it('stops listening after dispose', async () => {
    const h = harness();
    await h.start([
      {
        id: 'gameplay.puzzles',
        config: { puzzles: [{ id: 'puz.seq', kind: 'SEQUENCE', steps: ['p1', 'p2'], ...alt }] },
      },
    ]);
    const board = signalBoard(h.runtime);
    h.dispose();
    board.set('p1', true);
    board.set('p2', true);
    expect(h.claims).toHaveLength(0);
  });

  it('validation requires the accessible alternative and sane shapes', () => {
    expect(
      validatePuzzlesConfig({ puzzles: [{ id: 'x', kind: 'SEQUENCE', steps: ['a', 'b'] }] }).ok,
    ).toBe(false);
    expect(
      validatePuzzlesConfig({ puzzles: [{ id: 'x', kind: 'SEQUENCE', steps: ['a'], ...alt }] }).ok,
    ).toBe(false);
    expect(
      validatePuzzlesConfig({
        puzzles: [{ id: 'x', kind: 'ALL_HELD', signalIds: ['a', 'b'], holdSeconds: 9, ...alt }],
      }).ok,
    ).toBe(false);
    expect(
      validatePuzzlesConfig({ puzzles: [{ id: 'x', kind: 'SOCKETS', sockets: [], ...alt }] }).ok,
    ).toBe(false);
    expect(validatePuzzlesConfig({ puzzles: [{ id: 'x', kind: 'NOPE', ...alt }] }).ok).toBe(false);
  });
});

describe('jump challenges', () => {
  const challenge = {
    challengeId: 'jc.river',
    routes: [
      {
        routeId: 'route.stones',
        kind: 'JUMP',
        start: { minX: 0, maxX: 2, minZ: 0, maxZ: 2 },
        goal: { minX: 10, maxX: 12, minZ: 0, maxZ: 2 },
      },
      {
        routeId: 'route.bridge',
        kind: 'ACCESSIBLE',
        start: { minX: 0, maxX: 2, minZ: 5, maxZ: 7 },
        goal: { minX: 10, maxX: 12, minZ: 5, maxZ: 7 },
      },
    ],
  };

  it('the jump route emits started then completed', async () => {
    const h = harness();
    await h.start([{ id: 'gameplay.jumpChallenges', config: { challenges: [challenge] } }]);
    h.setPlayer({ x: 1, y: 0, z: 1 });
    h.advance(0.1);
    h.setPlayer({ x: 11, y: 0, z: 1 });
    h.advance(0.1);
    expect(h.claims.map((c) => [c.type, c.payload])).toEqual([
      ['jump.challenge.started', { challengeId: 'jc.river' }],
      ['jump.challenge.completed', { challengeId: 'jc.river', routeId: 'route.stones' }],
    ]);
    h.dispose();
  });

  it('the accessible route emits the identical claims plus the informational alternative event', async () => {
    const jump = harness();
    const walk = harness();
    for (const h of [jump, walk]) {
      await h.start([{ id: 'gameplay.jumpChallenges', config: { challenges: [challenge] } }]);
    }
    jump.setPlayer({ x: 11, y: 0, z: 1 });
    jump.advance(0.1);
    walk.setPlayer({ x: 1, y: 0, z: 6 });
    walk.advance(0.1);
    walk.setPlayer({ x: 11, y: 0, z: 6 });
    walk.advance(0.1);
    walk.advance(0.1);
    const shape = (h: typeof jump) =>
      h.claims.filter((c) => c.type !== 'jump.alternative.used').map((c) => c.type);
    expect(shape(walk)).toEqual(shape(jump));
    expect(walk.claimsOfType('jump.challenge.completed')[0]!.payload).toEqual({
      challengeId: 'jc.river',
      routeId: 'route.bridge',
    });
    expect(walk.claimsOfType('jump.alternative.used')).toHaveLength(1);
    expect(jump.claimsOfType('jump.alternative.used')).toHaveLength(0);
    expect(walk.claimsOfType('jump.challenge.completed')).toHaveLength(1);
    jump.dispose();
    walk.dispose();
  });

  it('requires both a jump route and an accessible route', () => {
    expect(
      validateJumpChallengesConfig({
        challenges: [{ ...challenge, routes: [challenge.routes[0]] }],
      }).ok,
    ).toBe(false);
    expect(
      validateJumpChallengesConfig({
        challenges: [{ ...challenge, routes: [challenge.routes[1]] }],
      }).ok,
    ).toBe(false);
    expect(validateJumpChallengesConfig({ challenges: [challenge] }).ok).toBe(true);
  });

  it('lets an optional jump-only challenge omit the accessible route (it gates nothing required)', () => {
    const jumpOnly = {
      ...challenge,
      routes: [challenge.routes.find((r) => r.kind === 'JUMP')!],
      optional: true,
    };
    expect(validateJumpChallengesConfig({ challenges: [jumpOnly] }).ok).toBe(true);
    expect(
      validateJumpChallengesConfig({ challenges: [{ ...jumpOnly, optional: false }] }).ok,
    ).toBe(false);
    expect(
      validateJumpChallengesConfig({ challenges: [{ ...jumpOnly, optional: 'yes' }] }).ok,
    ).toBe(false);
  });
});

describe('registration', () => {
  it('registers every capability once with unique ids and works with an empty install', async () => {
    expect(new Set(GAMEPLAY_CAPABILITY_IDS).size).toBe(GAMEPLAY_CAPABILITIES.length);
    const h = createHarness(registerGameplayComponents);
    expect(h.registry.list().map((c) => c.id)).toEqual([...GAMEPLAY_CAPABILITY_IDS]);
    await h.start(GAMEPLAY_CAPABILITY_IDS.map((id) => ({ id })));
    h.advance(1);
    expect(h.claims).toHaveLength(0);
    h.dispose();
    expect(h.runtime.state).toBe('disposed');
  });

  it('an invalid config fails start with validation issues and installs nothing', async () => {
    const h = harness();
    await expect(
      h.start([{ id: 'gameplay.platforms', config: { platforms: [{ id: 'p' }] } }]),
    ).rejects.toThrow();
    expect(h.physics.colliders()).toHaveLength(0);
  });
});
