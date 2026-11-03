import { describe, expect, it } from 'vitest';
import {
  ALL_ENTITY_IDS,
  ARCHWAYS,
  COSTUME_RACK_SPOTS,
  FLOOR_SPOTS,
  GALLERY_PORTRAIT_SPOTS,
  ROOMS,
  STORYKEEPER_CASTLE_REGION_CHECKPOINTS,
  WALL_MOUNTED_SPOTS,
  WALL_SEGMENTS,
  WALL_THICKNESS,
  ZONES,
} from '../../storykeeperCastleRegion';
import type { ScenerySpec, SurfaceSpec } from '../locationManifest';
import {
  hasReachableCellNear,
  reachableCells,
  zoneIsEnterable,
} from '../testing/castleReachability';
import { validateLocationManifest } from '../validateLocationManifest';
import { RENDER_QUALITY_PRESETS, selectLightsForQuality } from '../visual/renderQuality';
import { SOURCE_MANIFEST_REGISTRIES } from '../sourceManifestRegistries';
import { STORYKEEPER_CASTLE_MANIFEST as MANIFEST } from './storykeeperCastle';
import {
  CASTLE_DECOR,
  CASTLE_DECOR_COLLIDERS,
  CASTLE_EFFECTS,
  CASTLE_EXTRA_LIGHTS,
  CASTLE_MATERIALS,
  CASTLE_SURFACES,
  CORRIDOR_MAP,
  castleRoomMood,
  FLOOR_SURFACE_Y,
  PAINT_TABLE,
  INLAY_SURFACE_Y,
  ENTRY_MURAL,
  ROOM_LOOKS,
  STORYBOOK_DAIS,
  TOWER_ORRERY,
  TRIM_SURFACE_INSET,
  WALL_SURFACE_INSET,
  type RoomLook,
} from './storykeeperCastleVisuals';

/**
 * The castle's look is data over the generic visual system, so what is worth
 * testing here is the data: that every preset is declared and worn, that a
 * wall surface never shares a plane with the kit panel under it or covers a
 * doorway, that solid decor never walls anything in, and that the budgets
 * the art direction promised (section 7) hold as the castle grows.
 */

const HALF = WALL_THICKNESS / 2;
const FAR = 1e-9;

const materialIdsOf = (look: RoomLook): string[] =>
  [
    look.floor,
    look.walls,
    look.ceiling,
    look.wainscot?.materialId,
    look.trim,
    ...(look.inlays ?? []).map((inlay) => inlay.materialId),
  ].filter((id): id is string => id !== undefined);

/** Authored spots a solid piece of decor *is*, rather than hides: the hearth is the hearth. */
const IS_THE_SPOT: Readonly<Record<string, readonly string[]>> = {
  'collider:hearth': ['hall-hearth', 'hall-hearth-mantel'],
  'collider:costume-rack-a': ['costume-rack-a'],
  'collider:costume-rack-b': ['costume-rack-b'],
  'collider:costume-rack-c': ['costume-rack-c'],
};

const surfacesOf = (roomId: string): SurfaceSpec[] =>
  CASTLE_SURFACES.filter((surface) => surface.id.startsWith(`look:${roomId}:`));

describe('castle materials', () => {
  it('declares every preset a look wears, and none that nobody wears', () => {
    const worn = new Set(ROOM_LOOKS.flatMap(materialIdsOf));
    const declared = CASTLE_MATERIALS.map((preset) => preset.id);
    expect(new Set(declared).size).toBe(declared.length);
    expect([...worn].sort()).toEqual([...declared].sort());
  });

  it('stays inside the art direction budget of sixteen presets', () => {
    expect(CASTLE_MATERIALS.length).toBeLessThanOrEqual(16);
  });

  it('names a preset for what it is, never for where a file came from', () => {
    for (const preset of CASTLE_MATERIALS) expect(preset.id).toMatch(/^[a-z]+(-[a-z]+)+$/);
  });
});

