import { describe, expect, it } from 'vitest';
import { CASTLE_ROOMS, getCastleRoom } from '../../castleLayout';
import { MAP_DEPTH_METERS, MAP_WIDTH_METERS, tileBox } from './castleMapGeometry';

const pct = (value: string) => Number.parseFloat(value);

describe('castle map geometry', () => {
  it('spans the rooms, floor to floor, in metres: from the westmost wall to the eastmost, south to north', () => {
    const xs = CASTLE_ROOMS.flatMap((room) => [room.floor.minX, room.floor.maxX]);
    const zs = CASTLE_ROOMS.flatMap((room) => [room.floor.minZ, room.floor.maxZ]);
    expect(MAP_WIDTH_METERS).toBe(Math.max(...xs) - Math.min(...xs));
    expect(MAP_DEPTH_METERS).toBe(Math.max(...zs) - Math.min(...zs));
    // The castle's bounds are 32 by 20; the rooms use all of the depth and all but a metre of the width.
    expect(MAP_WIDTH_METERS).toBeLessThanOrEqual(32);
    expect(MAP_DEPTH_METERS).toBeLessThanOrEqual(20);
  });

  it('keeps every tile inside the map, whether or not its room is visible yet', () => {
    for (const room of CASTLE_ROOMS) {
      const box = tileBox(room);
      expect(pct(box.left)).toBeGreaterThanOrEqual(0);
      expect(pct(box.top)).toBeGreaterThanOrEqual(0);
      expect(pct(box.left) + pct(box.width)).toBeLessThanOrEqual(100 + 1e-9);
      expect(pct(box.top) + pct(box.height)).toBeLessThanOrEqual(100 + 1e-9);
    }
  });

  it("draws each tile at its floor's true size and place: width and height in proportion", () => {
    for (const room of CASTLE_ROOMS) {
      const box = tileBox(room);
      expect(pct(box.width)).toBeCloseTo(
        ((room.floor.maxX - room.floor.minX) / MAP_WIDTH_METERS) * 100,
        9,
      );
      expect(pct(box.height)).toBeCloseTo(
        ((room.floor.maxZ - room.floor.minZ) / MAP_DEPTH_METERS) * 100,
        9,
      );
    }
  });

  it('puts north at the top and east to the right, as the castle is laid out', () => {
    const gallery = tileBox(getCastleRoom('character-gallery')!);
    const hall = tileBox(getCastleRoom('story-hall')!);
    const library = tileBox(getCastleRoom('great-library')!);
    const entry = tileBox(getCastleRoom('entry-hall')!);
    // The gallery is north of the hub, the library east of the entry hall.
    expect(pct(gallery.top)).toBeLessThan(pct(hall.top));
    expect(pct(library.left)).toBeGreaterThan(pct(entry.left));
  });

  it('never lets two tiles cover each other, because no two floors overlap', () => {
    const boxes = CASTLE_ROOMS.map((room) => ({ id: room.id, ...tileBox(room) }));
    for (const a of boxes) {
      for (const b of boxes) {
        if (a.id >= b.id) continue;
        const overlaps =
          pct(a.left) < pct(b.left) + pct(b.width) - 1e-9 &&
          pct(b.left) < pct(a.left) + pct(a.width) - 1e-9 &&
          pct(a.top) < pct(b.top) + pct(b.height) - 1e-9 &&
          pct(b.top) < pct(a.top) + pct(a.height) - 1e-9;
        expect(overlaps, `${a.id} covers ${b.id}`).toBe(false);
      }
    }
  });
});
