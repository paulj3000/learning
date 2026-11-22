import { describe, expect, it } from 'vitest';
import {
  ALL_CHECKPOINTS,
  CASTLE_WRITING_ROOM_CHECKPOINTS,
} from '../../../../discovery/checkpoints';
import { getIslandLocation } from '../../../../island/locations';
import { CASTLE_EXITS } from '../../castleLayout';
import {
  WRITING_DESK_SPOT,
  WRITING_ROOM_CORNERS,
  WRITING_ROOM_EXIT_ZONE,
  WRITING_ROOM_HALF_EXTENT,
  WRITING_ROOM_SHELF_COLLIDERS,
  WRITING_ROOM_SHELVES,
  WRITING_ROOM_SPAWN,
  WRITING_ROOM_STEP_SIZE,
  WRITING_ROOM_OPEN_BOOK_SPOT,
  WRITING_ROOM_QUILL_SPOT,
  WRITING_ROOM_STEP_SPOTS,
  WRITING_ROOM_UNLOCK_CHANGE_KEY,
} from '../../castleWritingRoomRegion';
import {
  CASTLE_WRITING_ROOM_3D_INTERACTIONS,
  CASTLE_WRITING_ROOM_INTERACTIONS,
} from '../../../worldObjects';
import { findNpc } from '../../../../npc/content';
import { SOURCE_MANIFEST_REGISTRIES } from '../sourceManifestRegistries';
import { validateLocationManifest } from '../validateLocationManifest';
import type { RectZone, ThreeLocationManifest } from '../locationManifest';
import { SOURCE_LOCATION_MANIFESTS } from './index';
import { CASTLE_MAX_PLATFORM_TOP, CASTLE_MIN_FOOTPRINT } from './castleRooms/castlePlatforms';
import { CASTLE_WRITING_ROOM_MANIFEST as MANIFEST } from './castleWritingRoom';

const inside = (zone: RectZone, x: number, z: number) =>
  x >= zone.minX && x <= zone.maxX && z >= zone.minZ && z <= zone.maxZ;

