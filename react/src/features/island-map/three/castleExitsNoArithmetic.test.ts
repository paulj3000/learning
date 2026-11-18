import { describe, expect, it } from 'vitest';
import { STORYKEEPER_CASTLE_INTERACTIONS, type WorldInteractionContext } from '../worldObjects';
import { CASTLE_DOORS, CASTLE_EXITS, openExits } from './castleLayout';
import { CASTLE_WRITING_ROOM_MANIFEST } from './runtime/manifests/castleWritingRoom';

/**
 * SC-R11 section 5: the way out is never an arithmetic gate. The harbor exit is open for any
 * child in any state; no door is locked by anything but finding the nook; neither exit is an
 * adventure step, so no exit can carry a `number-input` step. The Writing Room is an optional
 * reward room, gated only by a world change.
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

  it('gates the Writing Room by one world change only, and never hides the harbor while it is shut', () => {
    const writing = CASTLE_EXITS.find((exit) => exit.id === 'writing-room')!;
    expect(writing.requirements.map((requirement) => requirement.type)).toEqual([
      'WORLD_CHANGE_PRESENT',
    ]);
    expect(openExits(EMPTY).map((exit) => exit.id)).toEqual(['harbor']);
  });

  it('lets a child leave the Writing Room at any time, with no steps in it at all', () => {
    const back = CASTLE_WRITING_ROOM_MANIFEST.interactions.find(
      (i) => i.id === 'writing-room-castle-exit',
    )!;
    expect(back.requirements).toEqual([{ type: 'ALWAYS' }]);
    expect(back.action.kind).toBe('NAVIGATE');
    expect(CASTLE_WRITING_ROOM_MANIFEST.adventureBindings).toEqual([]);
  });
});
