import { describe, expect, it } from 'vitest';
import {
  findInteraction,
  isInteractionAvailable,
  PIRATE_BUILDER_BAY_INTERACTIONS,
  STORYKEEPER_CASTLE_INTERACTIONS,
  WELCOME_HARBOR_INTERACTIONS,
  WONDERWILD_FOREST_INTERACTIONS,
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

describe('WONDERWILD_FOREST_INTERACTIONS', () => {
  it('has no duplicate interaction ids, even though two interactions share the hive zone', () => {
    const ids = WONDERWILD_FOREST_INTERACTIONS.map((interaction) => interaction.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('offers the bee hive only before it is discovered, and starts the real adventure', () => {
    const hive = findInteraction(WONDERWILD_FOREST_INTERACTIONS, 'wonderwild-beehive');
    expect(hive).toBeDefined();
    expect(isInteractionAvailable(hive!, { worldChangeKeys: [] })).toBe(true);
    expect(isInteractionAvailable(hive!, { worldChangeKeys: ['WAGGLE_DANCE_DISCOVERED'] })).toBe(
      false,
    );
    expect(hive?.action).toEqual({
      kind: 'START_ADVENTURE',
      locationSlug: 'wonderwild-forest',
      templateSlug: 'buzz-and-the-waggle-dance',
    });
  });

  it('offers the already-discovered narration only after discovery, sharing the hive zone', () => {
    const discovered = findInteraction(
      WONDERWILD_FOREST_INTERACTIONS,
      'wonderwild-beehive-discovered',
    );
    expect(discovered).toBeDefined();
    expect(discovered?.zoneId).toBe('wonderwild-beehive');
    expect(isInteractionAvailable(discovered!, { worldChangeKeys: [] })).toBe(false);
    expect(
      isInteractionAvailable(discovered!, { worldChangeKeys: ['WAGGLE_DANCE_DISCOVERED'] }),
    ).toBe(true);
  });

  it('always makes tapping the hive available, regardless of discovery state', () => {
    const peek = findInteraction(WONDERWILD_FOREST_INTERACTIONS, 'wonderwild-beehive-peek');
    expect(peek).toBeDefined();
    expect(peek?.trigger).toBe('TAP');
    expect(isInteractionAvailable(peek!, { worldChangeKeys: [] })).toBe(true);
    expect(isInteractionAvailable(peek!, { worldChangeKeys: ['WAGGLE_DANCE_DISCOVERED'] })).toBe(
      true,
    );
  });

  it('always makes the three not-yet-built discovery points available and tap-triggered', () => {
    // The cave used to be the fourth. Phase 26 turned it into a real hidden
    // cave with a `DISCOVER` action, so it is asserted separately below.
    for (const id of [
      'wonderwild-pond-frog',
      'wonderwild-leaf-pile',
      'wonderwild-night-clearing',
    ]) {
      const discovery = findInteraction(WONDERWILD_FOREST_INTERACTIONS, id);
      expect(discovery).toBeDefined();
      expect(discovery?.trigger).toBe('TAP');
      expect(discovery?.action.kind).toBe('SHOW_MESSAGE');
      expect(isInteractionAvailable(discovery!, { worldChangeKeys: [] })).toBe(true);
    }
  });

  it('always offers the exit back to Welcome Harbor as a NAVIGATE interaction', () => {
    const exit = findInteraction(WONDERWILD_FOREST_INTERACTIONS, 'wonderwild-harbor-exit');
    expect(exit).toBeDefined();
    expect(isInteractionAvailable(exit!, { worldChangeKeys: [] })).toBe(true);
    expect(exit?.action).toEqual({ kind: 'NAVIGATE', to: 'world' });
  });
});

describe('STORYKEEPER_CASTLE_INTERACTIONS', () => {
  it('has no duplicate interaction ids, even though two interactions share the story hall zone', () => {
    const ids = STORYKEEPER_CASTLE_INTERACTIONS.map((interaction) => interaction.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('offers the story hall only before the first story is told, and starts the real adventure', () => {
    const hall = findInteraction(STORYKEEPER_CASTLE_INTERACTIONS, 'castle-story-hall');
    expect(hall).toBeDefined();
    expect(isInteractionAvailable(hall!, { worldChangeKeys: [] })).toBe(true);
    expect(isInteractionAvailable(hall!, { worldChangeKeys: ['FIRST_STORY_TOLD'] })).toBe(false);
    expect(hall?.action).toEqual({
      kind: 'START_ADVENTURE',
      locationSlug: 'storykeeper-castle',
      templateSlug: 'the-storykeepers-tale',
    });
  });

  it('offers the already-told narration only after the first story, sharing the story hall zone', () => {
    const told = findInteraction(STORYKEEPER_CASTLE_INTERACTIONS, 'castle-story-hall-told');
    expect(told).toBeDefined();
    expect(told?.zoneId).toBe('castle-story-hall');
    expect(isInteractionAvailable(told!, { worldChangeKeys: [] })).toBe(false);
    expect(isInteractionAvailable(told!, { worldChangeKeys: ['FIRST_STORY_TOLD'] })).toBe(true);
  });

  it('always makes talking to Keeper Quill available and tap-triggered', () => {
    const quill = findInteraction(STORYKEEPER_CASTLE_INTERACTIONS, 'talk-to-keeper-quill');
    expect(quill).toBeDefined();
    expect(quill?.type).toBe('NPC');
    expect(quill?.trigger).toBe('TAP');
    expect(isInteractionAvailable(quill!, { worldChangeKeys: [] })).toBe(true);
    expect(isInteractionAvailable(quill!, { worldChangeKeys: ['FIRST_STORY_TOLD'] })).toBe(true);
  });

  it('always makes the five not-yet-built creative-story rooms available and tap-triggered', () => {
    for (const id of [
      'castle-character-gallery',
      'castle-setting-tower',
      'castle-costume-room',
      'castle-great-library',
      'castle-illustration-studio',
    ]) {
      const room = findInteraction(STORYKEEPER_CASTLE_INTERACTIONS, id);
      expect(room).toBeDefined();
      expect(room?.trigger).toBe('TAP');
      expect(room?.action.kind).toBe('SHOW_MESSAGE');
      expect(isInteractionAvailable(room!, { worldChangeKeys: [] })).toBe(true);
    }
  });

  it('always offers the exit back to Welcome Harbor as a NAVIGATE interaction', () => {
    const exit = findInteraction(STORYKEEPER_CASTLE_INTERACTIONS, 'castle-harbor-exit');
    expect(exit).toBeDefined();
    expect(isInteractionAvailable(exit!, { worldChangeKeys: [] })).toBe(true);
    expect(exit?.action).toEqual({ kind: 'NAVIGATE', to: 'world' });
  });
});

/**
 * Phase 26 (docs/ROADMAP.md Phase 26). Two new requirement types and one new
 * action, plus the secrets themselves laid into the four regions Phases 10,
 * 11, 13, and 14 built.
 */
describe('Phase 26 requirements', () => {
  function gated(requirements: WorldInteraction['requirements']): WorldInteraction {
    return {
      id: 'secret',
      type: 'DISCOVERY',
      trigger: 'APPROACH',
      title: 'A secret',
      targetId: 'secret',
      requirements,
      action: { kind: 'DISCOVER', discoveryId: 'secret' },
    };
  }

  it('requires an item to be in the backpack', () => {
    const interaction = gated([{ type: 'ITEM_OWNED', itemId: 'driftwood-key' }]);

    expect(
      isInteractionAvailable(interaction, { worldChangeKeys: [], ownedItemIds: ['driftwood-key'] }),
    ).toBe(true);
    expect(
      isInteractionAvailable(interaction, { worldChangeKeys: [], ownedItemIds: ['moon-shell'] }),
    ).toBe(false);
  });

  it('requires another secret to have been found', () => {
    const interaction = gated([{ type: 'DISCOVERY_PRESENT', discoveryId: 'wonderwild-glow-moss' }]);

    expect(
      isInteractionAvailable(interaction, {
        worldChangeKeys: [],
        discoveryIds: ['wonderwild-glow-moss'],
      }),
    ).toBe(true);
    expect(isInteractionAvailable(interaction, { worldChangeKeys: [], discoveryIds: [] })).toBe(
      false,
    );
  });

  /**
   * The direction matters more than the behavior. `ownedItemIds` and
   * `discoveryIds` are optional on `WorldInteractionContext`, so a caller
   * that forgets them must hide a secret rather than reveal one: the
   * opposite default would turn a forgotten field into a locked door
   * standing open.
   */
  it('fails closed when the context omits the fields entirely', () => {
    expect(
      isInteractionAvailable(gated([{ type: 'ITEM_OWNED', itemId: 'driftwood-key' }]), {
        worldChangeKeys: [],
      }),
    ).toBe(false);
    expect(
      isInteractionAvailable(gated([{ type: 'DISCOVERY_PRESENT', discoveryId: 'anything' }]), {
        worldChangeKeys: [],
      }),
    ).toBe(false);
  });
});

describe('Phase 26 secrets in the four explorable regions', () => {
  const REGIONS: [string, WorldInteraction[]][] = [
    ['Welcome Harbor', WELCOME_HARBOR_INTERACTIONS],
    ['Pirate Builder Bay', PIRATE_BUILDER_BAY_INTERACTIONS],
    ['Wonderwild Forest', WONDERWILD_FOREST_INTERACTIONS],
    ['Storykeeper Castle', STORYKEEPER_CASTLE_INTERACTIONS],
  ];

  it('hides at least one secret in every region', () => {
    for (const [name, interactions] of REGIONS) {
      const secrets = interactions.filter((interaction) => interaction.action.kind === 'DISCOVER');
      expect(secrets.length, `${name} hides nothing`).toBeGreaterThan(0);
    }
  });

  it('has no duplicate ids after the new secrets were added', () => {
    for (const [name, interactions] of REGIONS) {
      const ids = interactions.map((interaction) => interaction.id);
      expect(new Set(ids).size, `${name} has a duplicate id`).toBe(ids.length);
    }
  });

  /**
   * The harbor door and the forest cave were flavor `SHOW_MESSAGE` lines
   * through Phases 10 to 25. Phase 26 gave both a real secret behind them,
   * and both keep their original sprite and id so the decor modules that
   * bind to them still resolve (`decor.ts`, `wonderwildForestDecor.ts`).
   */
  it('turns the two authored "not yet" spots into real secrets, keeping their ids', () => {
    const door = findInteraction(WELCOME_HARBOR_INTERACTIONS, 'harbor-door');
    expect(door?.action).toEqual({ kind: 'DISCOVER', discoveryId: 'harbor-keepers-door' });
    // Unconditionally available: the gate lives on the discovery, so a child
    // without the key still walks up to a door and is told about it, rather
    // than tapping a sprite that does nothing.
    expect(isInteractionAvailable(door!, { worldChangeKeys: [] })).toBe(true);

    const cave = findInteraction(WONDERWILD_FOREST_INTERACTIONS, 'wonderwild-cave');
    expect(cave?.action).toEqual({ kind: 'DISCOVER', discoveryId: 'wonderwild-glowworm-cave' });
    expect(isInteractionAvailable(cave!, { worldChangeKeys: [] })).toBe(true);
  });

  it('keeps the cove tunnel out of the list until the bridge that reaches it is repaired', () => {
    const tunnel = findInteraction(PIRATE_BUILDER_BAY_INTERACTIONS, 'bay-tide-tunnel');

    expect(isInteractionAvailable(tunnel!, { worldChangeKeys: [] })).toBe(false);
    expect(isInteractionAvailable(tunnel!, { worldChangeKeys: ['BRIDGE_REPAIRED'] })).toBe(true);
  });

  it('offers the unmarked walk-in secrets to a child who has done nothing yet', () => {
    for (const [region, id] of [
      [WELCOME_HARBOR_INTERACTIONS, 'harbor-tide-pool'],
      [WONDERWILD_FOREST_INTERACTIONS, 'wonderwild-glow-moss'],
      [STORYKEEPER_CASTLE_INTERACTIONS, 'castle-tapestry-stair'],
    ] as [WorldInteraction[], string][]) {
      const secret = findInteraction(region, id);
      expect(secret, id).toBeDefined();
      expect(secret?.trigger, id).toBe('APPROACH');
      expect(isInteractionAvailable(secret!, { worldChangeKeys: [] }), id).toBe(true);
    }
  });
});