describe('castle looks', () => {
  it('only dresses rooms the castle has, once each', () => {
    const roomIds = ROOM_LOOKS.map((look) => look.roomId);
    expect(new Set(roomIds).size).toBe(roomIds.length);
    for (const id of roomIds) expect(ROOMS.map((room) => room.id)).toContain(id);
  });

  it('gives a dressed room a floor, a ceiling and walls in declared materials', () => {
    const declared = new Set(CASTLE_MATERIALS.map((preset) => preset.id));
    for (const look of ROOM_LOOKS) {
      const kinds = surfacesOf(look.roomId).map((surface) => surface.id.split(':')[2]);
      expect(kinds).toEqual(expect.arrayContaining(['floor', 'ceiling', 'walls']));
      for (const surface of surfacesOf(look.roomId)) {
        expect(declared.has(surface.materialId), `${surface.id} -> ${surface.materialId}`).toBe(
          true,
        );
        expect(surface.faces.length).toBeGreaterThan(0);
      }
    }
  });

  it('lays each floor and ceiling over exactly its room, clear of the kit tile', () => {
    for (const look of ROOM_LOOKS) {
      const room = ROOMS.find((candidate) => candidate.id === look.roomId)!;
      const [floor] = surfacesOf(look.roomId).find((s) => s.id.endsWith(':floor'))!.faces;
      expect(floor).toMatchObject({ kind: 'FLOOR', y: FLOOR_SURFACE_Y });
      expect(floor.area).toMatchObject({
        minX: room.floor.minX,
        maxX: room.floor.maxX,
        minZ: room.floor.minZ,
        maxZ: room.floor.maxZ,
      });
      // The imported floor tile's top is y = 0: the surface must be above it, but only just.
      expect(FLOOR_SURFACE_Y).toBeGreaterThan(0);
      expect(FLOOR_SURFACE_Y).toBeLessThan(0.02);
    }
  });

  it('stands every wall surface in front of the kit panel, facing into its room', () => {
    for (const look of ROOM_LOOKS) {
      const room = ROOMS.find((candidate) => candidate.id === look.roomId)!;
      const walls = surfacesOf(look.roomId).filter(
        (surface) => !/:(floor|ceiling|inlay:.+)$/.test(surface.id),
      );
      expect(walls.length).toBeGreaterThan(0);
      for (const surface of walls) {
        for (const face of surface.faces) {
          if (face.kind !== 'WALL') continue;
          const a = face.area;
          const inset = surface.id.endsWith(':trim') ? TRIM_SURFACE_INSET : WALL_SURFACE_INSET;
          const side = face.sides?.[0];
          // Each face is one visible plane; its kit panel is `inset` metres behind it. A quad
          // facing north (+z) is drawn at `maxZ` and belongs to the room's SOUTH wall, and so on.
          if (side === 'north') expect(a.maxZ).toBeCloseTo(room.floor.minZ + HALF + inset, 9);
          if (side === 'south') expect(a.minZ).toBeCloseTo(room.floor.maxZ - HALF - inset, 9);
          if (side === 'east') expect(a.maxX).toBeCloseTo(room.floor.minX + HALF + inset, 9);
          if (side === 'west') expect(a.minX).toBeCloseTo(room.floor.maxX - HALF - inset, 9);
          expect(face.sides).toHaveLength(1);
          // Inside the room's inner corners, so a run never creeps into the next wall.
          expect(a.minX).toBeGreaterThanOrEqual(room.floor.minX + HALF - FAR);
          expect(a.maxX).toBeLessThanOrEqual(room.floor.maxX - HALF + FAR);
          expect(a.minZ).toBeGreaterThanOrEqual(room.floor.minZ + HALF - FAR);
          expect(a.maxZ).toBeLessThanOrEqual(room.floor.maxZ - HALF + FAR);
        }
      }
    }
  });

  it('draws one wall run per derived wall segment, so the castle keeps its doorways', () => {
    for (const look of ROOM_LOOKS) {
      const segments = WALL_SEGMENTS.filter((wall) => wall.id.split(':')[1] === look.roomId);
      const walls = surfacesOf(look.roomId).find((surface) => surface.id.endsWith(':walls'))!;
      // A segment can be shorter than one corner margin and drop out, never the other way round.
      expect(walls.faces.length).toBeLessThanOrEqual(segments.length);
      expect(walls.faces.length).toBeGreaterThan(0);
    }
  });

  it('never textures over an archway', () => {
    for (const look of ROOM_LOOKS) {
      for (const surface of surfacesOf(look.roomId)) {
        for (const face of surface.faces) {
          if (face.kind !== 'WALL') continue;
          for (const archway of ARCHWAYS) {
            const gap = archway.gap;
            const a = face.area;
            const side = face.sides?.[0];
            const alongZ = side === 'east' || side === 'west'; // a wall on a west or east edge
            const planeCentre = alongZ ? (gap.minX + gap.maxX) / 2 : (gap.minZ + gap.maxZ) / 2;
            const plane =
              side === 'north'
                ? a.maxZ
                : side === 'south'
                  ? a.minZ
                  : side === 'east'
                    ? a.maxX
                    : a.minX;
            if (Math.abs(plane - planeCentre) > 0.5) continue; // another wall entirely
            const from = alongZ ? Math.max(a.minZ, gap.minZ) : Math.max(a.minX, gap.minX);
            const to = alongZ ? Math.min(a.maxZ, gap.maxZ) : Math.min(a.maxX, gap.maxX);
            expect(to - from, `${face.area.id} covers ${archway.id}`).toBeLessThanOrEqual(1e-6);
          }
        }
      }
    }
  });
});

