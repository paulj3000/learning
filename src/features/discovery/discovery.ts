/**
 * The pure rules of exploration (docs/ROADMAP.md Phase 26).
 *
 * No backend, no Phaser, no React. `api.ts` is the only module in this
 * feature that writes anything, so every decision about whether a secret
 * opens is unit-testable on its own - the same split
 * `src/features/quests/` and `src/features/rewards/` already use.
 */
import type {
  DiscoveryContext,
  DiscoveryDefinition,
  DiscoveryId,
  DiscoveryRequirement,
} from './types';

function isRequirementMet(requirement: DiscoveryRequirement, context: DiscoveryContext): boolean {
  switch (requirement.type) {
    case 'ALWAYS':
      return true;
    case 'WORLD_CHANGE_PRESENT':
      return context.worldChangeKeys.includes(requirement.changeKey);
    case 'ITEM_OWNED':
      return context.ownedItemIds.includes(requirement.itemId);
    case 'DISCOVERY_PRESENT':
      return context.discoveredIds.includes(requirement.discoveryId);
  }
}

/**
 * Whether this secret opens for this child right now.
 *
 * An empty `requirements` array means open, matching
 * `isInteractionAvailable`'s own treatment (src/features/island-map/worldObjects.ts) -
 * but authored content always writes `[{ type: 'ALWAYS' }]` explicitly, and
 * `islandDiscoveries.test.ts` asserts it, so "no requirements" can only ever
 * be an authoring slip rather than a deliberate style.
 */
export function isDiscoveryOpen(
  definition: DiscoveryDefinition,
  context: DiscoveryContext,
): boolean {
  return definition.requirements.every((requirement) => isRequirementMet(requirement, context));
}

/** Whether this child has already found this secret. */
export function isDiscoveryFound(
  definition: DiscoveryDefinition,
  context: DiscoveryContext,
): boolean {
  return context.discoveredIds.includes(definition.id);
}

/**
 * What the child sees when they reach this spot.
 *
 * `ALREADY_FOUND` deliberately shows the same `revealMessage` as
 * `FOUND_NOW`: a place a child liked should read the same way the second
 * time they visit, rather than degrading into "nothing here anymore". Only
 * `found` differs, and only `api.ts` acts on it.
 */
export type DiscoveryOutcomeStatus = 'FOUND_NOW' | 'ALREADY_FOUND' | 'LOCKED';

export interface DiscoveryOutcome {
  discoveryId: DiscoveryId;
  title: string;
  status: DiscoveryOutcomeStatus;
  /** The child-facing line to show. Always present, in every status. */
  message: string;
}

export function resolveDiscovery(
  definition: DiscoveryDefinition,
  context: DiscoveryContext,
): DiscoveryOutcome {
  const base = { discoveryId: definition.id, title: definition.title };
  if (isDiscoveryFound(definition, context)) {
    return { ...base, status: 'ALREADY_FOUND', message: definition.revealMessage };
  }
  if (!isDiscoveryOpen(definition, context)) {
    return { ...base, status: 'LOCKED', message: definition.lockedMessage };
  }
  return { ...base, status: 'FOUND_NOW', message: definition.revealMessage };
}

export function findDiscovery(
  definitions: readonly DiscoveryDefinition[],
  id: DiscoveryId,
): DiscoveryDefinition | undefined {
  return definitions.find((definition) => definition.id === id);
}

export function discoveriesForLocation(
  definitions: readonly DiscoveryDefinition[],
  locationSlug: string,
): DiscoveryDefinition[] {
  return definitions.filter((definition) => definition.locationSlug === locationSlug);
}

/** Adds one id to a set of ids, preserving order and never duplicating. */
export function addDiscoveredId(
  ids: readonly DiscoveryId[],
  id: DiscoveryId,
): readonly DiscoveryId[] {
  return ids.includes(id) ? ids : [...ids, id];
}

/**
 * Validates a stored id array against the authored vocabulary it is supposed
 * to be drawn from.
 *
 * A `ChildWorldState` column is external data at read time (CLAUDE.md
 * section 13: "validate all external and AI-generated data at runtime"), the
 * same reason `parseMemoryFlags` exists for `ChildNpcState.memoryFlags`.
 * Anything that is not a string, or not an id this build knows about, is
 * dropped rather than trusted - which also means a discovery deleted from
 * the content pack stops counting the moment it is deleted, instead of
 * lingering in a child's totals as an id nothing can explain.
 */
export function parseKnownIds(stored: unknown, knownIds: readonly string[]): readonly string[] {
  if (!Array.isArray(stored)) return [];
  const known = new Set(knownIds);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of stored) {
    if (typeof entry !== 'string' || !known.has(entry) || seen.has(entry)) continue;
    seen.add(entry);
    result.push(entry);
  }
  return result;
}
