import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AgeBandValue } from '../child-profile/constants';
import { MAX_SPOKEN_LENGTH_BY_AGE_BAND } from '../companion/limits';
import { CASTLE_ROOM_IDS } from '../island-map/three/castleLayout';
import { castleDefaultLine, CASTLE_DEFAULT_LINES } from './castleDefaultLines';

const BANDS: AgeBandValue[] = ['SPROUT', 'PATHFINDER', 'EXPLORER'];

interface SeedEvent {
  id: string;
  room: string;
  fallback: boolean;
  lines: Record<AgeBandValue, string[]>;
}

const seed = JSON.parse(
  readFileSync(resolve(process.cwd(), '../lai/apps/regions/castle_events.json'), 'utf8'),
) as { events: SeedEvent[] };

describe('the castle offline default lines', () => {
  it('has a line for every castle room and age band, and no other room', () => {
    expect(Object.keys(CASTLE_DEFAULT_LINES).sort()).toEqual([...CASTLE_ROOM_IDS].sort());
    for (const room of CASTLE_ROOM_IDS) {
      for (const band of BANDS) expect(castleDefaultLine(room, band), `${room} ${band}`).toBeTruthy();
    }
    expect(castleDefaultLine('no-such-room', 'SPROUT')).toBeUndefined();
  });

  it('keeps every line short, readable aloud and free of pressure, claims and dashes', () => {
    for (const lines of Object.values(CASTLE_DEFAULT_LINES)) {
      for (const band of BANDS) {
        const line = lines[band];
        expect(line.length).toBeLessThanOrEqual(MAX_SPOKEN_LENGTH_BY_AGE_BAND[band]);
        expect(line).not.toMatch(/[–—]/);
        expect(line).not.toMatch(/https?:|www\./i);
        expect(line).not.toMatch(/tomorrow|come back|streak|countdown|hurry|miss(ed)? you|reward|unlock/i);
      }
    }
  });

  it('is a snapshot of the seed quiet default per room (drift test; Django owns the catalog)', () => {
    const quiet = seed.events.filter((e) => e.fallback);
    expect(quiet.map((e) => e.room).sort()).toEqual([...CASTLE_ROOM_IDS].sort());
    for (const event of quiet) {
      for (const band of BANDS) {
        expect(CASTLE_DEFAULT_LINES[event.room]?.[band], `${event.id} ${band}`).toBe(
          event.lines[band][0],
        );
      }
    }
  });

  it('uses the room ids the server records', () => {
    const rooms = JSON.parse(
      readFileSync(resolve(process.cwd(), '../lai/apps/regions/castle_rooms.json'), 'utf8'),
    ) as { rooms: string[] };
    expect(rooms.rooms).toEqual([...CASTLE_ROOM_IDS]);
  });
});
