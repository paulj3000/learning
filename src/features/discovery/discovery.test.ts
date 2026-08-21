import { describe, expect, it } from 'vitest';
import {
  addDiscoveredId,
  discoveriesForLocation,
  findDiscovery,
  isDiscoveryFound,
  isDiscoveryOpen,
  parseKnownIds,
  resolveDiscovery,
} from './discovery';
import { EMPTY_DISCOVERY_CONTEXT } from './types';
import type { DiscoveryContext, DiscoveryDefinition } from './types';

function discovery(overrides: Partial<DiscoveryDefinition> = {}): DiscoveryDefinition {
  return {
    id: 'test-cave',
    locationSlug: 'wonderwild-forest',
    kind: 'HIDDEN_CAVE',
    title: 'A cave',
    revealMessage: 'The cave is full of light.',
    lockedMessage: 'It is too dark to see.',
    requirements: [{ type: 'ALWAYS' }],
    ...overrides,
  };
}

function context(overrides: Partial<DiscoveryContext> = {}): DiscoveryContext {
  return { ...EMPTY_DISCOVERY_CONTEXT, ...overrides };
}

describe('isDiscoveryOpen', () => {
  it('opens an ALWAYS secret for a child who has done nothing', () => {
    expect(isDiscoveryOpen(discovery(), context())).toBe(true);
  });

  it('requires every requirement, not just one', () => {
    const definition = discovery({
      requirements: [
        { type: 'ITEM_OWNED', itemId: 'lantern' },
        { type: 'WORLD_CHANGE_PRESENT', changeKey: 'BRIDGE_REPAIRED' },
      ],
    });

    expect(isDiscoveryOpen(definition, context({ ownedItemIds: ['lantern'] }))).toBe(false);
    expect(
      isDiscoveryOpen(
        definition,
        context({ ownedItemIds: ['lantern'], worldChangeKeys: ['BRIDGE_REPAIRED'] }),
      ),
    ).toBe(true);
  });

  it('chains on another discovery', () => {
    const definition = discovery({
      requirements: [{ type: 'DISCOVERY_PRESENT', discoveryId: 'glow-moss' }],
    });

    expect(isDiscoveryOpen(definition, context())).toBe(false);
    expect(isDiscoveryOpen(definition, context({ discoveredIds: ['glow-moss'] }))).toBe(true);
  });
});

describe('resolveDiscovery', () => {
  it('shows the locked line, not a refusal, when the child cannot open it yet', () => {
    const definition = discovery({ requirements: [{ type: 'ITEM_OWNED', itemId: 'lantern' }] });
    const outcome = resolveDiscovery(definition, context());

    expect(outcome.status).toBe('LOCKED');
    expect(outcome.message).toBe('It is too dark to see.');
    expect(outcome.title).toBe('A cave');
  });

  it('reports FOUND_NOW the first time and ALREADY_FOUND after', () => {
    const definition = discovery();

    expect(resolveDiscovery(definition, context()).status).toBe('FOUND_NOW');
    expect(resolveDiscovery(definition, context({ discoveredIds: ['test-cave'] })).status).toBe(
      'ALREADY_FOUND',
    );
  });

  /**
   * A place a child liked should read the same way the second time they
   * visit. Degrading it into "nothing here anymore" would punish revisiting
   * somewhere they enjoyed.
   */
  it('says the same thing on a return visit as on the first', () => {
    const definition = discovery();
    const first = resolveDiscovery(definition, context());
    const second = resolveDiscovery(definition, context({ discoveredIds: ['test-cave'] }));

    expect(second.message).toBe(first.message);
  });

  /**
   * A found secret stays found even if its requirement later stops holding.
   * Nothing in the authored content takes an item away today, but the engine
   * must not depend on that: a child who finds the glowworm cave and later
   * loses the jar has still found the cave.
   */
  it('keeps a found secret found even when its requirement no longer holds', () => {
    const definition = discovery({ requirements: [{ type: 'ITEM_OWNED', itemId: 'lantern' }] });
    const outcome = resolveDiscovery(definition, context({ discoveredIds: ['test-cave'] }));

    expect(outcome.status).toBe('ALREADY_FOUND');
  });
});

describe('isDiscoveryFound', () => {
  it('is false for a secret this child has not found', () => {
    expect(isDiscoveryFound(discovery(), context({ discoveredIds: ['other'] }))).toBe(false);
  });
});

describe('addDiscoveredId', () => {
  it('appends once and never duplicates', () => {
    expect(addDiscoveredId(['a'], 'b')).toEqual(['a', 'b']);
    expect(addDiscoveredId(['a', 'b'], 'b')).toEqual(['a', 'b']);
  });
});

describe('lookup helpers', () => {
  const definitions = [discovery(), discovery({ id: 'other', locationSlug: 'welcome-harbor' })];

  it('finds by id and filters by location', () => {
    expect(findDiscovery(definitions, 'other')?.locationSlug).toBe('welcome-harbor');
    expect(findDiscovery(definitions, 'nope')).toBeUndefined();
    expect(discoveriesForLocation(definitions, 'wonderwild-forest').map((d) => d.id)).toEqual([
      'test-cave',
    ]);
  });
});

/**
 * A stored column is external data at read time (CLAUDE.md section 13). The
 * point of validating against the authored vocabulary is not tidiness: it is
 * that `ChildWorldState` must be structurally incapable of holding anything
 * a child typed, so anything unrecognized is dropped rather than surfaced.
 */
describe('parseKnownIds', () => {
  const known = ['harbor-tide-pool', 'bay-tide-tunnel'];

  it('keeps only ids the current build knows about', () => {
    expect(parseKnownIds(['harbor-tide-pool', 'deleted-secret'], known)).toEqual([
      'harbor-tide-pool',
    ]);
  });

  it('drops anything that is not a string, including free text a bug could have written', () => {
    expect(
      parseKnownIds([null, 42, { id: 'x' }, 'my name is Sam', 'bay-tide-tunnel'], known),
    ).toEqual(['bay-tide-tunnel']);
  });

  it('deduplicates and returns an empty array for a non-array column', () => {
    expect(parseKnownIds(['bay-tide-tunnel', 'bay-tide-tunnel'], known)).toEqual([
      'bay-tide-tunnel',
    ]);
    expect(parseKnownIds(null, known)).toEqual([]);
    expect(parseKnownIds('bay-tide-tunnel', known)).toEqual([]);
  });
});
