/**
 * The world object/interaction registry (docs/LEARNING_ADVENTURE_ISLAND_EXPLORABLE_WORLD_ROADMAP.md
 * section 8). Pure data and pure functions, deliberately Phaser-free so
 * requirement checks stay unit-testable without a rendering context
 * (docs/ADVENTURE_ENGINE.md "World entry points").
 */

export type WorldRequirement =
  | { type: 'ALWAYS' }
  | { type: 'WORLD_CHANGE_PRESENT'; changeKey: string }
  | { type: 'WORLD_CHANGE_ABSENT'; changeKey: string }
  /** Phase 26: the spot only exists once the child is carrying something. */
  | { type: 'ITEM_OWNED'; itemId: string }
  /** Phase 26: the spot only exists once another secret has been found. */
  | { type: 'DISCOVERY_PRESENT'; discoveryId: string };

export type WorldAction =
  | { kind: 'NAVIGATE'; to: string }
  | { kind: 'SHOW_MESSAGE'; message: string }
  | { kind: 'START_ADVENTURE'; locationSlug: string; templateSlug: string }
  /**
   * Phase 26: hands this spot to the Discovery Engine
   * (src/features/discovery/), which owns whether the secret opens, what it
   * says in either case, and what finding it grants.
   *
   * Deliberately carries only an id and no copy. A locked door has two
   * child-facing lines, not one, and duplicating either of them here would
   * let the world layer and the discovery content drift apart - so the
   * authored `DiscoveryDefinition` is the single place both live.
   */
  | { kind: 'DISCOVER'; discoveryId: string };

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
  /**
   * `ItemDefinition.id`s in this child's backpack (Phase 24), and
   * `DiscoveryDefinition.id`s they have already found (Phase 26).
   *
   * Optional rather than required so the many existing call sites that only
   * care about world changes - `LocationScene`'s own tests, and every
   * pre-Phase-26 assertion - keep compiling and keep meaning what they said.
   * Every live world view supplies all three (`useExplorableWorld`).
   *
   * Absent is treated as empty, which fails *closed*: a caller that omits
   * them hides a secret rather than revealing one, and `worldObjects.test.ts`
   * asserts that direction explicitly, since the opposite default would turn
   * a forgotten field into a locked door standing open.
   */
  ownedItemIds?: readonly string[];
  discoveryIds?: readonly string[];
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
    case 'ITEM_OWNED':
      return (context.ownedItemIds ?? []).includes(requirement.itemId);
    case 'DISCOVERY_PRESENT':
      return (context.discoveryIds ?? []).includes(requirement.discoveryId);
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
 * existing card-based location routes rather than jumping straight into
 * either location's own spatial scene (`WONDERWILD_FOREST_INTERACTIONS`/
 * `STORYKEEPER_CASTLE_INTERACTIONS` below); each location's card-based page
 * offers its own "try walking/exploring" link into that scene instead
 * (`IslandLocationPage.tsx`). Tapping Chatty greets the child. Three flavor
 * `OBJECT`/`DISCOVERY` interactions ("doors", "signs", "interactive
 * objects") are pure environmental curiosity (roadmap section 17) with no
 * gating and no backend state.
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
  /**
   * Phase 26's locked door (docs/ROADMAP.md Phase 26). Was a flavor
   * `SHOW_MESSAGE` through Phases 10 to 25; it now hands the same sprite to
   * the Discovery Engine, which shows the "locked, and the keyhole is shaped
   * like driftwood" line until the child is carrying the driftwood key from
   * the bay's tide tunnel, and opens the room behind it after.
   *
   * The interaction itself stays unconditionally available on purpose. The
   * requirement lives on the *discovery*, not here, so a child who cannot
   * open the door yet still walks up to a door and is told something about
   * it - rather than tapping a sprite that silently does nothing, which is
   * what a `requirements` gate at this layer would produce.
   */
  {
    id: 'harbor-door',
    type: 'DISCOVERY',
    trigger: 'TAP',
    title: "The harbor keeper's door",
    targetId: 'harbor-door',
    requirements: [{ type: 'ALWAYS' }],
    action: { kind: 'DISCOVER', discoveryId: 'harbor-keepers-door' },
  },
  /**
   * Phase 26's free secret: an unmarked APPROACH zone in the quiet
   * south-east corner of the beach, with no sprite and nothing pointing at
   * it. A child finds it by wandering off the path, which is the whole point
   * (explorable-world roadmap section 16). Finding it also starts "The Quiet
   * Places" (src/features/quests/content/islandQuests.ts) - the discovery is
   * the quest giver, since no NPC conversation screen exists yet.
   */
  {
    id: 'harbor-tide-pool',
    type: 'DISCOVERY',
    trigger: 'APPROACH',
    title: 'A tide pool behind the rocks',
    targetId: 'harbor-tide-pool',
    requirements: [{ type: 'ALWAYS' }],
    action: { kind: 'DISCOVER', discoveryId: 'harbor-tide-pool' },
  },
  {
    id: 'mountain-path',
    type: 'LOCATION',
    trigger: 'APPROACH',
    title: 'A hidden path up the mountain',
    targetId: 'dragons-sanctuary',
    requirements: [
      { type: 'WORLD_CHANGE_PRESENT', changeKey: 'DRAGON_OF_EMBER_MOUNTAIN_COMPLETE' },
    ],
    action: { kind: 'NAVIGATE', to: 'locations/dragons-sanctuary' },
  },
  {
    id: 'fossil-ridge-path',
    type: 'LOCATION',
    trigger: 'APPROACH',
    title: 'A trail marked with fresh footprints',
    targetId: 'fossil-ridge-camp',
    requirements: [{ type: 'WORLD_CHANGE_PRESENT', changeKey: 'DINOSAUR_EXPEDITION_COMPLETE' }],
    action: { kind: 'NAVIGATE', to: 'locations/fossil-ridge-camp' },
  },
  {
    id: 'bolts-workshop-path',
    type: 'LOCATION',
    trigger: 'APPROACH',
    title: 'A little door marked "Bolt\'s Workshop"',
    targetId: 'bolts-workshop',
    requirements: [{ type: 'WORLD_CHANGE_PRESENT', changeKey: 'ROBOT_RESCUE_COMPLETE' }],
    action: { kind: 'NAVIGATE', to: 'locations/bolts-workshop' },
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
  /**
   * Phase 26's secret passage. Sits at the back of the cove, which is only
   * reachable across the repaired bridge, so the geometry gates it already;
   * the `WORLD_CHANGE_PRESENT` requirement is here so the "Things to do
   * here" list cannot offer a tunnel the child has no way to walk to
   * (that list bypasses the avatar entirely, roadmap section 42).
   *
   * This is where the driftwood key lives, and it is the only place on the
   * island that has one.
   */
  {
    id: 'bay-tide-tunnel',
    type: 'DISCOVERY',
    trigger: 'APPROACH',
    title: 'A low tunnel under the cliff',
    targetId: 'bay-tide-tunnel',
    requirements: [{ type: 'WORLD_CHANGE_PRESENT', changeKey: 'BRIDGE_REPAIRED' }],
    action: { kind: 'DISCOVER', discoveryId: 'bay-tide-tunnel' },
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

/**
 * Wonderwild Forest's Phase 13 interactions
 * (docs/LEARNING_ADVENTURE_ISLAND_EXPLORABLE_WORLD_ROADMAP.md section 32):
 * turns the forest from a question-selection interface into a
 * discovery-driven environment. Walking up to the bee hive starts the real
 * "Buzz and the Waggle Dance" adventure directly, same
 * `WORLD_CHANGE_ABSENT`/`WORLD_CHANGE_PRESENT` before/after pair sharing one
 * zone as the bay's bridge; once discovered, the same spot narrates the
 * payoff instead. Tapping the hive sprite itself always shows a short flavor
 * line regardless of discovery state (`wonderwild-beehive-peek`), since a
 * decor sprite can only bind to one interaction id but the zone it sits on
 * needs two (see `wonderwildForestDecor.ts`'s header comment). The pond,
 * leaf pile, cave mouth, and night clearing are the roadmap's other four
 * discovery points (`Pond -> Frog adventure`, `Leaves -> Seasons adventure`,
 * `Cave -> Geology`, `Night clearing -> Astronomy`); none has a built
 * adventure yet, so each is an honest, calm "not yet" flavor interaction
 * rather than a dead end or a fake adventure link — matching the existing
 * Wonder Wall's own precedent for an out-of-scope curiosity question
 * (`buzzAndTheWaggleDance.ts`'s `wonder-wall-fallback`). The existing
 * card-based Wonder Wall adventure entry remains reachable from
 * `IslandLocationPage` exactly as before (roadmap section 32: "the existing
 * Wonder Wall may remain as an optional interface").
 */
export const WONDERWILD_FOREST_INTERACTIONS: WorldInteraction[] = [
  {
    id: 'wonderwild-beehive',
    type: 'ADVENTURE',
    trigger: 'APPROACH',
    title: 'The buzzing bee hive',
    targetId: 'wonderwild-forest',
    requirements: [{ type: 'WORLD_CHANGE_ABSENT', changeKey: 'WAGGLE_DANCE_DISCOVERED' }],
    action: {
      kind: 'START_ADVENTURE',
      locationSlug: 'wonderwild-forest',
      templateSlug: 'buzz-and-the-waggle-dance',
    },
  },
  {
    id: 'wonderwild-beehive-discovered',
    type: 'DISCOVERY',
    trigger: 'APPROACH',
    title: 'The hive you already discovered',
    targetId: 'wonderwild-forest',
    requirements: [{ type: 'WORLD_CHANGE_PRESENT', changeKey: 'WAGGLE_DANCE_DISCOVERED' }],
    action: {
      kind: 'SHOW_MESSAGE',
      message: 'You can still hear the gentle hum of the waggle dance inside the hive.',
    },
    zoneId: 'wonderwild-beehive',
  },
  {
    id: 'wonderwild-beehive-peek',
    type: 'OBJECT',
    trigger: 'TAP',
    title: 'Peek at the hive',
    targetId: 'wonderwild-beehive',
    requirements: [{ type: 'ALWAYS' }],
    action: {
      kind: 'SHOW_MESSAGE',
      message: 'A hive of bees hums happily. Walk closer to find out what they are doing!',
    },
  },
  {
    id: 'wonderwild-pond-frog',
    type: 'OBJECT',
    trigger: 'TAP',
    title: 'A quiet pond',
    targetId: 'wonderwild-pond-frog',
    requirements: [{ type: 'ALWAYS' }],
    action: {
      kind: 'SHOW_MESSAGE',
      message:
        'A little frog blinks at you from a lily pad. Maybe there is an adventure here someday!',
    },
  },
  {
    id: 'wonderwild-leaf-pile',
    type: 'OBJECT',
    trigger: 'TAP',
    title: 'A pile of leaves',
    targetId: 'wonderwild-leaf-pile',
    requirements: [{ type: 'ALWAYS' }],
    action: {
      kind: 'SHOW_MESSAGE',
      message: 'Red, gold, and brown leaves rustle in a soft pile. They change with every season.',
    },
  },
  /**
   * Phase 26's hidden cave. Phase 13 authored this as an honest "not yet"
   * flavor line ("too dark to explore just yet"); Phase 26 is the "yet". The
   * light it needs is the jar of glowing moss hidden elsewhere in this same
   * forest, so the whole chain is walkable without leaving Wonderwild.
   */
  {
    id: 'wonderwild-cave',
    type: 'DISCOVERY',
    trigger: 'TAP',
    title: 'A shadowy cave',
    targetId: 'wonderwild-cave',
    requirements: [{ type: 'ALWAYS' }],
    action: { kind: 'DISCOVER', discoveryId: 'wonderwild-glowworm-cave' },
  },
  /** Phase 26's unmarked APPROACH zone, in the quiet south-west of the forest. */
  {
    id: 'wonderwild-glow-moss',
    type: 'DISCOVERY',
    trigger: 'APPROACH',
    title: 'A green light under the ferns',
    targetId: 'wonderwild-glow-moss',
    requirements: [{ type: 'ALWAYS' }],
    action: { kind: 'DISCOVER', discoveryId: 'wonderwild-glow-moss' },
  },
  {
    id: 'wonderwild-night-clearing',
    type: 'DISCOVERY',
    trigger: 'TAP',
    title: 'A quiet clearing',
    targetId: 'wonderwild-night-clearing',
    requirements: [{ type: 'ALWAYS' }],
    action: {
      kind: 'SHOW_MESSAGE',
      message: 'A peaceful clearing, perfect for imagining the stars coming out at night.',
    },
  },
  {
    id: 'wonderwild-butterfly',
    type: 'DISCOVERY',
    trigger: 'TAP',
    title: 'A visiting butterfly',
    targetId: 'wonderwild-butterfly',
    requirements: [
      { type: 'WORLD_CHANGE_PRESENT', changeKey: 'SAVE_THE_BUTTERFLY_GARDEN_COMPLETE' },
    ],
    action: {
      kind: 'SHOW_MESSAGE',
      message:
        'A bright butterfly drifts past. Word travels fast when a garden comes back to life!',
    },
  },
  {
    id: 'wonderwild-harbor-exit',
    type: 'LOCATION',
    trigger: 'APPROACH',
    title: 'The path back to Welcome Harbor',
    targetId: 'welcome-harbor',
    requirements: [{ type: 'ALWAYS' }],
    action: { kind: 'NAVIGATE', to: 'world' },
  },
];

/**
 * Storykeeper Castle's Phase 14 interactions
 * (docs/LEARNING_ADVENTURE_ISLAND_EXPLORABLE_WORLD_ROADMAP.md section 33):
 * turns the castle into a physical creative-story environment. Walking into
 * the story hall starts the real "The Storykeeper's Tale" adventure
 * directly, the same `WORLD_CHANGE_ABSENT`/`WORLD_CHANGE_PRESENT`
 * before/after pair sharing one zone as the bay's bridge and the forest's
 * hive; once told, the same spot narrates the payoff instead. Tapping
 * Keeper Quill (a stationary `CHARACTER` decor sprite, same call
 * `pirateBuilderBayDecor.ts` made for Pirate Pip) is the "meet character"
 * beat and is always available, independent of the story hall's discovery
 * state. The Character Gallery, Setting Tower, Costume Room, Great Library,
 * and Illustration Studio are the roadmap's own five other "potential
 * areas"; none has bounded creative-choice content of its own built yet, so
 * each is an honest, calm "not yet" flavor `SHOW_MESSAGE` rather than a dead
 * end or a fake adventure link — the same framing `WONDERWILD_FOREST_INTERACTIONS`
 * above already established for its own not-yet-built discovery points. The
 * existing card-based "The Storykeeper's Tale" entry
 * (`IslandLocationPage` -> "Start: The Storykeeper's Tale") remains
 * reachable exactly as before.
 */
export const STORYKEEPER_CASTLE_INTERACTIONS: WorldInteraction[] = [
  {
    id: 'castle-story-hall',
    type: 'ADVENTURE',
    trigger: 'APPROACH',
    title: "Keeper Quill's story hall",
    targetId: 'storykeeper-castle',
    requirements: [{ type: 'WORLD_CHANGE_ABSENT', changeKey: 'FIRST_STORY_TOLD' }],
    action: {
      kind: 'START_ADVENTURE',
      locationSlug: 'storykeeper-castle',
      templateSlug: 'the-storykeepers-tale',
    },
  },
  {
    id: 'castle-story-hall-told',
    type: 'DISCOVERY',
    trigger: 'APPROACH',
    title: 'The story hall',
    targetId: 'storykeeper-castle',
    requirements: [{ type: 'WORLD_CHANGE_PRESENT', changeKey: 'FIRST_STORY_TOLD' }],
    action: {
      kind: 'SHOW_MESSAGE',
      message: 'Keeper Quill smiles. Your story already has a home on the shelf.',
    },
    zoneId: 'castle-story-hall',
  },
  {
    id: 'talk-to-keeper-quill',
    type: 'NPC',
    trigger: 'TAP',
    title: 'Keeper Quill',
    targetId: 'keeper-quill',
    requirements: [{ type: 'ALWAYS' }],
    action: {
      kind: 'SHOW_MESSAGE',
      message:
        "Welcome to the castle! I keep all the island's stories here. Walk into the story hall whenever you are ready to tell a new one.",
    },
  },
  {
    id: 'castle-character-gallery',
    type: 'OBJECT',
    trigger: 'TAP',
    title: 'The Character Gallery',
    targetId: 'castle-character-gallery',
    requirements: [{ type: 'ALWAYS' }],
    action: {
      kind: 'SHOW_MESSAGE',
      message:
        'Portraits of brave heroes line the walls: puppies, dragons, foxes, and more. Maybe you will meet one in your next story!',
    },
  },
  {
    id: 'castle-setting-tower',
    type: 'DISCOVERY',
    trigger: 'TAP',
    title: 'The Setting Tower',
    targetId: 'castle-setting-tower',
    requirements: [{ type: 'ALWAYS' }],
    action: {
      kind: 'SHOW_MESSAGE',
      message:
        'From the tower window you can see floating islands, snowy mountains, and glowing caves. Every story needs a place to happen!',
    },
  },
  {
    id: 'castle-costume-room',
    type: 'OBJECT',
    trigger: 'TAP',
    title: 'The Costume Room',
    targetId: 'castle-costume-room',
    requirements: [{ type: 'ALWAYS' }],
    action: {
      kind: 'SHOW_MESSAGE',
      message:
        'Racks of costumes wait for every kind of hero. Maybe you will dress up for a story someday!',
    },
  },
  {
    id: 'castle-great-library',
    type: 'DISCOVERY',
    trigger: 'TAP',
    title: 'The Great Library',
    targetId: 'castle-great-library',
    requirements: [{ type: 'ALWAYS' }],
    action: {
      kind: 'SHOW_MESSAGE',
      message: 'Shelves and shelves of stories, old and new, wait to be read.',
    },
  },
  {
    id: 'castle-illustration-studio',
    type: 'OBJECT',
    trigger: 'TAP',
    title: 'The Illustration Studio',
    targetId: 'castle-illustration-studio',
    requirements: [{ type: 'ALWAYS' }],
    action: {
      kind: 'SHOW_MESSAGE',
      message: 'An easel with a blank page waits, ready for pictures once your story is told.',
    },
  },
  {
    id: 'castle-harbor-exit',
    type: 'LOCATION',
    trigger: 'APPROACH',
    title: 'The path back to Welcome Harbor',
    targetId: 'welcome-harbor',
    requirements: [{ type: 'ALWAYS' }],
    action: { kind: 'NAVIGATE', to: 'world' },
  },
  /**
   * Phase 26's second secret passage: an unmarked APPROACH zone in the
   * castle's south-west corner. Distinct from `castle-last-bookshelf`
   * directly below, which is Phase 16's *story-unlocked* route into a whole
   * separate location; this one leads nowhere at all, and that is the point.
   * Some secrets are just a nice place to sit (roadmap section 17, "some are
   * purely playful").
   */
  {
    id: 'castle-tapestry-stair',
    type: 'DISCOVERY',
    trigger: 'APPROACH',
    title: 'A tapestry that moves',
    targetId: 'castle-tapestry-stair',
    requirements: [{ type: 'ALWAYS' }],
    action: { kind: 'DISCOVER', discoveryId: 'castle-tapestry-stair' },
  },
  {
    id: 'castle-last-bookshelf',
    type: 'LOCATION',
    trigger: 'APPROACH',
    title: 'The last bookshelf, standing ajar',
    targetId: 'castle-writing-room',
    requirements: [{ type: 'WORLD_CHANGE_PRESENT', changeKey: 'THE_CASTLES_SECRET_DOOR_COMPLETE' }],
    action: { kind: 'NAVIGATE', to: 'locations/castle-writing-room' },
  },
];

/**
 * The Dragon's Sanctuary's Phase 16 interactions (docs/ROADMAP.md Phase 16,
 * "Island Progression"): the first location that only exists because of a
 * story, not an adventure of its own. Reaching this location at all already
 * requires `DRAGON_OF_EMBER_MOUNTAIN_COMPLETE` (`WELCOME_HARBOR_INTERACTIONS`'s
 * `mountain-path` above, and `IslandLocationPage`/`DragonsSanctuaryWorldPage`'s
 * own checks), so every interaction here is unconditionally available — no
 * child ever sees this scene without having already earned it. The dragon is
 * a stationary `CHARACTER`-shaped decor sprite ("returning character"), the
 * same pattern `PIRATE_BUILDER_BAY_INTERACTIONS` used for Pirate Pip, since
 * `LocationScene`'s data-driven `npcs` framework is Chatty-specific
 * (follow behavior only Chatty needs).
 */
export const DRAGONS_SANCTUARY_INTERACTIONS: WorldInteraction[] = [
  {
    id: 'meet-ember-dragon',
    type: 'NPC',
    trigger: 'TAP',
    title: 'The dragon',
    targetId: 'ember-dragon',
    requirements: [{ type: 'ALWAYS' }],
    action: {
      kind: 'SHOW_MESSAGE',
      message:
        'The dragon dips her head toward you. She remembers the child who helped her feel safe again.',
    },
  },
  {
    id: 'dragons-sanctuary-egg',
    type: 'OBJECT',
    trigger: 'TAP',
    title: "The dragon's egg",
    targetId: 'dragons-sanctuary-egg',
    requirements: [{ type: 'ALWAYS' }],
    action: {
      kind: 'SHOW_MESSAGE',
      message: 'The egg glows warm and safe, tucked close beside its mother.',
    },
  },
  {
    id: 'dragons-sanctuary-harbor-exit',
    type: 'LOCATION',
    trigger: 'APPROACH',
    title: 'The path back to Welcome Harbor',
    targetId: 'welcome-harbor',
    requirements: [{ type: 'ALWAYS' }],
    action: { kind: 'NAVIGATE', to: 'world' },
  },
];

/**
 * Fossil Ridge Camp's Phase 16 interactions (docs/ROADMAP.md Phase 16,
 * "Island Progression"): the second "story-dependent environmental change"
 * example, alongside the Dragon's Sanctuary. Every entry is unconditionally
 * available, since reaching the location at all already requires
 * `DINOSAUR_EXPEDITION_COMPLETE`.
 */
export const FOSSIL_RIDGE_CAMP_INTERACTIONS: WorldInteraction[] = [
  {
    id: 'meet-the-fossil',
    type: 'DISCOVERY',
    trigger: 'TAP',
    title: 'The assembled skeleton',
    targetId: 'fossil-ridge-skeleton',
    requirements: [{ type: 'ALWAYS' }],
    action: {
      kind: 'SHOW_MESSAGE',
      message: 'Round feet, blunt toes, huge steps: a giant plant eater, fully assembled at last.',
    },
  },
  {
    id: 'fossil-ridge-dig-tools',
    type: 'OBJECT',
    trigger: 'TAP',
    title: 'A set of dig tools',
    targetId: 'fossil-ridge-dig-tools',
    requirements: [{ type: 'ALWAYS' }],
    action: {
      kind: 'SHOW_MESSAGE',
      message: 'Brushes, a sieve, and a notebook full of measurements, ready for the next dig.',
    },
  },
  {
    id: 'fossil-ridge-camp-harbor-exit',
    type: 'LOCATION',
    trigger: 'APPROACH',
    title: 'The path back to Welcome Harbor',
    targetId: 'welcome-harbor',
    requirements: [{ type: 'ALWAYS' }],
    action: { kind: 'NAVIGATE', to: 'world' },
  },
];

/**
 * The Writing Room's Phase 16 interactions (docs/ROADMAP.md Phase 16,
 * "Island Progression"): the third "story-dependent environmental change"
 * example. Reached from inside Storykeeper Castle itself
 * (`STORYKEEPER_CASTLE_INTERACTIONS`'s `castle-last-bookshelf`, matching the
 * story's own "behind the last bookshelf" framing) rather than from Welcome
 * Harbor, so its own exit leads back into the castle, not to Welcome
 * Harbor. Every entry here is unconditionally available, since reaching the
 * location at all already requires `THE_CASTLES_SECRET_DOOR_COMPLETE`.
 */
export const CASTLE_WRITING_ROOM_INTERACTIONS: WorldInteraction[] = [
  {
    id: 'writing-room-desk',
    type: 'DISCOVERY',
    trigger: 'TAP',
    title: 'The writing desk',
    targetId: 'writing-room-desk',
    requirements: [{ type: 'ALWAYS' }],
    action: {
      kind: 'SHOW_MESSAGE',
      message: 'You solved it, so it is yours to use. The first empty book is waiting.',
    },
  },
  {
    id: 'writing-room-bookshelf',
    type: 'OBJECT',
    trigger: 'TAP',
    title: 'Shelves of empty books',
    targetId: 'writing-room-bookshelf',
    requirements: [{ type: 'ALWAYS' }],
    action: {
      kind: 'SHOW_MESSAGE',
      message: 'Shelf after shelf of blank books, left ready by the old Storykeepers.',
    },
  },
  {
    id: 'writing-room-castle-exit',
    type: 'LOCATION',
    trigger: 'APPROACH',
    title: 'The path back into the castle',
    targetId: 'storykeeper-castle',
    requirements: [{ type: 'ALWAYS' }],
    action: { kind: 'NAVIGATE', to: 'world/storykeeper-castle' },
  },
];

/**
 * Bolt's Workshop's Phase 16 interactions (docs/ROADMAP.md Phase 16,
 * "Island Progression"): the fourth "story-dependent environmental change"
 * example, and the Robot Rescue decision's outcome (`docs/IMPLEMENTATION_STATUS.md`)
 * — a small payoff under a name distinct from "Robot Repair Reef", the
 * bigger, unapproved `docs/ROADMAP.md` "Post-MVP candidate" location. Every
 * entry is unconditionally available, since reaching the location at all
 * already requires `ROBOT_RESCUE_COMPLETE`.
 */
export const BOLTS_WORKSHOP_INTERACTIONS: WorldInteraction[] = [
  {
    id: 'meet-bolt',
    type: 'NPC',
    trigger: 'TAP',
    title: 'Bolt',
    targetId: 'bolt',
    requirements: [{ type: 'ALWAYS' }],
    action: {
      kind: 'SHOW_MESSAGE',
      message:
        'Bolt beeps a cheerful hello, wheels turning steadily, ready for a full day of work.',
    },
  },
  {
    id: 'bolts-workshop-toolbox',
    type: 'OBJECT',
    trigger: 'TAP',
    title: "Bolt's spare parts",
    targetId: 'bolts-workshop-toolbox',
    requirements: [{ type: 'ALWAYS' }],
    action: {
      kind: 'SHOW_MESSAGE',
      message: 'Neatly sorted bolts, wheels, and wires, ready for the next repair.',
    },
  },
  {
    id: 'bolts-workshop-harbor-exit',
    type: 'LOCATION',
    trigger: 'APPROACH',
    title: 'The path back to Welcome Harbor',
    targetId: 'welcome-harbor',
    requirements: [{ type: 'ALWAYS' }],
    action: { kind: 'NAVIGATE', to: 'world' },
  },
];