describe('castle effects', () => {
  it('keeps every mote volume inside its own room', () => {
    for (const effect of CASTLE_EFFECTS) {
      const room = ROOMS.find((candidate) => effect.id === `motes:${candidate.id}`)!;
      expect(room, effect.id).toBeDefined();
      expect(effect.area.minX).toBeGreaterThanOrEqual(room.floor.minX);
      expect(effect.area.maxX).toBeLessThanOrEqual(room.floor.maxX);
      expect(effect.area.minZ).toBeGreaterThanOrEqual(room.floor.minZ);
      expect(effect.area.maxZ).toBeLessThanOrEqual(room.floor.maxZ);
      expect(effect.minY).toBeGreaterThanOrEqual(0);
      expect(effect.maxY).toBeLessThanOrEqual(3);
      // The MEDIUM tier caps an emitter at 40; asking for more is wasted.
      expect(effect.count).toBeLessThanOrEqual(80);
    }
  });
});

describe('castle decor', () => {
  it('is only ever solid-colour boxes, so it can carry no interaction', () => {
    for (const item of CASTLE_DECOR) expect(item.kind).toBe('BOX');
  });

  it('never reuses a gameplay entity id, or any other scene id', () => {
    const decorIds = CASTLE_DECOR.map((item) => item.id);
    expect(new Set(decorIds).size).toBe(decorIds.length);
    for (const id of decorIds) expect(ALL_ENTITY_IDS).not.toContain(id);
    const sceneIds = MANIFEST.scenery.map((item) => item.id);
    expect(new Set(sceneIds).size).toBe(sceneIds.length);
  });

  it('puts the Storybook dais on the library floor, clear of every authored spot', () => {
    const library = ROOMS.find((room) => room.id === 'great-library')!.floor;
    const dais = CASTLE_DECOR_COLLIDERS.find((c) => c.rect.id === 'collider:storybook-dais')!;
    expect(dais.rect.minX).toBeGreaterThan(library.minX + HALF);
    expect(dais.rect.maxX).toBeLessThan(library.maxX - HALF);
    expect(dais.rect.minZ).toBeGreaterThan(library.minZ + HALF);
    expect(dais.rect.maxZ).toBeLessThan(library.maxZ - HALF);
    const inside = (x: number, z: number) =>
      x >= dais.rect.minX && x <= dais.rect.maxX && z >= dais.rect.minZ && z <= dais.rect.maxZ;
    for (const spot of [...FLOOR_SPOTS, ...WALL_MOUNTED_SPOTS]) {
      expect(inside(spot.x, spot.z), `${spot.entityId} stands in the dais`).toBe(false);
    }
    for (const zone of ZONES) {
      expect(
        inside((zone.minX + zone.maxX) / 2, (zone.minZ + zone.maxZ) / 2),
        `${zone.id} is centred on the dais`,
      ).toBe(false);
    }
    expect(STORYBOOK_DAIS.x).toBeCloseTo((dais.rect.minX + dais.rect.maxX) / 2);
  });

  it('keeps every solid piece inside one room, clear of every authored spot and zone centre', () => {
    for (const piece of CASTLE_DECOR_COLLIDERS) {
      const { rect } = piece;
      const room = ROOMS.find(
        (candidate) =>
          rect.minX >= candidate.floor.minX + HALF &&
          rect.maxX <= candidate.floor.maxX - HALF &&
          rect.minZ >= candidate.floor.minZ + HALF &&
          rect.maxZ <= candidate.floor.maxZ - HALF,
      );
      expect(room, `${rect.id} is not wholly inside a room's walls`).toBeDefined();
      const inside = (x: number, z: number) =>
        x >= rect.minX && x <= rect.maxX && z >= rect.minZ && z <= rect.maxZ;
      for (const spot of [...FLOOR_SPOTS, ...WALL_MOUNTED_SPOTS]) {
        if ((IS_THE_SPOT[rect.id] ?? []).includes(spot.entityId)) continue;
        expect(inside(spot.x, spot.z), `${spot.entityId} stands in ${rect.id}`).toBe(false);
      }
      for (const zone of ZONES) {
        expect(
          inside((zone.minX + zone.maxX) / 2, (zone.minZ + zone.maxZ) / 2),
          `${zone.id} is centred on ${rect.id}`,
        ).toBe(false);
      }
    }
  });

  it('never overlaps another collider', () => {
    for (const piece of CASTLE_DECOR_COLLIDERS) {
      for (const other of MANIFEST.colliders) {
        if (other.rect.id === piece.rect.id) continue;
        const overlaps =
          piece.rect.minX < other.rect.maxX &&
          other.rect.minX < piece.rect.maxX &&
          piece.rect.minZ < other.rect.maxZ &&
          other.rect.minZ < piece.rect.maxZ;
        expect(overlaps, `${piece.rect.id} overlaps ${other.rect.id}`).toBe(false);
      }
    }
  });

  it('gives every collider decor a collider id that names a decor piece', () => {
    const ids = CASTLE_DECOR_COLLIDERS.map((piece) => piece.rect.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id.startsWith('collider:')).toBe(true);
  });
});

