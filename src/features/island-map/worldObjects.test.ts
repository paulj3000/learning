import { describe, expect, it } from 'vitest';
import {
  findInteraction,
  isInteractionAvailable,
  PIRATE_BUILDER_BAY_INTERACTIONS,
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
  it('has no duplicate interaction ids, even though two interactions share the bridge zone', () => {
    const ids = WELCOME_HARBOR_INTERACTIONS.map((interaction) => interaction.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('offers the broken bridge only before it is repaired', () => {
    const bridge = findInteraction(WELCOME_HARBOR_INTERACTIONS, 'broken-bridge');
    expect(bridge).toBeDefined();
    expect(isInteractionAvailable(bridge!, { worldChangeKeys: [] })).toBe(true);
    expect(isInteractionAvailable(bridge!, { worldChangeKeys: ['BRIDGE_REPAIRED'] })).toBe(false);
  });

  it('wires the broken bridge to start the real Repair the Moonlight Bridge adventure', () => {
    const bridge = findInteraction(WELCOME_HARBOR_INTERACTIONS, 'broken-bridge');
    expect(bridge?.action).toEqual({
      kind: 'START_ADVENTURE',
      locationSlug: 'pirate-builder-bay',
      templateSlug: 'repair-the-moonlight-bridge',
    });
  });

  it('offers the repaired crossing only after the bridge is repaired, sharing the bridge zone', () => {
    const crossing = findInteraction(WELCOME_HARBOR_INTERACTIONS, 'moonlight-bridge-crossing');
    expect(crossing).toBeDefined();
    expect(crossing?.zoneId).toBe('broken-bridge');
    expect(isInteractionAvailable(crossing!, { worldChangeKeys: [] })).toBe(false);
    expect(isInteractionAvailable(crossing!, { worldChangeKeys: ['BRIDGE_REPAIRED'] })).toBe(true);
    expect(crossing?.action).toEqual({ kind: 'NAVIGATE', to: 'locations/pirate-builder-bay' });
  });

  it('always offers the forest and castle entrances as NAVIGATE interactions', () => {
    const forest = findInteraction(WELCOME_HARBOR_INTERACTIONS, 'forest-entrance');
    const castle = findInteraction(WELCOME_HARBOR_INTERACTIONS, 'castle-entrance');
    expect(isInteractionAvailable(forest!, { worldChangeKeys: [] })).toBe(true);
    expect(forest?.action).toEqual({ kind: 'NAVIGATE', to: 'locations/wonderwild-forest' });
    expect(isInteractionAvailable(castle!, { worldChangeKeys: [] })).toBe(true);
    expect(castle?.action).toEqual({ kind: 'NAVIGATE', to: 'locations/storykeeper-castle' });
  });

  it('always makes talking to Chatty available and tap-triggered', () => {
    const chatty = findInteraction(WELCOME_HARBOR_INTERACTIONS, 'talk-to-chatty');
    expect(chatty).toBeDefined();
    expect(chatty?.type).toBe('NPC');
    expect(chatty?.trigger).toBe('TAP');
    expect(isInteractionAvailable(chatty!, { worldChangeKeys: [] })).toBe(true);
  });

  it('always makes the flavor decor interactions available and tap-triggered', () => {
    for (const id of ['dock-sign', 'palm-tree', 'harbor-door']) {
      const decor = findInteraction(WELCOME_HARBOR_INTERACTIONS, id);
      expect(decor).toBeDefined();
      expect(decor?.trigger).toBe('TAP');
      expect(isInteractionAvailable(decor!, { worldChangeKeys: [] })).toBe(true);
    }
  });
});

describe('PIRATE_BUILDER_BAY_INTERACTIONS', () => {
  it('has no duplicate interaction ids, even though two interactions share the bridge zone', () => {
    const ids = PIRATE_BUILDER_BAY_INTERACTIONS.map((interaction) => interaction.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('offers the broken bridge only before it is repaired, and starts the real adventure', () => {
    const bridge = findInteraction(PIRATE_BUILDER_BAY_INTERACTIONS, 'bay-broken-bridge');
    expect(bridge).toBeDefined();
    expect(isInteractionAvailable(bridge!, { worldChangeKeys: [] })).toBe(true);
    expect(isInteractionAvailable(bridge!, { worldChangeKeys: ['BRIDGE_REPAIRED'] })).toBe(false);
    expect(bridge?.action).toEqual({
      kind: 'START_ADVENTURE',
      locationSlug: 'pirate-builder-bay',
      templateSlug: 'repair-the-moonlight-bridge',
    });
  });

  it('offers the repaired-bridge narration only after repair, sharing the bridge zone', () => {
    const repaired = findInteraction(PIRATE_BUILDER_BAY_INTERACTIONS, 'bay-bridge-repaired');
    expect(repaired).toBeDefined();
    expect(repaired?.zoneId).toBe('bay-broken-bridge');
    expect(isInteractionAvailable(repaired!, { worldChangeKeys: [] })).toBe(false);
    expect(isInteractionAvailable(repaired!, { worldChangeKeys: ['BRIDGE_REPAIRED'] })).toBe(true);
  });

  it('always makes meeting Pirate Pip available and tap-triggered', () => {
    const pip = findInteraction(PIRATE_BUILDER_BAY_INTERACTIONS, 'meet-pirate-pip');
    expect(pip).toBeDefined();
    expect(pip?.type).toBe('NPC');
    expect(pip?.trigger).toBe('TAP');
    expect(isInteractionAvailable(pip!, { worldChangeKeys: [] })).toBe(true);
  });

  it('always makes the material and treasure flavor interactions available and tap-triggered', () => {
    for (const id of ['bay-rope-coil', 'bay-toolbox', 'cove-treasure']) {
      const decor = findInteraction(PIRATE_BUILDER_BAY_INTERACTIONS, id);
      expect(decor).toBeDefined();
      expect(decor?.trigger).toBe('TAP');
      expect(isInteractionAvailable(decor!, { worldChangeKeys: [] })).toBe(true);
    }
  });

  it('always offers the exit back to Welcome Harbor as a NAVIGATE interaction', () => {
    const exit = findInteraction(PIRATE_BUILDER_BAY_INTERACTIONS, 'bay-harbor-exit');
    expect(exit).toBeDefined();
    expect(isInteractionAvailable(exit!, { worldChangeKeys: [] })).toBe(true);
    expect(exit?.action).toEqual({ kind: 'NAVIGATE', to: 'world' });
  });
});
