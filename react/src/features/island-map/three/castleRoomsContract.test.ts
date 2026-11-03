import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CASTLE_ROOMS, CASTLE_ROOM_IDS, SECRET_PASSAGE_DISCOVERY_ID } from './castleLayout';

/**
 * The server records only the room ids in `lai/apps/regions/castle_rooms.json`
 * (SC-R03-06), and this client names its rooms by `CASTLE_ROOM_IDS`. The two
 * must be the same list, in the same order, with the same secrets: otherwise
 * a room the client offers is a room the server refuses, or the reverse. This
 * is the drift guard the JSON's own comment promises.
 */
// Vitest runs from the `react/` workspace, one level below the repository root.
const server = JSON.parse(
  readFileSync(resolve(process.cwd(), '../lai/apps/regions/castle_rooms.json'), 'utf8'),
) as {
  locationSlug: string;
  changeType: string;
  rooms: string[];
  secretRooms: Record<string, string>;
};

describe('the castle room ids the server records', () => {
  it('are exactly the client rooms, in the same order', () => {
    expect(server.rooms).toEqual([...CASTLE_ROOM_IDS]);
  });

  it('name as secrets exactly the rooms the client hides, with the discovery the client waits for', () => {
    const hidden = Object.fromEntries(
      CASTLE_ROOMS.filter((room) => room.hiddenUntil.length > 0).map((room) => [
        room.id,
        room.hiddenUntil
          .map((r) => (r.type === 'DISCOVERY_PRESENT' ? r.discoveryId : ''))
          .join(','),
      ]),
    );
    expect(server.secretRooms).toEqual(hidden);
    expect(Object.values(server.secretRooms)).toEqual([SECRET_PASSAGE_DISCOVERY_ID]);
  });

  it('record under the castle location and a type no other feature uses', () => {
    expect(server.locationSlug).toBe('storykeeper-castle');
    expect(server.changeType).toBe('ROOM_DISCOVERED');
  });

  it('are slugs the closed request body accepts', () => {
    for (const id of server.rooms) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });
});