describe('floor inlays', () => {
  it('lie inside their own room, above the floor and below the carpets', () => {
    for (const look of ROOM_LOOKS) {
      const room = ROOMS.find((candidate) => candidate.id === look.roomId)!;
      for (const inlay of look.inlays ?? []) {
        expect(inlay.area.minX).toBeGreaterThanOrEqual(room.floor.minX + HALF);
        expect(inlay.area.maxX).toBeLessThanOrEqual(room.floor.maxX - HALF);
        expect(inlay.area.minZ).toBeGreaterThanOrEqual(room.floor.minZ + HALF);
        expect(inlay.area.maxZ).toBeLessThanOrEqual(room.floor.maxZ - HALF);
      }
    }
    // Floor 0.01, inlay 0.015, carpet 0.02: a strict order, so nothing shares a plane.
    expect(INLAY_SURFACE_Y).toBeGreaterThan(FLOOR_SURFACE_Y);
    expect(INLAY_SURFACE_Y).toBeLessThan(0.02);
  });
});

describe('the Entry Hall', () => {
  const entry = ROOMS.find((room) => room.id === 'entry-hall')!.floor;

  it('keeps the carpet line from the doors to the hub clear of every solid piece', () => {
    const carpetHalfWidth = 0.75;
    for (const piece of CASTLE_DECOR_COLLIDERS) {
      if (piece.rect.minX > 2.5) continue; // the carpet runs from the doors to x = 2
      expect(
        piece.rect.minZ > carpetHalfWidth || piece.rect.maxZ < -carpetHalfWidth,
        `${piece.rect.id} stands on the carpet`,
      ).toBe(true);
    }
  });

  it('hangs the mural on the north wall, inside the room and clear of both banners', () => {
    expect(ENTRY_MURAL.x - ENTRY_MURAL.halfWidth).toBeGreaterThan(entry.minX + HALF);
    expect(ENTRY_MURAL.x + ENTRY_MURAL.halfWidth).toBeLessThan(entry.maxX - HALF);
    // In front of the wall surface (at maxZ - 0.25 - 0.02) and the trim, never inside the room's walkway.
    expect(ENTRY_MURAL.z).toBeLessThan(entry.maxZ - HALF - WALL_SURFACE_INSET);
    expect(ENTRY_MURAL.z).toBeGreaterThan(entry.maxZ - 1);
    const banners = CASTLE_DECOR.filter((item) => item.id.startsWith('castle-entry-banner-n'));
    expect(banners.length).toBeGreaterThan(0);
    for (const banner of banners) {
      if (banner.kind !== 'BOX') continue;
      const clear =
        banner.area.maxX < ENTRY_MURAL.x - ENTRY_MURAL.halfWidth - 0.2 ||
        banner.area.minX > ENTRY_MURAL.x + ENTRY_MURAL.halfWidth + 0.2;
      expect(clear, `${banner.id} overlaps the mural`).toBe(true);
    }
  });

  it('keeps every banner and the mural off the arrival doorway wall and the archway', () => {
    for (const item of CASTLE_DECOR) {
      if (item.kind !== 'BOX' || !/^castle-entry-(banner|mural)/.test(item.id)) continue;
      expect(item.area.minX, item.id).toBeGreaterThan(entry.minX + HALF);
      expect(item.area.maxX, item.id).toBeLessThan(entry.maxX - HALF);
    }
  });
});

