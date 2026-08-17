/**
 * The world object/interaction registry (docs/LEARNING_ADVENTURE_ISLAND_EXPLORABLE_WORLD_ROADMAP.md
 * section 8). Pure data and pure functions, deliberately Phaser-free so
 * requirement checks stay unit-testable without a rendering context
 * (docs/ADVENTURE_ENGINE.md "World entry points").
 */

export type WorldRequirement =
  | { type: 'ALWAYS' }
  | { type: 'WORLD_CHANGE_PRESENT'; changeKey: string }
  | { type: 'WORLD_CHANGE_ABSENT'; changeKey: string };

export type WorldAction =
  | { kind: 'NAVIGATE'; to: string }
  | { kind: 'SHOW_MESSAGE'; message: string }
  | { kind: 'START_ADVENTURE'; locationSlug: string; templateSlug: string };

export interface WorldInteraction {
  id: string;
  type: 'NPC' | 'OBJECT' | 'LOCATION' | 'DISCOVERY' | 'ADVENTURE';
  trigger: 'TAP' | 'APPROACH' | 'ENTER' | 'USE';
  /** Child-facing label shown when the interaction becomes available. */
  title: string;
  targetId: string;
  requirements?: WorldRequirement[];
  action: WorldAction;
  /**
   * `zones.ts` key to read this interaction's walk-in rectangle from, for
   * APPROACH/ENTER interactions only. Defaults to `id` when absent. Lets two
   * interactions share one zone (e.g. the bridge, before/after repair)
   * *without* sharing an `id` — every lookup in this module and in
   * `WelcomeHarborScene` resolves by `id` and returns the first array match,
   * so two interactions with the same `id` would make the wrong one
   * unreachable once both existed simultaneously in different requirement
   * states.
   */
  zoneId?: string;
}

export interface WorldInteractionContext {
  /** `WorldChange.changeKey`s already recorded for this child (docs/DATA_MODEL.md). */
  worldChangeKeys: readonly string[];
}

function evaluateRequirement(
  requirement: WorldRequirement,
  context: WorldInteractionContext,
): boolean {
  switch (requirement.type) {
    case 'ALWAYS':
      return true;
    case 'WORLD_CHANGE_PRESENT':
      return context.worldChangeKeys.includes(requirement.changeKey);
    case 'WORLD_CHANGE_ABSENT':
      return !context.worldChangeKeys.includes(requirement.changeKey);
  }
}

/** Whether every requirement on this interaction is currently satisfied. */
export function isInteractionAvailable(
  interaction: WorldInteraction,
  context: WorldInteractionContext,
): boolean {
  if (!interaction.requirements || interaction.requirements.length === 0) {
    return true;
  }
  return interaction.requirements.every((requirement) => evaluateRequirement(requirement, context));
}

export function findInteraction(
  interactions: readonly WorldInteraction[],
  id: string,
): WorldInteraction | undefined {
  return interactions.find((interaction) => interaction.id === id);
}

/**
 * Welcome Harbor's Phase 10 interactions
 * (docs/LEARNING_ADVENTURE_ISLAND_EXPLORABLE_WORLD_ROADMAP.md section 29).
 * Walking up to the bridge starts the real "Repair the Moonlight Bridge"
 * adventure directly (roadmap section 8's "Child approaches broken bridge ->
 * ... -> Adventure Engine starts" flow) until it's repaired, after which the
 * same spot lets the child sail on to Pirate Builder Bay instead
 * ("persistent world changes"). Two more APPROACH interactions mark the
 * entrances toward Wonderwild Forest and Storykeeper Castle
 * ("adventure entrances" / "location transitions") — both `NAVIGATE` to the
 * existing card-based location routes rather than a new spatial scene, since
 * those locations don't have one yet (roadmap phases 13/14). Tapping Chatty
 * greets the child. Three flavor `OBJECT`/`DISCOVERY` interactions ("doors",
 * "signs", "interactive objects") are pure environmental curiosity (roadmap
 * section 17) with no gating and no backend state.
 */
export const WELCOME_HARBOR_INTERACTIONS: WorldInteraction[] = [
  {
    id: 'broken-bridge',
    type: 'ADVENTURE',
    trigger: 'APPROACH',
    title: 'The broken bridge to Pirate Builder Bay',
    targetId: 'pirate-builder-bay',
    requirements: [{ type: 'WORLD_CHANGE_ABSENT', changeKey: 'BRIDGE_REPAIRED' }],
    action: {
      kind: 'START_ADVENTURE',
      locationSlug: 'pirate-builder-bay',
      templateSlug: 'repair-the-moonlight-bridge',
    },
  },
  {
    id: 'moonlight-bridge-crossing',
    type: 'LOCATION',
    trigger: 'APPROACH',
    title: 'The repaired bridge to Pirate Builder Bay',
    targetId: 'pirate-builder-bay',
    requirements: [{ type: 'WORLD_CHANGE_PRESENT', changeKey: 'BRIDGE_REPAIRED' }],
    action: { kind: 'NAVIGATE', to: 'locations/pirate-builder-bay' },
    zoneId: 'broken-bridge',
  },
  {
    id: 'forest-entrance',
    type: 'LOCATION',
    trigger: 'APPROACH',
    title: 'The path into Wonderwild Forest',
    targetId: 'wonderwild-forest',
    requirements: [{ type: 'ALWAYS' }],
    action: { kind: 'NAVIGATE', to: 'locations/wonderwild-forest' },
  },
  {
    id: 'castle-entrance',
    type: 'LOCATION',
    trigger: 'APPROACH',
    title: 'The path to Storykeeper Castle',
    targetId: 'storykeeper-castle',
    requirements: [{ type: 'ALWAYS' }],
    action: { kind: 'NAVIGATE', to: 'locations/storykeeper-castle' },
  },
  {
    id: 'talk-to-chatty',
    type: 'NPC',
    trigger: 'TAP',
    title: 'Chatty the Parrot',
    targetId: 'chatty',
    requirements: [{ type: 'ALWAYS' }],
    action: {
      kind: 'SHOW_MESSAGE',
      message: 'Squawk! Welcome to Welcome Harbor! That bridge over there needs some repairs.',
    },
  },
  {
    id: 'dock-sign',
    type: 'OBJECT',
    trigger: 'TAP',
    title: 'A wooden sign',
    targetId: 'dock-sign',
    requirements: [{ type: 'ALWAYS' }],
    action: {
      kind: 'SHOW_MESSAGE',
      message: 'WELCOME HARBOR — Bridge: east. Forest: west. Castle: north.',
    },
  },
  {
    id: 'palm-tree',
    type: 'OBJECT',
    trigger: 'TAP',
    title: 'A palm tree',
    targetId: 'palm-tree',
    requirements: [{ type: 'ALWAYS' }],
    action: {
      kind: 'SHOW_MESSAGE',
      message: 'You shake the palm tree. A coconut wobbles but stays put!',
    },
  },
  {
    id: 'harbor-door',
    type: 'DISCOVERY',
    trigger: 'TAP',
    title: "The harbor keeper's door",
    targetId: 'harbor-door',
    requirements: [{ type: 'ALWAYS' }],
    action: {
      kind: 'SHOW_MESSAGE',
      message: 'You knock, but nobody is home right now. Maybe try again another day!',
    },
  },
];

