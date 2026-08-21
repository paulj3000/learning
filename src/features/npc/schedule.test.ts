import { describe, expect, it } from 'vitest';
import {
  findUnreachableNpcs,
  npcsAtLocation,
  resolveNpcLocation,
  timeOfDayForDate,
} from './schedule';
import { ISLAND_NPCS } from './content';
import { TIME_OF_DAY_ORDER, type NpcDefinition } from './types';

const npc: NpcDefinition = {
  id: 'test-npc',
  displayName: 'Test',
  role: 'test',
  homeLocationSlug: 'welcome-harbor',
  interactionId: 'talk-to-test',
  schedule: [{ timeOfDay: 'MORNING', locationSlug: 'pirate-builder-bay', zoneId: 'dock' }],
  dialogue: [],
  questOffers: [],
};

describe('timeOfDayForDate', () => {
  it('buckets the local-clock hour', () => {
    expect(timeOfDayForDate(new Date(2026, 0, 1, 9, 0))).toBe('MORNING');
    expect(timeOfDayForDate(new Date(2026, 0, 1, 13, 0))).toBe('AFTERNOON');
    expect(timeOfDayForDate(new Date(2026, 0, 1, 19, 0))).toBe('EVENING');
  });

  it('puts each boundary hour in the later bucket', () => {
    expect(timeOfDayForDate(new Date(2026, 0, 1, 11, 59))).toBe('MORNING');
    expect(timeOfDayForDate(new Date(2026, 0, 1, 12, 0))).toBe('AFTERNOON');
    expect(timeOfDayForDate(new Date(2026, 0, 1, 16, 59))).toBe('AFTERNOON');
    expect(timeOfDayForDate(new Date(2026, 0, 1, 17, 0))).toBe('EVENING');
  });
});

describe('resolveNpcLocation', () => {
  it('uses the matching schedule entry, zone included', () => {
    expect(resolveNpcLocation(npc, 'MORNING')).toEqual({
      locationSlug: 'pirate-builder-bay',
      zoneId: 'dock',
    });
  });

  it('falls back to the home location for an uncovered bucket', () => {
    expect(resolveNpcLocation(npc, 'EVENING')).toEqual({ locationSlug: 'welcome-harbor' });
  });
});

describe('npcsAtLocation', () => {
  it('includes NPCs present by schedule and by fallback', () => {
    expect(npcsAtLocation([npc], 'pirate-builder-bay', 'MORNING')).toHaveLength(1);
    expect(npcsAtLocation([npc], 'welcome-harbor', 'EVENING')).toHaveLength(1);
    expect(npcsAtLocation([npc], 'welcome-harbor', 'MORNING')).toHaveLength(0);
  });
});

describe('reachability', () => {
  it('leaves no NPC unreachable', () => {
    expect(findUnreachableNpcs(ISLAND_NPCS)).toEqual([]);
  });

  it('makes every authored NPC findable in every time bucket', () => {
    for (const islandNpc of ISLAND_NPCS) {
      for (const timeOfDay of TIME_OF_DAY_ORDER) {
        expect(resolveNpcLocation(islandNpc, timeOfDay).locationSlug).toBeTruthy();
      }
    }
  });
});