describe('the Story Hall', () => {
  const hall = ROOMS.find((room) => room.id === 'story-hall')!.floor;

  it('leaves the mantel carving visible: nothing covers it above the jambs', () => {
    const mantel = WALL_MOUNTED_SPOTS.find((spot) => spot.entityId === 'hall-hearth-mantel')!;
    for (const item of CASTLE_DECOR) {
      if (item.kind !== 'BOX') continue;
      const covers =
        mantel.x >= item.area.minX &&
        mantel.x <= item.area.maxX &&
        mantel.z >= item.area.minZ &&
        mantel.z <= item.area.maxZ;
      if (covers) expect(item.maxY, `${item.id} hides the mantel`).toBeLessThan(mantel.y - 0.1);
    }
  });

  it('hangs its banners clear of the gallery and costume archways', () => {
    const arches = ARCHWAYS.filter((arch) => arch.between.includes('story-hall'));
    for (const item of CASTLE_DECOR) {
      if (item.kind !== 'BOX' || !item.id.startsWith('castle-hall-banner')) continue;
      expect(item.area.minX, item.id).toBeGreaterThan(hall.minX + HALF);
      expect(item.area.maxX, item.id).toBeLessThan(hall.maxX - HALF);
      for (const arch of arches) {
        const sameWall =
          Math.abs(item.area.minZ - arch.gap.minZ) < 1 ||
          Math.abs(item.area.maxZ - arch.gap.maxZ) < 1;
        const overlapsX = item.area.minX < arch.gap.maxX && arch.gap.minX < item.area.maxX;
        expect(sameWall && overlapsX, `${item.id} hangs in ${arch.id}`).toBe(false);
      }
    }
  });
});

describe('the Character Gallery', () => {
  it('puts a plaque under each portrait, on its x, and nowhere else', () => {
    const plaques = CASTLE_DECOR.filter((item) => item.id.startsWith('castle-gallery-plaque-'));
    expect(plaques).toHaveLength(GALLERY_PORTRAIT_SPOTS.length);
    for (const portrait of GALLERY_PORTRAIT_SPOTS) {
      const name = portrait.entityId.replace('gallery-portrait-', '');
      const plaque = plaques.find((item) => item.id === `castle-gallery-plaque-${name}`);
      expect(plaque?.kind, `no plaque for ${name}`).toBe('BOX');
      if (plaque?.kind !== 'BOX') continue;
      expect((plaque.area.minX + plaque.area.maxX) / 2).toBeCloseTo(portrait.x, 6);
      // Below the portrait's own height, flat against the wall.
      expect(plaque.maxY).toBeLessThan(portrait.y - 0.5);
    }
  });

  it('adds nothing solid, so the portrait and arrival zones stay open floor', () => {
    const gallery = ROOMS.find((room) => room.id === 'character-gallery')!.floor;
    const solidInGallery = CASTLE_DECOR_COLLIDERS.filter(
      (piece) =>
        piece.rect.minZ >= gallery.minZ &&
        piece.rect.maxZ <= gallery.maxZ &&
        piece.rect.minX >= gallery.minX &&
        piece.rect.maxX <= gallery.maxX,
    );
    expect(solidInGallery).toEqual([]);
  });
});

