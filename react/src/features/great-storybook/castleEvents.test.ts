import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { AgeBandValue } from '../child-profile/constants';
import { MAX_SPOKEN_LENGTH_BY_AGE_BAND } from '../companion/limits';
import { CASTLE_ROOM_IDS } from '../island-map/three/castleLayout';
import {
  allCastleEventLines,
  CASTLE_EVENTS,
  defaultEvent,
  eligibleEvents,
  type CastleEvent,
  type CastleEventState,
} from './castleEvents';

const BANDS: AgeBandValue[] = ['SPROUT', 'PATHFINDER', 'EXPLORER'];

function event(overrides: Partial<CastleEvent> & { id: string }): CastleEvent {
  return {
    status: 'PUBLISHED',
    version: 1,
    room: 'story-hall',
    bands: BANDS,
    requires: [],
    repeat: { maxShows: null, minVisitGap: 0 },
    weight: 2,
    npcId: null,
    lines: { SPROUT: ['a'], PATHFINDER: ['b'], EXPLORER: ['c'] },
    visual: { kind: 'dust-motes' },
    fallback: false,
    secret: true,
    ...overrides,
  };
}

function state(overrides: Partial<CastleEventState> = {}): CastleEventState {
  return {
    ageBand: 'PATHFINDER',
    roomId: 'story-hall',
    conditions: { worldChanges: [], questStatuses: {}, relationshipLevels: {} },
    shownCounts: {},
    lastShownVisit: {},
    currentVisitIndex: 5,
    ...overrides,
  };
}

const ids = (events: readonly CastleEvent[]) => events.map((e) => e.id);