/**
 * Pirate Builder Bay's Phase 11 interactions
 * (docs/LEARNING_ADVENTURE_ISLAND_EXPLORABLE_WORLD_ROADMAP.md section 30):
 * the first fully spatial adventure location. Walking up to the bridge
 * starts the same real "Repair the Moonlight Bridge" adventure Welcome
 * Harbor's shortcut already offers (`resumeOrStartSession` makes starting it
 * twice safe — the second attempt just resumes or replays the completed
 * session); once repaired, the same spot narrates the payoff instead, and
 * the water-channel collision (`pirateBuilderBayTilemap.ts`) — not a
 * requirement here — is what actually opens the cove beyond it ("discover
 * new area"). Tapping Pirate Pip is the "meet character" beat; the rope and
 * toolbox are "find materials" flavor, same framing as Welcome Harbor's
 * decor (roadmap section 17, "some are purely playful"). The treasure chest
 * sits in the cove itself, so it needs no gating of its own: nothing can
 * reach it before the bridge is repaired.
 */
export const PIRATE_BUILDER_BAY_INTERACTIONS: WorldInteraction[] = [
  {
    id: 'bay-broken-bridge',
    type: 'ADVENTURE',
    trigger: 'APPROACH',
    title: 'The broken Moonlight Bridge',
    targetId: 'pirate-builder-bay',
    requirements: [{ type: 'WORLD_CHANGE_ABSENT', changeKey: 'BRIDGE_REPAIRED' }],
    action: {
      kind: 'START_ADVENTURE',
      locationSlug: 'pirate-builder-bay',
      templateSlug: 'repair-the-moonlight-bridge',
    },
  },
  {
    id: 'bay-bridge-repaired',
    type: 'DISCOVERY',
    trigger: 'APPROACH',
    title: 'The repaired Moonlight Bridge',
    targetId: 'pirate-builder-bay',
    requirements: [{ type: 'WORLD_CHANGE_PRESENT', changeKey: 'BRIDGE_REPAIRED' }],
    action: {
      kind: 'SHOW_MESSAGE',
      message: 'You watch the last plank settle into place. The bridge glows in the moonlight!',
    },
    zoneId: 'bay-broken-bridge',
  },
  {
    id: 'meet-pirate-pip',
    type: 'NPC',
    trigger: 'TAP',
    title: 'Pirate Pip',
    targetId: 'pirate-pip',
    requirements: [{ type: 'ALWAYS' }],
    action: {
      kind: 'SHOW_MESSAGE',
      message:
        "Ahoy! I'm Pirate Pip. That bridge to the cove needs fixing. Think you can help me find what's missing?",
    },
  },
  {
    id: 'bay-rope-coil',
    type: 'OBJECT',
    trigger: 'TAP',
    title: 'A coil of rope',
    targetId: 'bay-rope-coil',
    requirements: [{ type: 'ALWAYS' }],
    action: {
      kind: 'SHOW_MESSAGE',
      message: 'A coil of sturdy rope, ready for the next repair.',
    },
  },
  {
    id: 'bay-toolbox',
    type: 'OBJECT',
    trigger: 'TAP',
    title: "Pirate Pip's toolbox",
    targetId: 'bay-toolbox',
    requirements: [{ type: 'ALWAYS' }],
    action: {
      kind: 'SHOW_MESSAGE',
      message: 'Hammer, nails, and a measuring string, all ready to go.',
    },
  },
  {
    id: 'cove-treasure',
    type: 'DISCOVERY',
    trigger: 'TAP',
    title: 'A hidden treasure chest',
    targetId: 'cove-treasure',
    requirements: [{ type: 'ALWAYS' }],
    action: {
      kind: 'SHOW_MESSAGE',
      message: 'You found a hidden treasure chest in the cove! X marks the spot.',
    },
  },
  {
    id: 'bay-harbor-exit',
    type: 'LOCATION',
    trigger: 'APPROACH',
    title: 'The path back to Welcome Harbor',
    targetId: 'welcome-harbor',
    requirements: [{ type: 'ALWAYS' }],
    action: { kind: 'NAVIGATE', to: 'world' },
  },
];
