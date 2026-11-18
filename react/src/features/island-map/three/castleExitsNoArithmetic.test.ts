import { describe, expect, it } from 'vitest';
import { STORYKEEPER_CASTLE_INTERACTIONS, type WorldInteractionContext } from '../worldObjects';
import { CASTLE_DOORS, CASTLE_EXITS, openExits } from './castleLayout';
import { CASTLE_WRITING_ROOM_MANIFEST } from './runtime/manifests/castleWritingRoom';
import { ADVENTURE_TEMPLATES, getAdventureTemplatesForLocation } from '../../adventures/content';
import { getIslandLocation } from '../../island/locations';
import { CASTLE_WRITING_ROOM_3D_INTERACTIONS } from '../worldObjects';

/**
 * SC-R11 section 5: the way out is never an arithmetic gate. The harbor exit is open for any
 * child in any state; no door is locked by anything but finding the nook; neither exit is an
 * adventure step, so no exit can carry a `number-input` step. The Writing Room is an optional
 * optional room that every child may enter (SC-final-B): it no longer waits on the Secret Door
 * arc, whose chapter 1 has a `number-input` step.
 */
const EMPTY: WorldInteractionContext = { worldChangeKeys: [] };

describe('castle exits and routes carry no arithmetic gate (SC-R11)', () => {
  it('always includes the harbor exit, whatever the world state', () => {
    expect(openExits(EMPTY).map((exit) => exit.id)).toContain('harbor');
    expect(openExits({ worldChangeKeys: [], ownedItemIds: [], discoveryIds: [] })[0]?.id).toBe('harbor');
    expect(openExits({ worldChangeKeys: ['SOMETHING_ELSE'] }).map((exit) => exit.id)).toContain('harbor');
  });

  it('makes the harbor exit a plain, ungated navigation, not an adventure step', () => {
    const harbor = CASTLE_EXITS.find((exit) => exit.id === 'harbor')!;
    expect(harbor.requirements).toEqual([{ type: 'ALWAYS' }]);
    const interaction = STORYKEEPER_CASTLE_INTERACTIONS.find((i) => i.id === harbor.interactionId)!;
    expect(interaction.requirements).toEqual([{ type: 'ALWAYS' }]);
    expect(interaction.action.kind).toBe('NAVIGATE');
  });

  it('locks no door behind anything but a discovery', () => {
    for (const door of CASTLE_DOORS) {
      for (const requirement of door.lock?.requirements ?? []) {
        expect(requirement.type, door.id).toBe('DISCOVERY_PRESENT');
      }
    }
  });

  it('makes every exit a NAVIGATE interaction, so none can carry an adventure step', () => {
    for (const exit of CASTLE_EXITS) {
      const interaction = STORYKEEPER_CASTLE_INTERACTIONS.find((i) => i.id === exit.interactionId)!;
      expect(interaction.action.kind, exit.id).toBe('NAVIGATE');
      expect(JSON.stringify(interaction)).not.toContain('number-input');
    }
  });

  it('keeps the library bookshelf for the arc, and opens the room itself to every child with no arithmetic', () => {
    // The in-castle bookshelf door is an earned door and is unchanged: a holder of the Secret Door
    // key keeps it, and a child without it never meets it, with the harbor exit open either way.
    const bookshelf = CASTLE_EXITS.find((exit) => exit.id === 'writing-room')!;
    expect(bookshelf.requirements.map((requirement) => requirement.type)).toEqual([
      'WORLD_CHANGE_PRESENT',
    ]);
    expect(openExits(EMPTY).map((exit) => exit.id)).toEqual(['harbor']);
    // The room has no gate of its own (SC-final-B): location data and the manifest agree.
    expect(getIslandLocation('castle-writing-room')?.unlockRequirement).toBeUndefined();
    expect(CASTLE_WRITING_ROOM_MANIFEST.entryRequirements).toBeUndefined();
  });

  it('lets a child leave the Writing Room at any time, with no steps in it at all', () => {
    const back = CASTLE_WRITING_ROOM_MANIFEST.interactions.find(
      (i) => i.id === 'writing-room-castle-exit',
    )!;
    expect(back.requirements).toEqual([{ type: 'ALWAYS' }]);
    expect(back.action.kind).toBe('NAVIGATE');
    expect(CASTLE_WRITING_ROOM_MANIFEST.adventureBindings).toEqual([]);
    expect(CASTLE_WRITING_ROOM_MANIFEST.entryRequirements).toBeUndefined();
  });

  it('never makes the write-your-story activity a way in or a way out', () => {
    // The activity is reached by an optional tap on the desk's book and is never required.
    const write = CASTLE_WRITING_ROOM_3D_INTERACTIONS.find((i) => i.id === 'writing-room-write-story')!;
    expect(write.requirements).toEqual([{ type: 'ALWAYS' }]);
    expect(write.action.kind).toBe('NAVIGATE');
    // The manifest holds no adventure step: the exit zone and the way back never depend on it.
    expect(CASTLE_WRITING_ROOM_MANIFEST.interactions.some((i) => i.action.kind === 'START_ADVENTURE')).toBe(false);
    expect(CASTLE_WRITING_ROOM_MANIFEST.interactions.some((i) => i.action.kind === 'START_STORY')).toBe(false);
  });

  it('keeps arithmetic out of every Writing Room story, for every band', () => {
    const stories = getAdventureTemplatesForLocation('castle-writing-room');
    expect(stories.map((story) => story.ageBands[0]).sort()).toEqual(['EXPLORER', 'PATHFINDER', 'SPROUT']);
    for (const story of stories) {
      for (const step of story.steps) {
        expect(['NUMBER_INPUT', 'CHOICE', 'ORDERING', 'MATCHING']).not.toContain(step.type);
        expect(step.presentation.kind, `${story.slug}/${step.id}`).not.toBe('number-input');
      }
    }
    // And no template anywhere is reachable only through arithmetic from the Writing Room.
    expect(ADVENTURE_TEMPLATES.filter((t) => t.locationSlug === 'castle-writing-room')).toHaveLength(3);
  });
});
