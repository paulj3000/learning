/**
 * Exploration telemetry (docs/ROADMAP.md Phase 26: "exploration telemetry
 * that follows the existing rule against logging child free-text").
 *
 * Pure, and deliberately built out of a closed vocabulary. Everything this
 * module can emit is an authored id or an integer:
 *
 * - discovery ids and location slugs come from
 *   `src/features/discovery/content/`;
 * - NPC ids come from `src/features/npc/content/`;
 * - counts are derived by arithmetic.
 *
 * There is no field for a nickname, a free-text note, an age, a timestamp of
 * a child's session, or anything a child said, typed, drew, or was asked -
 * and `telemetry.test.ts` asserts that by inspecting the emitted shape, not
 * by trusting this comment. That is the structural version of CLAUDE.md
 * section 13's rule: the record cannot carry child free-text because there
 * is nowhere in it to put any.
 *
 * Two audiences, one derivation. `buildExplorationTelemetry` is the shape an
 * operational log or metric would carry (there is no client-side log sink
 * today, so nothing ships it anywhere yet), and `describeExploration` turns
 * the same numbers into the plain-language lines the parent dashboard shows
 * - so a parent can never be told something the telemetry does not say, and
 * the telemetry can never contain something a parent could not see.
 */
import type { DiscoveryDefinition, DiscoveryKind, WorldStateSnapshot } from './types';

export interface LocationExploration {
  locationSlug: string;
  found: number;
  total: number;
}

export interface ExplorationTelemetry {
  /** Authored secrets this child has found, out of how many exist. */
  found: number;
  total: number;
  /** Authored NPC ids this child has met in the world. */
  charactersMet: number;
  byLocation: readonly LocationExploration[];
  byKind: Readonly<Record<DiscoveryKind, number>>;
  /** The authored ids themselves, for a per-secret operational breakdown. */
  foundDiscoveryIds: readonly string[];
}

const KIND_ORDER: readonly DiscoveryKind[] = [
  'HIDDEN_CAVE',
  'SECRET_PASSAGE',
  'LOCKED_DOOR',
  'HIDDEN_OBJECT',
];

export function buildExplorationTelemetry(
  definitions: readonly DiscoveryDefinition[],
  state: WorldStateSnapshot,
): ExplorationTelemetry {
  // Intersected with the authored list rather than trusting the stored
  // array: an id for a secret this build no longer defines is not something
  // to report a child as having found.
  const foundDiscoveryIds = definitions
    .filter((definition) => state.discoveredIds.includes(definition.id))
    .map((definition) => definition.id);
  const found = new Set(foundDiscoveryIds);

  const byLocation = new Map<string, LocationExploration>();
  const byKind = Object.fromEntries(KIND_ORDER.map((kind) => [kind, 0])) as Record<
    DiscoveryKind,
    number
  >;

  for (const definition of definitions) {
    const entry = byLocation.get(definition.locationSlug) ?? {
      locationSlug: definition.locationSlug,
      found: 0,
      total: 0,
    };
    entry.total += 1;
    if (found.has(definition.id)) {
      entry.found += 1;
      byKind[definition.kind] += 1;
    }
    byLocation.set(definition.locationSlug, entry);
  }

  return {
    found: foundDiscoveryIds.length,
    total: definitions.length,
    charactersMet: state.metCharacterIds.length,
    byLocation: [...byLocation.values()],
    byKind,
    foundDiscoveryIds,
  };
}

/**
 * Plain-language exploration lines for the parent dashboard, in the same
 * deterministic, non-AI style as `buildWeeklySummary`
 * (src/features/parent-dashboard/weeklySummary.ts).
 *
 * Reports what a child *found*, never what they missed. A parent seeing "2
 * of 6" would reasonably read the other four as homework, and the roadmap's
 * own rule for hidden collectibles is that a child is never shown a slot
 * they are behind on (docs/LEARNING_ADVENTURE_ISLAND_EXPLORABLE_WORLD_ROADMAP.md
 * section 19). The total is left out for the same reason.
 */
export function describeExploration(
  telemetry: ExplorationTelemetry,
  nickname: string,
): readonly string[] {
  if (telemetry.found === 0 && telemetry.charactersMet === 0) {
    return [];
  }

  const lines: string[] = [];
  if (telemetry.found > 0) {
    const places = telemetry.byLocation.filter((entry) => entry.found > 0).length;
    lines.push(
      `${nickname} found ${telemetry.found} hidden ${
        telemetry.found === 1 ? 'place' : 'places'
      } by exploring, across ${places} ${places === 1 ? 'part' : 'parts'} of the island.`,
    );
  }
  if (telemetry.charactersMet > 0) {
    lines.push(
      `They have met ${telemetry.charactersMet} ${
        telemetry.charactersMet === 1 ? 'character' : 'characters'
      } out in the world.`,
    );
  }
  return lines;
}
