import { describe, expect, it } from 'vitest';
import { buildExplorationTelemetry, describeExploration } from './telemetry';
import { ISLAND_DISCOVERIES } from './content';
import type { DiscoveryDefinition, WorldStateSnapshot } from './types';

const definitions: DiscoveryDefinition[] = [
  {
    id: 'harbor-pool',
    locationSlug: 'welcome-harbor',
    kind: 'HIDDEN_OBJECT',
    title: 'Pool',
    revealMessage: 'r',
    lockedMessage: 'l',
    requirements: [{ type: 'ALWAYS' }],
  },
  {
    id: 'harbor-door',
    locationSlug: 'welcome-harbor',
    kind: 'LOCKED_DOOR',
    title: 'Door',
    revealMessage: 'r',
    lockedMessage: 'l',
    requirements: [{ type: 'ALWAYS' }],
  },
  {
    id: 'forest-cave',
    locationSlug: 'wonderwild-forest',
    kind: 'HIDDEN_CAVE',
    title: 'Cave',
    revealMessage: 'r',
    lockedMessage: 'l',
    requirements: [{ type: 'ALWAYS' }],
  },
];

function state(overrides: Partial<WorldStateSnapshot> = {}): WorldStateSnapshot {
  return { discoveredIds: [], metCharacterIds: [], ...overrides };
}

describe('buildExplorationTelemetry', () => {
  it('counts found against total, per location and per kind', () => {
    const telemetry = buildExplorationTelemetry(
      definitions,
      state({ discoveredIds: ['harbor-pool', 'forest-cave'], metCharacterIds: ['pirate-pip'] }),
    );

    expect(telemetry.found).toBe(2);
    expect(telemetry.total).toBe(3);
    expect(telemetry.charactersMet).toBe(1);
    expect(telemetry.byLocation).toEqual([
      { locationSlug: 'welcome-harbor', found: 1, total: 2 },
      { locationSlug: 'wonderwild-forest', found: 1, total: 1 },
    ]);
    expect(telemetry.byKind).toEqual({
      HIDDEN_CAVE: 1,
      SECRET_PASSAGE: 0,
      LOCKED_DOOR: 0,
      HIDDEN_OBJECT: 1,
    });
  });

  it('ignores a stored id this build no longer defines', () => {
    const telemetry = buildExplorationTelemetry(
      definitions,
      state({ discoveredIds: ['harbor-pool', 'a-secret-that-was-deleted'] }),
    );

    expect(telemetry.found).toBe(1);
    expect(telemetry.foundDiscoveryIds).toEqual(['harbor-pool']);
  });

  it('reports zeros for a child who has explored nothing', () => {
    const telemetry = buildExplorationTelemetry(definitions, state());
    expect(telemetry.found).toBe(0);
    expect(telemetry.foundDiscoveryIds).toEqual([]);
  });
});

/**
 * The Phase 26 deliverable is "exploration telemetry that follows the
 * existing rule against logging child free-text" (CLAUDE.md section 13).
 * This asserts the *shape*: everything emitted is either an integer or a
 * string drawn from the authored content pack. There is nowhere in the
 * record to put anything a child said, typed, drew, or was asked, so the
 * rule holds structurally rather than by care at the call site.
 */
describe('exploration telemetry carries no child free-text', () => {
  const telemetry = buildExplorationTelemetry(
    ISLAND_DISCOVERIES,
    state({
      discoveredIds: ISLAND_DISCOVERIES.map((discovery) => discovery.id),
      metCharacterIds: ['pirate-pip', 'keeper-quill'],
    }),
  );

  const AUTHORED_STRINGS = new Set([
    ...ISLAND_DISCOVERIES.map((discovery) => discovery.id),
    ...ISLAND_DISCOVERIES.map((discovery) => discovery.locationSlug),
  ]);

  it('emits only integers and authored ids, at every depth', () => {
    const strings: string[] = [];
    const walk = (value: unknown): void => {
      if (typeof value === 'string') {
        strings.push(value);
        return;
      }
      if (typeof value === 'number') {
        expect(Number.isInteger(value)).toBe(true);
        return;
      }
      if (Array.isArray(value)) {
        value.forEach(walk);
        return;
      }
      if (value && typeof value === 'object') {
        Object.values(value).forEach(walk);
        return;
      }
      // Nothing else may appear: no dates, no functions, no null holes.
      expect(value).toBeUndefined();
    };
    walk(telemetry);

    expect(strings.length).toBeGreaterThan(0);
    for (const value of strings) {
      expect(AUTHORED_STRINGS.has(value), `"${value}" is not authored content`).toBe(true);
    }
  });

  it('has no field for a nickname, note, transcript, or timestamp', () => {
    const keys = Object.keys(telemetry);
    expect(
      keys.filter((key) =>
        /name|nick|note|text|message|transcript|answer|said|age|at$|time/i.test(key),
      ),
    ).toEqual([]);
  });
});

describe('describeExploration', () => {
  it('says nothing at all when a child has not explored yet', () => {
    expect(describeExploration(buildExplorationTelemetry(definitions, state()), 'Sam')).toEqual([]);
  });

  it('reports what was found, and never what is left', () => {
    const lines = describeExploration(
      buildExplorationTelemetry(
        definitions,
        state({ discoveredIds: ['harbor-pool', 'forest-cave'], metCharacterIds: ['pirate-pip'] }),
      ),
      'Sam',
    );

    expect(lines[0]).toBe('Sam found 2 hidden places by exploring, across 2 parts of the island.');
    expect(lines[1]).toBe('They have met 1 character out in the world.');
    // No "of 3", no "1 left", nothing a parent could read as homework
    // (docs/LEARNING_ADVENTURE_ISLAND_EXPLORABLE_WORLD_ROADMAP.md section 19).
    for (const line of lines) {
      expect(line).not.toMatch(/ of \d| left|remaining|missing|still to/i);
    }
  });

  it('uses singular wording for one of each', () => {
    const lines = describeExploration(
      buildExplorationTelemetry(
        definitions,
        state({ discoveredIds: ['harbor-pool'], metCharacterIds: ['pirate-pip'] }),
      ),
      'Sam',
    );

    expect(lines[0]).toBe('Sam found 1 hidden place by exploring, across 1 part of the island.');
    expect(lines[1]).toBe('They have met 1 character out in the world.');
  });

  it('avoids em dashes in parent-facing copy (CLAUDE.md section 13)', () => {
    const lines = describeExploration(
      buildExplorationTelemetry(definitions, state({ discoveredIds: ['harbor-pool'] })),
      'Sam',
    );
    for (const line of lines) {
      expect(line).not.toContain('—');
    }
  });
});