describe('eligibleEvents', () => {
  it('keeps only PUBLISHED events', () => {
    const catalog = [
      event({ id: 'a', status: 'DRAFT' }),
      event({ id: 'b', status: 'RETIRED' }),
      event({ id: 'c' }),
    ];
    expect(ids(eligibleEvents(catalog, state()))).toEqual(['c']);
  });

  it('filters by age band and by room, with ANY matching every room', () => {
    const catalog = [
      event({ id: 'sprout', bands: ['SPROUT'] }),
      event({ id: 'elsewhere', room: 'great-library' }),
      event({ id: 'anywhere', room: 'ANY' }),
      event({ id: 'here' }),
    ];
    expect(ids(eligibleEvents(catalog, state()))).toEqual(['anywhere', 'here']);
    expect(ids(eligibleEvents(catalog, state({ ageBand: 'SPROUT' })))).toEqual([
      'anywhere',
      'here',
      'sprout',
    ]);
  });

  it('checks every requirement, and an unknown type never holds', () => {
    const conditions = {
      worldChanges: [{ place: 'storykeeper-castle', key: 'FIRST_STORY_TOLD' }],
      questStatuses: { q: 'COMPLETED' },
      relationshipLevels: { 'keeper-quill': 'FRIEND' },
    };
    const open = state({ conditions });
    const closed = state();
    const worldChange = event({
      id: 'wc',
      requires: [{ type: 'WORLD_CHANGE', key: 'FIRST_STORY_TOLD', place: 'storykeeper-castle' }],
    });
    const wrongPlace = event({
      id: 'wp',
      requires: [{ type: 'WORLD_CHANGE', key: 'FIRST_STORY_TOLD', place: 'elsewhere' }],
    });
    const absent = event({
      id: 'abs',
      requires: [{ type: 'WORLD_CHANGE', key: 'FIRST_STORY_TOLD', present: false }],
    });
    const quest = event({ id: 'q', requires: [{ type: 'QUEST_STATUS', quest: 'q', status: 'COMPLETED' }] });
    const friend = event({
      id: 'f',
      npcId: 'keeper-quill',
      requires: [{ type: 'RELATIONSHIP_AT_LEAST', level: 'ACQUAINTANCE' }],
    });
    const tooHigh = event({
      id: 'th',
      npcId: 'keeper-quill',
      requires: [{ type: 'RELATIONSHIP_AT_LEAST', level: 'TRUSTED_FRIEND' }],
    });
    const noNpc = event({ id: 'nn', requires: [{ type: 'RELATIONSHIP_AT_LEAST', level: 'STRANGER' }] });
    const unknown = event({
      id: 'u',
      requires: [{ type: 'LOCAL_FLAG', flag: 'x' } as unknown as CastleEvent['requires'][number]],
    });
    const catalog = [worldChange, wrongPlace, absent, quest, friend, tooHigh, noNpc, unknown];
    expect(ids(eligibleEvents(catalog, open))).toEqual(['f', 'q', 'wc']);
    expect(ids(eligibleEvents(catalog, closed))).toEqual(['abs']);
  });

  it('stops at maxShows', () => {
    const catalog = [event({ id: 'a', repeat: { maxShows: 2, minVisitGap: 0 } })];
    expect(eligibleEvents(catalog, state({ shownCounts: { a: 1 } }))).toHaveLength(1);
    expect(eligibleEvents(catalog, state({ shownCounts: { a: 2 } }))).toHaveLength(0);
  });

  it('applies minVisitGap in visits, exactly at the boundary', () => {
    const catalog = [event({ id: 'a', repeat: { maxShows: null, minVisitGap: 2 } })];
    const at = (visit: number) =>
      eligibleEvents(catalog, state({ lastShownVisit: { a: 3 }, currentVisitIndex: visit }));
    expect(at(4)).toHaveLength(0);
    expect(at(5)).toHaveLength(1);
    expect(at(40)).toHaveLength(1);
  });

  it('orders by weight (heavy first) then id, whatever the catalog order', () => {
    const catalog = [
      event({ id: 'b', weight: 2 }),
      event({ id: 'a', weight: 2 }),
      event({ id: 'z', weight: 5 }),
      event({ id: 'y', weight: 1 }),
    ];
    const expected = ['z', 'a', 'b', 'y'];
    expect(ids(eligibleEvents(catalog, state()))).toEqual(expected);
    expect(ids(eligibleEvents([...catalog].reverse(), state()))).toEqual(expected);
  });

  it('does not depend on the clock', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2020-01-01T00:00:00Z'));
      const first = ids(eligibleEvents(CASTLE_EVENTS, state()));
      vi.setSystemTime(new Date('2031-06-30T12:00:00Z'));
      expect(ids(eligibleEvents(CASTLE_EVENTS, state()))).toEqual(first);
    } finally {
      vi.useRealTimers();
    }
  });

  it('is not changed by being away: the same visit index gives the same answer', () => {
    const a = eligibleEvents(CASTLE_EVENTS, state({ currentVisitIndex: 9, lastShownVisit: {} }));
    const b = eligibleEvents(CASTLE_EVENTS, state({ currentVisitIndex: 9, lastShownVisit: {} }));
    expect(ids(a)).toEqual(ids(b));
  });
});

describe('defaultEvent', () => {
  it('is the first eligible event', () => {
    const catalog = [event({ id: 'b' }), event({ id: 'a', weight: 4 })];
    expect(defaultEvent(catalog, state())?.id).toBe('a');
  });

  it('falls back to the room fallback event when nothing is eligible', () => {
    const catalog = [
      event({ id: 'quiet', fallback: true, repeat: { maxShows: 1, minVisitGap: 0 } }),
      event({ id: 'other', room: 'great-library', fallback: true }),
    ];
    const spent = state({ shownCounts: { quiet: 9 } });
    expect(eligibleEvents(catalog, spent)).toHaveLength(0);
    expect(defaultEvent(catalog, spent)?.id).toBe('quiet');
  });

  it('is null only when the catalog has no fallback for that room and band', () => {
    expect(defaultEvent([], state())).toBeNull();
  });
});