describe('the Costume Room', () => {
  it('stands exactly one solid rack on each rack spot the region authored and never placed', () => {
    for (const spot of COSTUME_RACK_SPOTS) {
      const letter = spot.entityId.replace('costume-rack-', '');
      const piece = CASTLE_DECOR_COLLIDERS.find(
        (c) => c.rect.id === `collider:costume-rack-${letter}`,
      );
      expect(piece, `no rack on ${spot.entityId}`).toBeDefined();
      if (!piece) continue;
      expect((piece.rect.minX + piece.rect.maxX) / 2).toBeCloseTo(spot.x, 6);
      expect((piece.rect.minZ + piece.rect.maxZ) / 2).toBeCloseTo(spot.z, 6);
    }
    expect(
      CASTLE_DECOR_COLLIDERS.filter((c) => c.rect.id.startsWith('collider:costume-rack-')),
    ).toHaveLength(COSTUME_RACK_SPOTS.length);
  });

  it('keeps a walkway between the racks and in front of them', () => {
    const racks = CASTLE_DECOR_COLLIDERS.filter((c) =>
      c.rect.id.startsWith('collider:costume-rack-'),
    );
    const sorted = [...racks].sort((a, b) => a.rect.minX - b.rect.minX);
    for (let i = 1; i < sorted.length; i += 1) {
      // A child (roughly 0.5 m across) can pass between neighbours.
      expect(sorted[i].rect.minX - sorted[i - 1].rect.maxX).toBeGreaterThanOrEqual(0.5);
    }
  });

  it('hangs the mirror on the west wall, flat and clear of the racks', () => {
    const mirror = CASTLE_DECOR.find((item) => item.id === 'castle-mirror-frame');
    expect(mirror?.kind).toBe('BOX');
    if (mirror?.kind !== 'BOX') return;
    const costume = ROOMS.find((room) => room.id === 'costume-room')!.floor;
    expect(mirror.area.minX).toBeGreaterThan(costume.minX + HALF);
    expect(mirror.area.maxX - mirror.area.minX).toBeLessThan(0.2);
  });
});

describe('the East Corridor', () => {
  const corridorArches = ARCHWAYS.filter((arch) => arch.between.includes('east-corridor'));

  it('hangs sconces on both walls, none inside an archway', () => {
    const sconces = CASTLE_DECOR.filter((item) =>
      /^castle-corridor-sconce-.*-bracket$/.test(item.id),
    );
    expect(sconces.filter((item) => item.id.includes('-w'))).toHaveLength(4);
    expect(sconces.filter((item) => item.id.includes('-e'))).toHaveLength(4);
    for (const item of sconces) {
      if (item.kind !== 'BOX') continue;
      for (const arch of corridorArches) {
        const onThatWall =
          Math.abs(item.area.minX - arch.gap.maxX) < 1 ||
          Math.abs(item.area.maxX - arch.gap.minX) < 1;
        const overlapsZ = item.area.minZ < arch.gap.maxZ && arch.gap.minZ < item.area.maxZ;
        expect(onThatWall && overlapsZ, `${item.id} hangs in ${arch.id}`).toBe(false);
      }
    }
  });

  it('keeps the island map flat on the west wall, clear of the hub archway and every sconce', () => {
    const hubArch = corridorArches.find((arch) => arch.between.includes('story-hall'))!;
    expect(CORRIDOR_MAP.maxZ).toBeLessThan(hubArch.gap.minZ - 0.5);
    const frame = CASTLE_DECOR.find((item) => item.id === 'castle-corridor-map-frame');
    expect(frame?.kind).toBe('BOX');
    if (frame?.kind !== 'BOX') return;
    expect(frame.area.maxX - frame.area.minX).toBeLessThan(0.2);
    for (const item of CASTLE_DECOR) {
      if (item.kind !== 'BOX' || !item.id.includes('corridor-sconce-w')) continue;
      const overlaps = item.area.minZ < CORRIDOR_MAP.maxZ && CORRIDOR_MAP.minZ < item.area.maxZ;
      expect(overlaps, `${item.id} hangs over the map`).toBe(false);
    }
  });

  it('adds nothing solid, so the corridor stays the spine to the deep rooms', () => {
    const corridor = ROOMS.find((room) => room.id === 'east-corridor')!.floor;
    const solidInCorridor = CASTLE_DECOR_COLLIDERS.filter(
      (piece) => piece.rect.minX >= corridor.minX && piece.rect.maxX <= corridor.maxX,
    );
    expect(solidInCorridor).toEqual([]);
  });
});

