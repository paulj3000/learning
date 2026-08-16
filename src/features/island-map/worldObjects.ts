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
 * Welcome Harbor's Phase 9 interactions. Walking up to the bridge starts the
 * real "Repair the Moonlight Bridge" adventure directly (roadmap section 8's
 * "Child approaches broken bridge -> ... -> Adventure Engine starts" flow);
 * tapping Chatty greets the child. Everything else in the roadmap's
 * "environmental curiosity" list (section 17) arrives in later phases.
 */
export const WELCOME_HARBOR_INTERACTIONS: WorldInteraction[] = [
  {
    id: 'broken-bridge',
    type: 'ADVENTURE',
    trigger: 'APPROACH',
    title: 'The broken bridge to Pirate Builder Bay',
    targetId: 'pirate-builder-bay',
    requirements: [{ type: 'ALWAYS' }],
    action: {
      kind: 'START_ADVENTURE',
      locationSlug: 'pirate-builder-bay',
      templateSlug: 'repair-the-moonlight-bridge',
    },
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
];
