import { describe, expect, it } from 'vitest';
import { createCapabilityRegistry } from '../core/capabilities';
import { isEngineError } from '../core/errors';
import { assertValidAdventure, profileFor, validateAdventure } from './adventure';
import { createTestRegistry, validAdventure } from './testFixtures';

const registry = createTestRegistry();
const paths = (input: unknown, options?: Parameters<typeof validateAdventure>[2]) =>
  validateAdventure(input, registry, options).issues.map((issue) => issue.path);

describe('adventure definition', () => {
  it('accepts a valid adventure', () => {
    const result = validateAdventure(validAdventure(), registry);
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('is frozen by defineAdventure and returned frozen by assertValidAdventure', () => {
    expect(Object.isFrozen(validAdventure())).toBe(true);
    expect(Object.isFrozen(assertValidAdventure(validAdventure(), registry))).toBe(true);
  });

  it('uses the registry to reject unknown capabilities and invalid configs (same as runtime)', () => {
    const unknown = validAdventure({ capabilities: [{ id: 'movement.teleport' }] });
    expect(paths(unknown)).toContain('capabilities.movement.teleport');
    const badConfig = validAdventure({
      capabilities: [{ id: 'movement.jump', config: { jumpHeight: 99 } }],
    });
    expect(paths(badConfig)).toContain('capabilities.movement.jump.jumpHeight');
    const runtimeIssues = registry.resolve([
      { id: 'movement.jump', config: { jumpHeight: 99 } },
    ]).issues;
    const sdkIssues = validateAdventure(badConfig, registry).issues.filter((issue) =>
      issue.path.startsWith('capabilities.'),
    );
    expect(sdkIssues).toEqual(runtimeIssues);
  });

  it('checks the engineApi range against the engine version', () => {
    expect(paths(validAdventure({ engineApi: '^9.0.0' }))).toContain('engineApi');
    expect(paths(validAdventure({ engineApi: 'banana' }))).toContain('engineApi');
    expect(paths(validAdventure({ engineApi: '>=0.1.0 <1.0.0' }))).not.toContain('engineApi');
    expect(
      paths(validAdventure({ engineApi: '^0.2.0' }), { engineApiVersion: '0.2.4' }),
    ).not.toContain('engineApi');
  });

  it('requires an accessible route on a required jump challenge, but not on an optional jump-only one', () => {
    const missing = validAdventure({
      jumpChallenges: [
        { id: 'j', areaId: 'demo-cove', jumpRouteId: 'r1', accessibleRouteId: '', optional: false },
      ],
    });
    expect(paths(missing)).toContain('jumpChallenges[0].accessibleRouteId');
    const optionalJumpOnly = validAdventure({
      jumpChallenges: [
        {
          id: 'j',
          areaId: 'demo-cove',
          jumpRouteId: 'r1',
          accessibleRouteId: null,
          optional: true,
        },
      ],
    });
    expect(paths(optionalJumpOnly)).not.toContain('jumpChallenges[0].accessibleRouteId');
    const same = validAdventure({
      jumpChallenges: [
        {
          id: 'j',
          areaId: 'demo-cove',
          jumpRouteId: 'r1',
          accessibleRouteId: 'r1',
          optional: true,
        },
      ],
    });
    expect(paths(same)).toContain('jumpChallenges[0].accessibleRouteId');
  });

  it('gives optional one meaning: a required challenge with a walking route is valid for every band, Sprouts included (E16)', () => {
    const requiredWithWalk = validAdventure({
      jumpChallenges: [
        {
          id: 'j',
          areaId: 'demo-cove',
          jumpRouteId: 'r1',
          accessibleRouteId: 'r2',
          optional: false,
        },
      ],
    });
    expect(paths(requiredWithWalk)).not.toContain('jumpChallenges[0].optional');
    expect(paths(requiredWithWalk)).not.toContain('jumpChallenges[0].accessibleRouteId');
    const requiredJumpOnly = validAdventure({
      jumpChallenges: [
        {
          id: 'j',
          areaId: 'demo-cove',
          jumpRouteId: 'r1',
          accessibleRouteId: null,
          optional: false,
        },
      ],
    });
    expect(paths(requiredJumpOnly)).toContain('jumpChallenges[0].accessibleRouteId');
  });

  it('needs the jump capability and a checkpoint when jump challenges exist', () => {
    expect(paths(validAdventure({ capabilities: [] }))).toContain('capabilities');
    expect(paths(validAdventure({ checkpoints: [] }))).toContain('checkpoints');
  });

  it('requires a world consequence, learning objectives and areas', () => {
    expect(paths({ ...validAdventure(), worldConsequenceId: '' })).toContain('worldConsequenceId');
    expect(paths(validAdventure({ learningObjectiveIds: [] }))).toContain('learningObjectiveIds');
    expect(paths(validAdventure({ areas: [] }))).toContain('areas');
  });

  it('rejects timers anywhere in the definition (ADR-053)', () => {
    const result = paths({
      ...validAdventure(),
      components: [
        { id: 'c', type: 'gameplay.chest', areaId: 'demo-cove', config: { timeLimit: 30 } },
      ],
    });
    expect(result).toContain('components[0].config.timeLimit');
  });

  it('checks component areas, capabilities and registered types', () => {
    const bad = validAdventure({
      components: [
        { id: 'c1', type: 'gameplay.chest', areaId: 'nowhere', capability: 'movement.fly' },
      ],
    });
    expect(paths(bad)).toEqual(
      expect.arrayContaining(['components[0].areaId', 'components[0].capability']),
    );
    expect(paths(validAdventure(), { componentTypes: { has: () => false } })).toContain(
      'components[0].type',
    );
  });

  it('rejects duplicate semantic ids across components, jumps and checkpoints', () => {
    const dup = validAdventure({ checkpoints: [{ id: 'chest-1', areaId: 'demo-cove' }] });
    expect(
      validateAdventure(dup, registry).issues.some((issue) =>
        issue.message.includes('duplicate semantic id'),
      ),
    ).toBe(true);
  });

  it('reports profile clamping as authoring issues for supported bands', () => {
    const clamped = validAdventure({
      movementProfiles: { PATHFINDER: { jump: { jumpHeight: 7 } } },
    });
    expect(paths(clamped)).toContain('movementProfiles.PATHFINDER.jump.jumpHeight');
    const orphan = validAdventure({
      ageBands: ['EXPLORER'],
      difficultyProfiles: { SPROUT: { maxGapMeters: 0.5 } },
    });
    expect(paths(orphan)).toContain('profiles.SPROUT');
  });

  it('resolves the per-band profile with overrides', () => {
    const adventure = validAdventure({
      movementProfiles: { EXPLORER: { jump: { jumpHeight: 1.5 } } },
    });
    expect(profileFor(adventure, 'EXPLORER').movement.jump.jumpHeight).toBe(1.5);
    expect(profileFor(adventure, 'SPROUT').movement.jump.jumpHeight).toBeLessThan(1);
  });

  it('never throws on hostile input; assertValidAdventure throws a typed error', () => {
    for (const hostile of [null, undefined, 3, 'x', [], { capabilities: 'no', components: 7 }]) {
      expect(validateAdventure(hostile, registry).ok).toBe(false);
    }
    try {
      assertValidAdventure({}, createCapabilityRegistry());
      expect.unreachable();
    } catch (error) {
      expect(isEngineError(error, 'VALIDATION_FAILED')).toBe(true);
    }
  });
});
