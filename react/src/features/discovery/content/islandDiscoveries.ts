import type { DiscoveryDefinition } from '../types';

/**
 * The island's authored secrets (docs/ROADMAP.md Phase 26).
 *
 * Five secrets across the four explorable regions Phases 10, 11, 13, and 14
 * built - one hidden cave, two secret passages, one locked door, and two
 * hidden objects - laid out as a single chain a child can follow without
 * ever being told to:
 *
 * ```text
 * Welcome Harbor   tide pool  ──────────────►  starts "The Quiet Places"
 * Pirate Builder Bay   tide tunnel  ────────►  driftwood key
 * Welcome Harbor   keeper's door  ◄───────────  (needs the driftwood key)
 * Wonderwild Forest   glowing moss  ─────────►  jar of glowing moss
 * Wonderwild Forest   glowworm cave  ◄────────  (needs the jar)
 * Storykeeper Castle   tapestry stair
 * ```
 *
 * Four authoring rules run through this file, all asserted in
 * `islandDiscoveries.test.ts`:
 *
 * 1. **Every requirement is producible by content that exists today.** A
 *    locked door whose key nothing grants is a dead end a child could walk
 *    up to forever - the same rule `islandQuests.ts` states for objectives.
 * 2. **Every gate has a visible source.** The thing that opens a secret is
 *    always found somewhere a child can reach *before* they reach the
 *    secret, so the island never demands backtracking through content they
 *    have not seen.
 * 3. **A locked secret still gives something.** Every `lockedMessage`
 *    describes what is actually there and leaves a thread to pull, rather
 *    than reporting a refusal.
 * 4. **No secret gates learning content.** Nothing here stands between a
 *    child and an adventure, a story, or a skill. Secrets are treasure,
 *    flavor, and one optional quest - CLAUDE.md pillar 7's calm engagement
 *    rules out putting a lesson behind a puzzle.
 *
 * Copy targets Pathfinders (ages 5-6), matching every other authored set.
 */
export const ISLAND_DISCOVERIES: DiscoveryDefinition[] = [
  // --- Welcome Harbor (Phase 10) ---
  {
    id: 'harbor-tide-pool',
    locationSlug: 'welcome-harbor',
    kind: 'HIDDEN_OBJECT',
    title: 'A tide pool behind the rocks',
    // Ungated and off the main path: the island's one entirely free secret,
    // so a child who has done nothing yet can still find something, and so
    // the optional quest below has an entrance that needs no key.
    requirements: [{ type: 'ALWAYS' }],
    lockedMessage: 'Water glints between the rocks down at the quiet end of the beach.',
    revealMessage:
      'Behind the rocks is a little pool left by the tide. A pale, round shell rests at the bottom, and you can keep it.',
    startsQuestId: 'the-quiet-places',
  },
  {
    id: 'harbor-keepers-door',
    locationSlug: 'welcome-harbor',
    kind: 'LOCKED_DOOR',
    title: "The harbor keeper's door",
    requirements: [{ type: 'ITEM_OWNED', itemId: 'driftwood-key' }],
    lockedMessage:
      'You knock, but nobody is home. The door is locked, and the keyhole is shaped like a little piece of driftwood.',
    revealMessage:
      'The driftwood key turns, and the door swings open. Inside is a tidy room full of lanterns, rope, and one shell that shows every color at once.',
    worldChange: {
      locationSlug: 'welcome-harbor',
      changeType: 'CREATE',
      changeKey: 'HARBOR_KEEPERS_DOOR_OPENED',
    },
  },

  // --- Pirate Builder Bay (Phase 11) ---
  {
    id: 'bay-tide-tunnel',
    locationSlug: 'pirate-builder-bay',
    kind: 'SECRET_PASSAGE',
    title: 'A low tunnel under the cliff',
    // The cove is only reachable across the repaired bridge, so the geometry
    // already gates this; the requirement is stated anyway so the "Things to
    // do here" list cannot offer a tunnel the child could not walk to.
    requirements: [{ type: 'WORLD_CHANGE_PRESENT', changeKey: 'BRIDGE_REPAIRED' }],
    lockedMessage:
      'Something dark and low sits at the back of the cove, on the far side of the broken bridge.',
    revealMessage:
      'A tunnel runs under the cliff, just tall enough for you. On a nail at the end hangs a key carved out of driftwood.',
    worldChange: {
      locationSlug: 'pirate-builder-bay',
      changeType: 'CREATE',
      changeKey: 'COVE_TIDE_TUNNEL_FOUND',
    },
  },

  // --- Wonderwild Forest (Phase 13) ---
  {
    id: 'wonderwild-glow-moss',
    locationSlug: 'wonderwild-forest',
    kind: 'HIDDEN_OBJECT',
    title: 'A patch of glowing moss',
    requirements: [{ type: 'ALWAYS' }],
    lockedMessage: 'Something under the ferns is giving off a faint green light.',
    revealMessage:
      'Under the ferns is a patch of moss that glows soft green. You scoop a little into a jar. It keeps glowing.',
  },
  {
    id: 'wonderwild-glowworm-cave',
    locationSlug: 'wonderwild-forest',
    kind: 'HIDDEN_CAVE',
    title: 'The glowworm cave',
    requirements: [{ type: 'ITEM_OWNED', itemId: 'glowing-moss-jar' }],
    lockedMessage:
      'A dark cave mouth in the hillside. It is too dark to see anything inside. You would need a light of your own.',
    revealMessage:
      'You hold up the jar of glowing moss and the whole cave answers. Thousands of tiny glowworms light up the ceiling like stars, and a clear crystal sits by your foot.',
    worldChange: {
      locationSlug: 'wonderwild-forest',
      changeType: 'CREATE',
      changeKey: 'GLOWWORM_CAVE_FOUND',
    },
  },

  // --- Storykeeper Castle (Phase 14) ---
  {
    id: 'castle-tapestry-stair',
    locationSlug: 'storykeeper-castle',
    kind: 'SECRET_PASSAGE',
    title: 'A stair behind the tapestry',
    requirements: [{ type: 'ALWAYS' }],
    lockedMessage:
      'One of the tapestries in the corner is moving, just a little, as if it breathes.',
    revealMessage:
      'Behind the tapestry a narrow stair spirals up to a tiny reading nook. There is a cushion, a window, and one storybook whose last page is still blank.',
    worldChange: {
      locationSlug: 'storykeeper-castle',
      changeType: 'CREATE',
      changeKey: 'CASTLE_READING_NOOK_FOUND',
    },
  },
];

export function findIslandDiscovery(discoveryId: string): DiscoveryDefinition | null {
  return ISLAND_DISCOVERIES.find((discovery) => discovery.id === discoveryId) ?? null;
}

/** Every authored discovery id. The closed vocabulary `parseKnownIds` validates against. */
export const ISLAND_DISCOVERY_IDS: readonly string[] = ISLAND_DISCOVERIES.map(
  (discovery) => discovery.id,
);