describe('Writing Room manifest (SC-R10-01)', () => {
  it('is valid against the real content registries', () => {
    expect(validateLocationManifest(MANIFEST, SOURCE_MANIFEST_REGISTRIES)).toEqual([]);
  });

  it('validates the entry gate too: an unknown item is reported, not ignored', () => {
    const broken: ThreeLocationManifest = {
      ...MANIFEST,
      entryRequirements: [{ type: 'ITEM_OWNED', itemId: 'not-a-real-item' }],
    };
    const issues = validateLocationManifest(broken, SOURCE_MANIFEST_REGISTRIES);
    expect(issues.some((issue) => issue.path.startsWith('entryRequirements'))).toBe(true);
  });

  it('survives a JSON round trip unchanged', () => {
    const reloaded = JSON.parse(JSON.stringify(MANIFEST)) as ThreeLocationManifest;
    expect(reloaded).toEqual(MANIFEST);
    expect(validateLocationManifest(reloaded, SOURCE_MANIFEST_REGISTRIES)).toEqual([]);
  });

  it('is registered once, under the same id and slug as the Phaser location', () => {
    expect(
      SOURCE_LOCATION_MANIFESTS.filter((m) => m.regionId === 'castle-writing-room'),
    ).toHaveLength(1);
    expect(MANIFEST.regionId).toBe('castle-writing-room');
    expect(MANIFEST.locationSlug).toBe('castle-writing-room');
    expect(getIslandLocation('castle-writing-room')?.slug).toBe(MANIFEST.locationSlug);
  });

  it("reuses the shared interactions by identity and adds only the 3D room's own two", () => {
    // The Phaser room reads the first array, so it gains nothing (ADR-020) and its ids stay in parity.
    expect(MANIFEST.interactions.slice(0, CASTLE_WRITING_ROOM_INTERACTIONS.length)).toEqual(
      CASTLE_WRITING_ROOM_INTERACTIONS,
    );
    MANIFEST.interactions.slice(0, 3).forEach((interaction, index) => {
      expect(interaction).toBe(CASTLE_WRITING_ROOM_INTERACTIONS[index]);
    });
    expect(MANIFEST.interactions.map((i) => i.id)).toEqual([
      'writing-room-desk',
      'writing-room-bookshelf',
      'writing-room-castle-exit',
      'writing-room-write-story',
      'writing-room-talk-to-quill',
    ]);
    expect(CASTLE_WRITING_ROOM_INTERACTIONS.map((i) => i.id)).toEqual([
      'writing-room-desk',
      'writing-room-bookshelf',
      'writing-room-castle-exit',
    ]);
    expect(CASTLE_WRITING_ROOM_3D_INTERACTIONS.map((i) => i.id)).toEqual([
      'writing-room-write-story',
      'writing-room-talk-to-quill',
    ]);
  });

  it('resolves every tap interaction to a prop and the exit to a zone', () => {
    for (const interaction of MANIFEST.interactions) {
      if (interaction.trigger === 'APPROACH') {
        expect(MANIFEST.zones.map((zone) => zone.rect.id)).toContain(interaction.id);
      } else {
        const owners = [...MANIFEST.props, ...MANIFEST.npcs].filter(
          (entity) => entity.interactionId === interaction.id,
        );
        expect(owners, interaction.id).toHaveLength(1);
      }
    }
  });

  it('keeps the exit action the Phaser view uses', () => {
    const exit = MANIFEST.interactions.find((i) => i.id === 'writing-room-castle-exit');
    expect(exit?.action).toEqual({ kind: 'NAVIGATE', to: 'world/storykeeper-castle' });
  });

  it('places Keeper Quill (as the castle does, unconditionally) and the open book, and nothing that records', () => {
    expect(MANIFEST.collectibles).toEqual([]);
    expect(MANIFEST.adventureBindings).toEqual([]);
    expect(MANIFEST.extensions).toEqual([]);
    expect(MANIFEST.npcs).toHaveLength(1);
    const quill = MANIFEST.npcs[0]!;
    expect(quill.npcId).toBe('keeper-quill');
    expect(findNpc(quill.npcId)).toBeDefined();
    expect({ x: quill.position.x, z: quill.position.z }).toEqual({
      x: WRITING_ROOM_QUILL_SPOT.x,
      z: WRITING_ROOM_QUILL_SPOT.z,
    });
    const talk = MANIFEST.interactions.find((i) => i.id === quill.interactionId)!;
    // The same conversation the castle's Quill opens: his lines, memory and narration.
    expect(talk.action).toEqual({ kind: 'TALK_TO', npcId: 'keeper-quill' });
    const book = MANIFEST.props.find((prop) => prop.entityId === 'writing-room-open-book')!;
    expect(book.interactionId).toBe('writing-room-write-story');
    expect(book.position).toEqual({
      x: WRITING_ROOM_OPEN_BOOK_SPOT.x,
      z: WRITING_ROOM_OPEN_BOOK_SPOT.z,
    });
    // The only world-facing actions are navigation, a message and talking: no adventure, no story.
    expect(new Set(MANIFEST.interactions.map((i) => i.action.kind))).toEqual(
      new Set(['NAVIGATE', 'SHOW_MESSAGE', 'TALK_TO']),
    );
  });

  it('is open to every child with no arithmetic gate, and earned progress keeps its own door (SC-final-B)', () => {
    expect(MANIFEST.entryRequirements).toBeUndefined();
    expect(MANIFEST.copy.locked).toBeUndefined();
    expect(getIslandLocation('castle-writing-room')?.unlockRequirement).toBeUndefined();
    // The Secret Door key is still named once, and the library bookshelf still opens for its holders.
    expect(WRITING_ROOM_UNLOCK_CHANGE_KEY).toBe('THE_CASTLES_SECRET_DOOR_COMPLETE');
    const bookshelf = CASTLE_EXITS.find((exit) => exit.id === 'writing-room');
    expect(bookshelf?.requirements).toEqual([
      { type: 'WORLD_CHANGE_PRESENT', changeKey: WRITING_ROOM_UNLOCK_CHANGE_KEY },
    ]);
    expect(bookshelf?.to).toBe('locations/castle-writing-room');
  });

  it('appends exactly one checkpoint, after every existing one, with a clear spawn', () => {
    expect(CASTLE_WRITING_ROOM_CHECKPOINTS).toHaveLength(1);
    expect(MANIFEST.checkpoints.ids).toEqual(['castle-writing-room:entry']);
    expect(ALL_CHECKPOINTS[ALL_CHECKPOINTS.length - 1]?.id).toBe('castle-writing-room:entry');
    const spawn = CASTLE_WRITING_ROOM_CHECKPOINTS[0]!;
    expect({ x: spawn.x, z: spawn.z }).toEqual(WRITING_ROOM_SPAWN);
    expect(inside(WRITING_ROOM_EXIT_ZONE, spawn.x, spawn.z)).toBe(false);
  });

  it('keeps every entity inside the room and clear of the spawn and the exit', () => {
    const limit = WRITING_ROOM_HALF_EXTENT;
    const spots = [
      ...MANIFEST.props.map((prop) => prop.position),
      ...WRITING_ROOM_SHELVES,
      ...WRITING_ROOM_STEP_SPOTS,
      WRITING_ROOM_SPAWN,
    ];
    for (const spot of spots) {
      expect(Math.abs(spot.x)).toBeLessThanOrEqual(limit);
      expect(Math.abs(spot.z)).toBeLessThanOrEqual(limit);
    }
    const solids = [...MANIFEST.colliders.map((collider) => collider.rect)];
    for (const solid of solids) {
      expect(inside(solid, WRITING_ROOM_SPAWN.x, WRITING_ROOM_SPAWN.z)).toBe(false);
      const overlapsExit =
        solid.minX < WRITING_ROOM_EXIT_ZONE.maxX &&
        solid.maxX > WRITING_ROOM_EXIT_ZONE.minX &&
        solid.minZ < WRITING_ROOM_EXIT_ZONE.maxZ &&
        solid.maxZ > WRITING_ROOM_EXIT_ZONE.minZ;
      expect(overlapsExit).toBe(false);
    }
    // Shelves, corners, the desk and Keeper Quill.
    expect(WRITING_ROOM_SHELF_COLLIDERS.length + WRITING_ROOM_CORNERS.length + 2).toBe(
      MANIFEST.colliders.length,
    );
    expect(WRITING_DESK_SPOT.x - WRITING_DESK_SPOT.halfX).toBeGreaterThan(WRITING_ROOM_SPAWN.x);
  });

  it('adds optional low steps only: 0.5 m or less, static, never gated, none for Sprouts', () => {
    const platforms = MANIFEST.platforming?.platforms ?? [];
    expect(platforms).toHaveLength(2);
    for (const platform of platforms) {
      expect(platform.size.height).toBeLessThanOrEqual(CASTLE_MAX_PLATFORM_TOP);
      expect(platform.size.width).toBeGreaterThanOrEqual(CASTLE_MIN_FOOTPRINT);
      expect(platform.size.depth).toBeGreaterThanOrEqual(CASTLE_MIN_FOOTPRINT);
      expect(platform.size.width).toBe(WRITING_ROOM_STEP_SIZE);
      expect(platform.motion).toBeUndefined();
      expect(platform.vanish).toBeUndefined();
      expect(platform.bounce).toBeUndefined();
      expect(platform.activation).toBeUndefined();
      // Clear of the exit, the spawn and the desk, so no step is ever in the way.
      const half = platform.size.width / 2;
      const footprint: RectZone = {
        id: platform.id,
        minX: platform.position.x - half,
        maxX: platform.position.x + half,
        minZ: platform.position.z - half,
        maxZ: platform.position.z + half,
      };
      for (const collider of MANIFEST.colliders) {
        const overlaps =
          footprint.minX < collider.rect.maxX &&
          footprint.maxX > collider.rect.minX &&
          footprint.minZ < collider.rect.maxZ &&
          footprint.maxZ > collider.rect.minZ;
        expect(overlaps).toBe(false);
      }
    }
    // Nothing in the manifest is gated on a step.
    expect(MANIFEST.platforming?.zones ?? []).toEqual([]);
    expect(MANIFEST.platforming?.pressurePlates ?? []).toEqual([]);
    // Sprouts: flat markers at the same spots, no solid step and no collider.
    expect(MANIFEST.platformingByBand?.SPROUT?.platforms).toEqual([]);
    const markers = MANIFEST.platformingByBand?.SPROUT?.pressurePlates ?? [];
    expect(markers.map((marker) => marker.position)).toEqual(
      WRITING_ROOM_STEP_SPOTS.map((spot) => ({ x: spot.x, z: spot.z })),
    );
    expect(MANIFEST.movement?.jump?.enabled).not.toBe(false);
  });
});
