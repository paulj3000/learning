import { describe, expect, it } from 'vitest';
import { SOURCE_MANIFEST_REGISTRIES } from '../sourceManifestRegistries';
import { validateLocationManifest } from '../validateLocationManifest';
import { findAdventureBindingIssues } from '../adventureStepBindings';
import { ADVENTURE_TEMPLATES } from '../../../../adventures/content';
import { CASTLE_CHOICE_BINDINGS } from '../../castleChoiceBindings';
import {
  ALL_ENTITY_IDS,
  GALLERY_PORTRAIT_SPOTS,
  ROOMS,
  WALL_SEGMENTS,
  ZONES,
} from '../../storykeeperCastleRegion';
import { STORYKEEPER_CASTLE_MANIFEST as MANIFEST } from './storykeeperCastle';
import type { ThreeLocationManifest } from '../locationManifest';

describe('Storykeeper Castle manifest', () => {
  it('is valid against the real content registries', () => {
    expect(validateLocationManifest(MANIFEST, SOURCE_MANIFEST_REGISTRIES)).toEqual([]);
  });

  it('survives a JSON round trip unchanged (acceptance A3)', () => {
    const reloaded = JSON.parse(JSON.stringify(MANIFEST)) as ThreeLocationManifest;
    expect(reloaded).toEqual(MANIFEST);
    expect(validateLocationManifest(reloaded, SOURCE_MANIFEST_REGISTRIES)).toEqual([]);
  });

  it('carries every derived wall as a collider, and no boundary of its own', () => {
    // Walls are the complement of room floors minus archway gaps, derived by
    // the region module; the manifest moves the numbers, not the rule.
    const wallColliders = MANIFEST.colliders.filter((collider) =>
      collider.rect.id.startsWith('wall:'),
    );
    expect(wallColliders).toHaveLength(WALL_SEGMENTS.length);
    expect(MANIFEST.buildings).toEqual([]);
  });

  it('draws one floor and one ceiling slab per room, scaled to its footprint', () => {
    const floors = MANIFEST.scenery.find((item) => item.id === 'room-floors');
    const ceilings = MANIFEST.scenery.find((item) => item.id === 'room-ceilings');
    expect(floors?.kind).toBe('CLUSTER');
    expect(ceilings?.kind).toBe('CLUSTER');
    if (floors?.kind !== 'CLUSTER' || ceilings?.kind !== 'CLUSTER') return;
    expect(floors.positions).toHaveLength(ROOMS.length);
    expect(ceilings.positions).toHaveLength(ROOMS.length);
    // The library is 10m by 8m, so its slab scales from the 4m piece.
    const library = ROOMS.find((room) => room.id === 'great-library')!;
    const slab = floors.positions.find(
      (position) => position.x === (library.floor.minX + library.floor.maxX) / 2,
    );
    expect(slab?.scale).toEqual({ x: 2.5, z: 2 });
  });

  it('lights every room, plus the doorway and the hearth', () => {
    const ids = (MANIFEST.lights ?? []).map((light) => light.id);
    for (const room of ROOMS) expect(ids).toContain(`light:${room.id}`);
    expect(ids).toContain('light:doorway');
    expect(ids).toContain('light:hearth');
    // The library stays the dimmest room in the castle, which is SC-2's claim.
    const library = MANIFEST.lights?.find((light) => light.id === 'light:great-library');
    const hall = MANIFEST.lights?.find((light) => light.id === 'light:story-hall');
    expect(library!.intensity).toBeLessThan(hall!.intensity);
  });

  it('keeps every authored zone and every authored interaction', () => {
    // Every authored zone, with only the three gallery ones suffixed because
    // they shared a name with the portraits standing in them.
    expect(MANIFEST.zones.map((zone) => zone.rect.id)).toEqual(
      ZONES.map((zone) =>
        GALLERY_PORTRAIT_SPOTS.some((spot) => spot.entityId === zone.id)
          ? `${zone.id}:approach`
          : zone.id,
      ),
    );
    // The requirements the per-region view used to branch on are the
    // interactions' own, so the branch is simply gone.
    const storyHall = MANIFEST.interactions.find((item) => item.id === 'castle-story-hall');
    const told = MANIFEST.interactions.find((item) => item.id === 'castle-story-hall-told');
    expect(storyHall?.requirements).toEqual([
      { type: 'WORLD_CHANGE_ABSENT', changeKey: 'FIRST_STORY_TOLD' },
    ]);
    expect(told?.requirements).toEqual([
      { type: 'WORLD_CHANGE_PRESENT', changeKey: 'FIRST_STORY_TOLD' },
    ]);
    expect(told?.zoneId).toBe('castle-story-hall');
  });

  it('moves the castle’s binding table into the manifest, unchanged (Phase 8)', () => {
    expect(MANIFEST.adventureBindings).toEqual(CASTLE_CHOICE_BINDINGS);
    expect(
      findAdventureBindingIssues(MANIFEST.adventureBindings, {
        adventures: ADVENTURE_TEMPLATES,
        placedEntityIds: [
          ...MANIFEST.props.map((prop) => prop.entityId),
          ...MANIFEST.zones.map((zone) => zone.rect.id),
        ],
      }),
    ).toEqual([]);
  });

  it('makes every puzzle piece and target a prop the extension owns', () => {
    const owned = MANIFEST.props.filter((prop) => prop.interactionId === undefined);
    expect(owned.map((prop) => prop.entityId)).toEqual([
      'gallery-portrait-puppy',
      'gallery-portrait-dragon',
      'gallery-portrait-fox',
      'story-plate-choice',
      'story-plate-ending',
      'story-plate-problem',
      'binding-lectern',
      'library-clue-diary',
      'library-clue-map',
      'library-clue-note',
      'library-clue-wall',
      'lock-rod-silver',
      'lock-rod-iron',
      'lock-rod-brass',
      'lock-rod-rack',
      'secret-door',
    ]);
    // A portrait has two states, so the extension draws it; a plate has one
    // model, which the runtime loads into the root the extension then moves.
    for (const spot of GALLERY_PORTRAIT_SPOTS) {
      const portrait = MANIFEST.props.find((prop) => prop.entityId === spot.entityId);
      expect(portrait?.assetId).toBeUndefined();
      expect(portrait?.elevation).toBe(spot.y);
    }
    expect(MANIFEST.props.find((prop) => prop.entityId === 'story-plate-problem')?.assetId).toBe(
      'story-plate-problem',
    );
  });

  it('places only entity ids the region authors', () => {
    const placed = [
      ...MANIFEST.props.map((prop) => prop.entityId),
      ...MANIFEST.npcs.map((npc) => npc.entityId),
    ];
    for (const entityId of placed) {
      expect(ALL_ENTITY_IDS, entityId).toContain(entityId);
    }
  });

  it('authors the castle’s own copy: the calm stop, the toasts, and no reticle for Sprouts', () => {
    expect(MANIFEST.copy.calmStop).toContain('Keeper Quill closes the book');
    expect(MANIFEST.copy.checkpointToasts).toEqual({
      found: 'You found {checkpoint}.',
      returning: 'You are back at {checkpoint}.',
    });
    expect(MANIFEST.copy.progressUnavailable).toContain('could not load your backpack');
    expect(MANIFEST.noReticleBands).toEqual(['SPROUT']);
  });
});