describe('the Setting Tower', () => {
  const windowZones = ZONES.filter(
    (zone) => zone.id.startsWith('tower-window-') || zone.id === 'castle-setting-tower',
  );

  it('stands the orrery clear of the arrival zone and all three window zones', () => {
    expect(windowZones).toHaveLength(4);
    const orrery = {
      minX: TOWER_ORRERY.x - TOWER_ORRERY.half,
      maxX: TOWER_ORRERY.x + TOWER_ORRERY.half,
      minZ: TOWER_ORRERY.z - TOWER_ORRERY.half,
      maxZ: TOWER_ORRERY.z + TOWER_ORRERY.half,
    };
    for (const zone of windowZones) {
      const overlaps =
        orrery.minX < zone.maxX &&
        zone.minX < orrery.maxX &&
        orrery.minZ < zone.maxZ &&
        zone.minZ < orrery.maxZ;
      expect(overlaps, `the orrery overlaps ${zone.id}`).toBe(false);
    }
  });

  it('lays a compass medallion over the room centre, never under the orrery', () => {
    const tower = ROOM_LOOKS.find((look) => look.roomId === 'setting-tower')!;
    const compass = tower.inlays?.find((inlay) => inlay.id === 'compass');
    expect(compass).toBeDefined();
    if (!compass) return;
    expect((compass.area.minX + compass.area.maxX) / 2).toBeCloseTo(7.5, 6);
    expect((compass.area.minZ + compass.area.maxZ) / 2).toBeCloseTo(7.5, 6);
    expect(compass.area.maxX).toBeLessThan(TOWER_ORRERY.x - TOWER_ORRERY.half);
  });

  it('puts nothing in front of a window', () => {
    for (const spot of WALL_MOUNTED_SPOTS.filter((s) => s.entityId.startsWith('tower-window-'))) {
      for (const item of CASTLE_DECOR) {
        if (item.kind !== 'BOX') continue;
        const near = Math.hypot(
          (item.area.minX + item.area.maxX) / 2 - spot.x,
          (item.area.minZ + item.area.maxZ) / 2 - spot.z,
        );
        expect(near, `${item.id} stands at ${spot.entityId}`).toBeGreaterThan(1);
      }
    }
  });
});

describe('the Illustration Studio', () => {
  it('keeps the paint table clear of the easel, its spot and its zone', () => {
    const easelZone = ZONES.find((zone) => zone.id === 'castle-illustration-studio')!;
    const table = {
      minX: PAINT_TABLE.x - PAINT_TABLE.halfX,
      maxX: PAINT_TABLE.x + PAINT_TABLE.halfX,
      minZ: PAINT_TABLE.z - PAINT_TABLE.halfZ,
      maxZ: PAINT_TABLE.z + PAINT_TABLE.halfZ,
    };
    const overlapsZone =
      table.minX < easelZone.maxX &&
      easelZone.minX < table.maxX &&
      table.minZ < easelZone.maxZ &&
      easelZone.minZ < table.maxZ;
    expect(overlapsZone, 'the table stands in the easel zone').toBe(false);
    const easel = FLOOR_SPOTS.find((spot) => spot.entityId === 'studio-easel')!;
    // The child stands in front of the easel; leave at least a metre of floor between it and the table.
    expect(table.minX - easel.x).toBeGreaterThan(1);
  });

  it('sets four paint pots on the table top and hangs three drawings flat on the east wall', () => {
    const pots = CASTLE_DECOR.filter((item) => item.id.startsWith('castle-paint-pot-'));
    expect(pots).toHaveLength(4);
    for (const pot of pots) {
      if (pot.kind !== 'BOX') continue;
      expect(pot.minY).toBeCloseTo(PAINT_TABLE.height, 6);
    }
    const frames = CASTLE_DECOR.filter((item) => /^castle-drawing-\d-frame$/.test(item.id));
    expect(frames).toHaveLength(3);
    for (const frame of frames) {
      if (frame.kind !== 'BOX') continue;
      expect(frame.area.maxX - frame.area.minX).toBeLessThan(0.2);
      // Above the table, so the pots and drawings never share space.
      expect(frame.minY).toBeGreaterThan(PAINT_TABLE.height + 0.3);
    }
  });
});

describe('the castle is still walkable with its decor', () => {
  const reached = reachableCells(MANIFEST, STORYKEEPER_CASTLE_REGION_CHECKPOINTS[0]);

  it('spawns the child somewhere they can walk from', () => {
    expect(reached.size).toBeGreaterThan(100);
  });

  it('still reaches every room', () => {
    for (const room of ROOMS) {
      expect(zoneIsEnterable(reached, room.floor), `${room.id} is cut off`).toBe(true);
    }
  });

  it('still lets the child enter every trigger zone', () => {
    for (const zone of ZONES) {
      expect(zoneIsEnterable(reached, zone), `zone ${zone.id} cannot be entered`).toBe(true);
    }
  });

  it('still lets the child stand in front of everything they aim at', () => {
    for (const spot of FLOOR_SPOTS) {
      expect(
        hasReachableCellNear(reached, spot.x, spot.z, 1.5),
        `nobody can get near ${spot.entityId}`,
      ).toBe(true);
    }
    for (const spot of WALL_MOUNTED_SPOTS) {
      expect(
        hasReachableCellNear(reached, spot.x, spot.z, 1.5),
        `nobody can get near ${spot.entityId}`,
      ).toBe(true);
    }
  });
});