describe('the shipped catalog', () => {
  it('has a fallback event for every castle room and every age band', () => {
    for (const room of CASTLE_ROOM_IDS) {
      for (const ageBand of BANDS) {
        const fallbacks = CASTLE_EVENTS.filter(
          (e) => e.fallback && e.room === room && e.bands.includes(ageBand),
        );
        expect(fallbacks, `${room} ${ageBand}`).toHaveLength(1);
        const result = defaultEvent(CASTLE_EVENTS, state({ roomId: room, ageBand }));
        expect(result).not.toBeNull();
      }
    }
  });

  it('has exactly one fallback event per room and stable, unique ids', () => {
    for (const room of CASTLE_ROOM_IDS) {
      expect(CASTLE_EVENTS.filter((e) => e.fallback && e.room === room)).toHaveLength(1);
    }
    const all = CASTLE_EVENTS.map((e) => e.id);
    expect(new Set(all).size).toBe(all.length);
    for (const id of all) expect(id).toMatch(/^[a-z][a-z0-9-]*$/);
  });

  it('uses only existing rooms, known NPCs and supported conditions, and no memory flags', () => {
    for (const e of CASTLE_EVENTS) {
      expect(e.room === 'ANY' || (CASTLE_ROOM_IDS as readonly string[]).includes(e.room)).toBe(true);
      expect([null, 'keeper-quill', 'ember-dragon']).toContain(e.npcId);
      expect(e.weight).toBeGreaterThanOrEqual(1);
      expect(e.weight).toBeLessThanOrEqual(5);
      expect(e.secret).toBe(true);
      for (const c of e.requires) {
        expect(['ALWAYS', 'WORLD_CHANGE', 'QUEST_STATUS', 'RELATIONSHIP_AT_LEAST']).toContain(c.type);
      }
    }
  });

  it('keeps every line within its age band limit and free of pressure, claims and dashes', () => {
    for (const e of CASTLE_EVENTS) {
      for (const band of BANDS) {
        expect(e.lines[band].length, `${e.id} ${band}`).toBeGreaterThan(0);
        for (const line of e.lines[band]) {
          expect(line.length).toBeLessThanOrEqual(MAX_SPOKEN_LENGTH_BY_AGE_BAND[band]);
        }
      }
    }
    for (const line of allCastleEventLines()) {
      expect(line).not.toMatch(/[–—]/);
      expect(line).not.toMatch(/https?:|www\./i);
      expect(line).not.toMatch(/tomorrow|come back|streak|countdown|hurry|miss(ed)? you|reward|unlock/i);
    }
  });

  it('grants nothing: an event has no reward, quest, progress or world-change field', () => {
    const allowed = new Set([
      'id', 'status', 'version', 'room', 'bands', 'requires', 'repeat', 'weight', 'npcId',
      'lines', 'visual', 'fallback', 'secret',
    ]);
    for (const e of CASTLE_EVENTS) {
      expect(Object.keys(e).filter((k) => !allowed.has(k))).toEqual([]);
    }
  });

  it('has fewer lines for Sprouts than words for Explorers (voice-first, short)', () => {
    for (const e of CASTLE_EVENTS) {
      expect(e.lines.SPROUT[0]?.length ?? 0).toBeLessThanOrEqual(
        e.lines.EXPLORER[0]?.length ?? 0,
      );
    }
  });
});

describe('the server mirror', () => {
  const server = JSON.parse(
    readFileSync(resolve(process.cwd(), '../lai/apps/regions/castle_events.json'), 'utf8'),
  ) as { events: unknown[] };

  it('is exactly the client catalog, field for field', () => {
    expect(server.events).toEqual(JSON.parse(JSON.stringify(CASTLE_EVENTS)));
  });

  it('uses the room ids the server records', () => {
    const rooms = JSON.parse(
      readFileSync(resolve(process.cwd(), '../lai/apps/regions/castle_rooms.json'), 'utf8'),
    ) as { rooms: string[] };
    expect(rooms.rooms).toEqual([...CASTLE_ROOM_IDS]);
  });
});
