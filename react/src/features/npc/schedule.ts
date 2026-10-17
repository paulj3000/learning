/**
 * NPC schedules (docs/ROADMAP.md Phase 23). Resolves where a character is
 * right now, so an NPC is a resident of the island rather than a fixture
 * bolted to one screen.
 *
 * The safety rule here is reachability: an NPC whose schedule leaves a time
 * bucket uncovered falls back to its `homeLocationSlug` instead of vanishing.
 * A child who only ever plays after dinner must never be locked out of a
 * quest-giver, so `resolveNpcLocation` is total by construction and
 * `findUnreachableNpcs` exists to catch authoring drift in tests.
 */
import {
  TIME_OF_DAY_ORDER,
  type NpcDefinition,
  type NpcScheduleEntry,
  type TimeOfDay,
} from './types';

/**
 * Time bucket from a local-clock hour. Boundaries are authored product
 * choices, not derived from anything: morning to noon, afternoon to 5pm,
 * evening after that.
 */
export function timeOfDayForDate(date: Date): TimeOfDay {
  const hour = date.getHours();
  if (hour < 12) return 'MORNING';
  if (hour < 17) return 'AFTERNOON';
  return 'EVENING';
}

/** Where `npc` can be found at `timeOfDay`, falling back to its home location. */
export function resolveNpcLocation(
  npc: NpcDefinition,
  timeOfDay: TimeOfDay,
): { locationSlug: string; zoneId?: string } {
  const entry = npc.schedule.find((slot: NpcScheduleEntry) => slot.timeOfDay === timeOfDay);
  return entry
    ? { locationSlug: entry.locationSlug, zoneId: entry.zoneId }
    : { locationSlug: npc.homeLocationSlug };
}

/** Every NPC currently at `locationSlug`, including those there by fallback. */
export function npcsAtLocation(
  npcs: readonly NpcDefinition[],
  locationSlug: string,
  timeOfDay: TimeOfDay,
): NpcDefinition[] {
  return npcs.filter((npc) => resolveNpcLocation(npc, timeOfDay).locationSlug === locationSlug);
}

/**
 * NPCs that no time bucket can reach. Should always be empty — the fallback
 * makes it structurally impossible today — but it is asserted in tests so a
 * future schedule format that drops the fallback fails loudly rather than
 * silently stranding a character.
 */
export function findUnreachableNpcs(npcs: readonly NpcDefinition[]): NpcDefinition[] {
  return npcs.filter((npc) =>
    TIME_OF_DAY_ORDER.every((timeOfDay) => !resolveNpcLocation(npc, timeOfDay).locationSlug),
  );
}
