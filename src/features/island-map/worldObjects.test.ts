import { describe, expect, it } from 'vitest';
import {
  findInteraction,
  isInteractionAvailable,
  WELCOME_HARBOR_INTERACTIONS,
  type WorldInteraction,
} from './worldObjects';

describe('isInteractionAvailable', () => {
  it('is available with no requirements', () => {
    const interaction: WorldInteraction = {
      id: 'shell',
      type: 'OBJECT',
      trigger: 'TAP',
      title: 'A shell',
      targetId: 'shell',
      action: { kind: 'SHOW_MESSAGE', message: 'A shiny shell!' },
    };

    expect(isInteractionAvailable(interaction, { worldChangeKeys: [] })).toBe(true);
  });

  it('is available when an ALWAYS requirement is present', () => {
    const interaction: WorldInteraction = {
      id: 'bridge',
      type: 'OBJECT',
      trigger: 'APPROACH',
      title: 'A bridge',
      targetId: 'bridge',
      requirements: [{ type: 'ALWAYS' }],
      action: { kind: 'NAVIGATE', to: 'locations/pirate-builder-bay' },
    };

    expect(isInteractionAvailable(interaction, { worldChangeKeys: [] })).toBe(true);
  });

  it('requires a world change to be present', () => {
    const interaction: WorldInteraction = {
      id: 'dragon-cave',
      type: 'LOCATION',
      trigger: 'ENTER',
      title: 'Dragon cave',
      targetId: 'dragon-cave',
      requirements: [{ type: 'WORLD_CHANGE_PRESENT', changeKey: 'MOUNTAIN_PATH_REPAIRED' }],
      action: { kind: 'NAVIGATE', to: 'locations/ember-mountain' },
    };

    expect(isInteractionAvailable(interaction, { worldChangeKeys: [] })).toBe(false);
    expect(
      isInteractionAvailable(interaction, { worldChangeKeys: ['MOUNTAIN_PATH_REPAIRED'] }),
    ).toBe(true);
  });

  it('requires a world change to be absent', () => {
    const interaction: WorldInteraction = {
      id: 'broken-bridge',
      type: 'OBJECT',
      trigger: 'APPROACH',
      title: 'Broken bridge',
      targetId: 'broken-bridge',
      requirements: [{ type: 'WORLD_CHANGE_ABSENT', changeKey: 'BRIDGE_REPAIRED' }],
      action: { kind: 'SHOW_MESSAGE', message: 'The bridge is broken.' },
    };

    expect(isInteractionAvailable(interaction, { worldChangeKeys: [] })).toBe(true);
    expect(isInteractionAvailable(interaction, { worldChangeKeys: ['BRIDGE_REPAIRED'] })).toBe(
      false,
    );
  });

  it('requires every listed requirement to hold, not just one', () => {
    const interaction: WorldInteraction = {
      id: 'combo',
      type: 'DISCOVERY',
      trigger: 'USE',
      title: 'Combo',
      targetId: 'combo',
      requirements: [
        { type: 'WORLD_CHANGE_PRESENT', changeKey: 'A' },
        { type: 'WORLD_CHANGE_ABSENT', changeKey: 'B' },
      ],
      action: { kind: 'SHOW_MESSAGE', message: 'Combo!' },
    };

    expect(isInteractionAvailable(interaction, { worldChangeKeys: ['A'] })).toBe(true);
    expect(isInteractionAvailable(interaction, { worldChangeKeys: ['A', 'B'] })).toBe(false);
    expect(isInteractionAvailable(interaction, { worldChangeKeys: [] })).toBe(false);
  });
});

describe('findInteraction', () => {
  it('finds an interaction by id', () => {
    const found = findInteraction(WELCOME_HARBOR_INTERACTIONS, 'broken-bridge');
    expect(found?.title).toContain('bridge');
  });

  it('returns undefined for an unknown id', () => {
    expect(findInteraction(WELCOME_HARBOR_INTERACTIONS, 'nope')).toBeUndefined();
  });
});

describe('WELCOME_HARBOR_INTERACTIONS', () => {
  it('always makes the broken bridge available (no prerequisites yet)', () => {
    const bridge = findInteraction(WELCOME_HARBOR_INTERACTIONS, 'broken-bridge');
    expect(bridge).toBeDefined();
    expect(isInteractionAvailable(bridge!, { worldChangeKeys: [] })).toBe(true);
  });

  it('wires the broken bridge to start the real Repair the Moonlight Bridge adventure', () => {
    const bridge = findInteraction(WELCOME_HARBOR_INTERACTIONS, 'broken-bridge');
    expect(bridge?.action).toEqual({
      kind: 'START_ADVENTURE',
      locationSlug: 'pirate-builder-bay',
      templateSlug: 'repair-the-moonlight-bridge',
    });
  });

  it('always makes talking to Chatty available and tap-triggered', () => {
    const chatty = findInteraction(WELCOME_HARBOR_INTERACTIONS, 'talk-to-chatty');
    expect(chatty).toBeDefined();
    expect(chatty?.type).toBe('NPC');
    expect(chatty?.trigger).toBe('TAP');
    expect(isInteractionAvailable(chatty!, { worldChangeKeys: [] })).toBe(true);
  });
});