describe('castle lighting moods (SC-R02-06)', () => {
  const lights = MANIFEST.lights ?? [];

  it('gives every dressed room a warm or cool lamp of its own, never plain white', () => {
    for (const look of ROOM_LOOKS) {
      expect(look.mood, `${look.roomId} has no mood`).toBeDefined();
      expect(look.mood!.color).not.toBe(0xffffff);
      expect(Number.isInteger(look.mood!.priority)).toBe(true);
      const lamp = lights.find((light) => light.id === `light:${look.roomId}`);
      expect(lamp?.color).toBe(look.mood!.color);
      expect(lamp?.priority).toBe(look.mood!.priority);
    }
    expect(castleRoomMood('no-such-room')).toEqual({ color: 0xffffff, priority: 0 });
  });

  it('keeps the castle at or under the MEDIUM light budget, so a tablet loses none', () => {
    expect(lights.length).toBeLessThanOrEqual(RENDER_QUALITY_PRESETS.MEDIUM.maxPlacedLights);
    expect(selectLightsForQuality(lights, 'MEDIUM')).toHaveLength(lights.length);
    expect(new Set(lights.map((light) => light.id)).size).toBe(lights.length);
  });

  it('keeps the hub fire, the hub, the library, the doorway and the Storybook at LOW', () => {
    const kept = selectLightsForQuality(lights, 'LOW').map((light) => light.id);
    expect(kept).toHaveLength(RENDER_QUALITY_PRESETS.LOW.maxPlacedLights);
    for (const id of [
      'light:hearth',
      'light:story-hall',
      'light:great-library',
      'light:doorway',
      'light:storybook-dais',
      'light:east-corridor',
    ]) {
      expect(kept, `${id} was dropped at LOW`).toContain(id);
    }
  });

  it('puts the Storybook glow over the dais, violet-gold, so it reads as magic', () => {
    expect(CASTLE_EXTRA_LIGHTS).toHaveLength(1);
    const glow = CASTLE_EXTRA_LIGHTS[0];
    expect(glow.position.x).toBeCloseTo(STORYBOOK_DAIS.x, 6);
    expect(glow.position.z).toBeCloseTo(STORYBOOK_DAIS.z, 6);
    expect(glow.color).not.toBe(castleRoomMood('great-library').color);
    // The library is still the dimmest room: the glow is a focal accent, not a second lamp.
    const library = lights.find((light) => light.id === 'light:great-library')!;
    const hall = lights.find((light) => light.id === 'light:story-hall')!;
    expect(library.intensity).toBeLessThan(hall.intensity);
    expect(glow.intensity).toBeLessThan(hall.intensity);
  });
});

describe('castle budgets (art direction section 7)', () => {
  const anchorOf = (item: ScenerySpec): { x: number; z: number } => {
    switch (item.kind) {
      case 'MODEL':
        return item.position;
      case 'BOX':
        return {
          x: (item.area.minX + item.area.maxX) / 2,
          z: (item.area.minZ + item.area.maxZ) / 2,
        };
      case 'CLUSTER':
      case 'LOD_PLACEMENTS':
        return item.positions[0] ?? { x: Number.NaN, z: Number.NaN };
      default:
        return { x: Number.NaN, z: Number.NaN };
    }
  };

  it('keeps the whole castle at or under 160 scenery items', () => {
    expect(MANIFEST.scenery.length).toBeLessThanOrEqual(160);
  });

  it('keeps the Great Library at or under 48 scenery items', () => {
    const library = ROOMS.find((room) => room.id === 'great-library')!.floor;
    const inLibrary = MANIFEST.scenery.filter((item) => {
      const { x, z } = anchorOf(item);
      return x >= library.minX && x <= library.maxX && z >= library.minZ && z <= library.maxZ;
    });
    expect(inLibrary.length).toBeGreaterThan(10);
    expect(inLibrary.length).toBeLessThanOrEqual(48);
  });
});

describe('the manifest carrying the look', () => {
  it('still validates against the real content registries', () => {
    expect(validateLocationManifest(MANIFEST, SOURCE_MANIFEST_REGISTRIES)).toEqual([]);
  });

  it('declares exactly the look it is built from', () => {
    expect(MANIFEST.materials).toBe(CASTLE_MATERIALS);
    expect(MANIFEST.surfaces).toBe(CASTLE_SURFACES);
    expect(MANIFEST.effects).toBe(CASTLE_EFFECTS);
  });
});
