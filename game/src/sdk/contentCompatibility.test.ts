import { describe, expect, it } from 'vitest';
import { checkContentCompatibility, type CompatibilityIssueCode } from './contentCompatibility';
import { createTestRegistry } from './testFixtures';

const registry = createTestRegistry();
const codes = (input: unknown, kind?: 'AREA_SCENE' | 'ADVENTURE') =>
  checkContentCompatibility(input, registry, { kind }).issues.map((i) => i.code);

const goodScene = {
  engineApi: '^0.1.0',
  capabilities: [{ id: 'movement.jump', config: { jumpHeight: 1.2 } }],
  movement: { jump: { enabled: true, jumpHeight: 1.2, gravity: 22 } },
  platforming: {
    platforms: [
      { id: 'p1', kind: 'STATIC' },
      { id: 'p2', kind: 'MOVING', waypoints: [{}, {}] },
    ],
    checkpoints: [{ id: 'c1', platformId: 'p1' }],
  },
  jumpChallenges: [{ id: 'j1', jumpRouteId: 'hop', accessibleRouteId: 'walk' }],
  colliders: [
    { rect: {}, jumpable: true },
    { rect: {}, requirements: [{ kind: 'quest' }] },
  ],
};

describe('content compatibility', () => {
  it('accepts a good area scene, bare or wrapped as a Django scene', () => {
    expect(checkContentCompatibility(goodScene, registry).ok).toBe(true);
    expect(checkContentCompatibility({ scene: goodScene }, registry).issues).toEqual([]);
  });

  it('flags unknown capabilities and invalid configs separately', () => {
    expect(codes({ capabilities: [{ id: 'movement.teleport' }] })).toEqual(['UNKNOWN_CAPABILITY']);
    expect(codes({ capabilities: [{ id: 'movement.jump', config: { jumpHeight: 50 } }] })).toEqual([
      'INVALID_CAPABILITY_CONFIG',
    ]);
  });

  it('skips capability resolution when no registry is given', () => {
    expect(checkContentCompatibility({ capabilities: [{ id: 'anything.goes' }] }, null).ok).toBe(
      true,
    );
  });

  it('flags an engineApi mismatch', () => {
    expect(codes({ engineApi: '^3.0.0' })).toEqual(['ENGINE_API_MISMATCH']);
    expect(codes({ engineApi: 'nonsense' })).toEqual(['ENGINE_API_MISMATCH']);
  });

  it('flags jump challenges without an accessible route', () => {
    expect(codes({ jumpChallenges: [{ id: 'j', jumpRouteId: 'hop' }] })).toEqual([
      'JUMP_WITHOUT_ACCESSIBLE_ROUTE',
    ]);
    expect(
      codes({ jumpChallenges: [{ id: 'j', jumpRouteId: 'hop', accessibleRouteId: 'hop' }] }),
    ).toEqual(['JUMP_WITHOUT_ACCESSIBLE_ROUTE']);
  });

  it('accepts an optional jump-only challenge without an accessible route', () => {
    expect(codes({ jumpChallenges: [{ id: 'j', jumpRouteId: 'hop', optional: true }] })).toEqual(
      [],
    );
    expect(codes({ jumpChallenges: [{ id: 'j', jumpRouteId: 'hop', optional: false }] })).toEqual([
      'JUMP_WITHOUT_ACCESSIBLE_ROUTE',
    ]);
  });

  it('flags checkpoints on moving platforms', () => {
    const scene = {
      platforming: {
        platforms: [
          { id: 'lift', kind: 'MOVING' },
          { id: 'turn', motion: { kind: 'ROTATE' } },
          { id: 'rock', kind: 'STATIC' },
        ],
        checkpoints: [
          { id: 'a', platformId: 'lift' },
          { id: 'b', platformId: 'turn' },
          { id: 'c', platformId: 'rock' },
        ],
      },
    };
    expect(codes(scene)).toEqual([
      'CHECKPOINT_ON_MOVING_PLATFORM',
      'CHECKPOINT_ON_MOVING_PLATFORM',
    ]);
  });

  it('flags jumpable gates but not jumpable obstacles', () => {
    expect(codes({ colliders: [{ jumpable: true, requirements: [{}] }] })).toEqual([
      'JUMPABLE_GATE',
    ]);
    expect(codes({ gates: [{ jumpable: true }] })).toEqual(['JUMPABLE_GATE']);
    expect(codes({ colliders: [{ jumpable: true }] })).toEqual([]);
  });

  it('flags timer-like fields at any depth (ADR-053)', () => {
    const found = checkContentCompatibility(
      { puzzles: [{ rules: { timeLimit: 30 } }], countdown: 3, deadline: 'x' },
      registry,
    );
    expect(found.issues.map((i) => i.code)).toEqual([
      'TIMER_PRESENT',
      'TIMER_PRESENT',
      'TIMER_PRESENT',
    ]);
    expect(found.issues.map((i) => i.path)).toContain('puzzles[0].rules.timeLimit');
    // Platform cycle fields are not timers.
    expect(
      codes({
        platforming: {
          platforms: [{ id: 'v', visibleSeconds: 2, hiddenSeconds: 1, pauseSeconds: 1 }],
        },
      }),
    ).toEqual([]);
  });

  it('flags more than 64 platforms per area', () => {
    const platforms = Array.from({ length: 65 }, (_, i) => ({ id: `p${i}` }));
    expect(codes({ platforming: { platforms } })).toEqual(['TOO_MANY_PLATFORMS']);
    expect(codes({ platforming: { platforms: platforms.slice(0, 64) } })).toEqual([]);
  });

  it('flags jump physics outside the standard limits', () => {
    expect(codes({ movement: { jump: { jumpHeight: 9, coyoteTimeMs: 900 } } })).toEqual([
      'JUMP_LIMIT_EXCEEDED',
      'JUMP_LIMIT_EXCEEDED',
    ]);
  });

  it('requires a world consequence for adventures only', () => {
    expect(codes({ realmId: 'r', id: 'a' })).toEqual(['MISSING_WORLD_CONSEQUENCE']);
    expect(codes({ realmId: 'r', worldConsequenceId: 'bridge-repaired' })).toEqual([]);
    expect(codes({ id: 'area' })).toEqual([]);
    expect(codes({ id: 'area' }, 'ADVENTURE')).toEqual(['MISSING_WORLD_CONSEQUENCE']);
  });

  it('never throws, whatever the input', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const hostile: unknown[] = [
      null,
      undefined,
      1,
      'x',
      [],
      cyclic,
      { capabilities: 5, platforming: 'x', jumpChallenges: {}, colliders: 3 },
    ];
    for (const input of hostile) {
      const report = checkContentCompatibility(input, registry);
      expect(typeof report.ok).toBe('boolean');
    }
    expect(codes(null)).toEqual<CompatibilityIssueCode[]>(['MALFORMED']);
  });
});
