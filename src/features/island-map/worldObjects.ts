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
