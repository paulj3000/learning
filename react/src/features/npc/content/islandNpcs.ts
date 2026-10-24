/**
 * The island's authored cast (docs/ROADMAP.md Phase 23).
 *
 * These are the characters children already meet in the world today — each
 * `interactionId` resolves to an existing `type: 'NPC'` entry in
 * `src/features/island-map/worldObjects.ts`, so this phase gives existing
 * bodies a memory rather than adding new strangers to the island.
 *
 * Authoring conventions, enforced by `islandNpcs.test.ts`:
 * - dialogue nodes run most-specific first, ending in an `ALWAYS` greeting,
 *   so every child always has something to hear;
 * - copy is readable aloud and free of em dashes (CLAUDE.md section 13);
 * - only nodes that explicitly opt in via `narration` may ever be re-voiced
 *   by Chatty, and the opt-in carries the authored line itself as the
 *   fallback, so a failed or disabled call renders exactly this copy
 *   (`NpcConversation.tsx` is the caller, added at Phase 27).
 *
 * Pathfinders (ages 5-6) is the only fully authored band today, so this copy
 * targets it, matching the existing adventure content.
 */
import type { NpcDefinition } from '../types';

export const ISLAND_NPCS: NpcDefinition[] = [
  {
    id: 'pirate-pip',
    displayName: 'Pirate Pip',
    role: 'Shipyard foreman at Pirate Builder Bay. Offers the bridge repair quest.',
    homeLocationSlug: 'pirate-builder-bay',
    interactionId: 'meet-pirate-pip',
    schedule: [
      { timeOfDay: 'MORNING', locationSlug: 'pirate-builder-bay' },
      { timeOfDay: 'AFTERNOON', locationSlug: 'pirate-builder-bay' },
      { timeOfDay: 'EVENING', locationSlug: 'welcome-harbor' },
    ],
    dialogue: [
      {
        id: 'pip-bridge-thanks',
        conditions: [{ type: 'MEMORY_FLAG', flag: 'bridgeQuestCompleted', equals: true }],
        text: 'You fixed my bridge! Every crew in the bay walks across it now. Thank you, friend.',
        choices: [{ id: 'pip-thanks-bye', label: 'You are welcome!' }],
        awardsRelationshipPoints: 3,
        narration: {
          allowedTopic: 'thanking the child for repairing the harbor bridge',
          fallbackText:
            'You fixed my bridge! Every crew in the bay walks across it now. Thank you, friend.',
        },
      },
      {
        id: 'pip-bridge-offer',
        conditions: [{ type: 'RELATIONSHIP_AT_LEAST', level: 'ACQUAINTANCE' }],
        text: 'Good to see you again. The bridge is still broken. Would you help me count the planks?',
        choices: [
          { id: 'pip-accept-bridge', label: 'Yes, let us fix it!' },
          { id: 'pip-later-bridge', label: 'Maybe later.' },
        ],
        setsMemoryFlags: ['heardAboutBridge'],
        awardsRelationshipPoints: 2,
      },
      {
        id: 'pip-greeting',
        conditions: [{ type: 'ALWAYS' }],
        text: 'Ahoy! I am Pip, and this is my shipyard. There is always something to build here.',
        choices: [
          {
            id: 'pip-greeting-ask',
            label: 'What are you building?',
            nextNodeId: 'pip-bridge-story',
          },
          { id: 'pip-greeting-bye', label: 'Nice to meet you!' },
        ],
        setsMemoryFlags: ['metPip'],
        awardsRelationshipPoints: 1,
      },
      {
        /**
         * The only way a first conversation can set `heardAboutBridge`, which
         * the "repair-the-bridge" quest's opening objective waits on.
         *
         * Before this node existed, that flag was set only by
         * `pip-bridge-offer`, which is gated on being an ACQUAINTANCE, and the
         * only points Pip could award were the single point from his greeting.
         * A child could therefore never hear about the bridge, so the quest's
         * first stage could never complete. Nothing surfaced it until Phase 26.5
         * gave children a way to actually hold a conversation;
         * `reachableMemoryFlags` (../dialogue.ts) is now the standing check.
         */
        id: 'pip-bridge-story',
        followUpOnly: true,
        conditions: [{ type: 'ALWAYS' }],
        text: 'The bridge to the cove lost half its planks in the last storm. I need someone good at counting to help me build it back.',
        choices: [{ id: 'pip-bridge-story-bye', label: 'That sounds like a big job!' }],
        setsMemoryFlags: ['heardAboutBridge'],
        awardsRelationshipPoints: 1,
      },
    ],
    questOffers: [
      {
        questId: 'repair-the-bridge',
        summary: 'Help Pip count and measure planks to repair the harbor bridge.',
        conditions: [{ type: 'MEMORY_FLAG', flag: 'bridgeQuestCompleted', equals: false }],
      },
    ],
  },
  {
    id: 'keeper-quill',
    displayName: 'Keeper Quill',
    role: 'Storykeeper Castle librarian. Invites children to build a story together.',
    homeLocationSlug: 'storykeeper-castle',
    interactionId: 'talk-to-keeper-quill',
    schedule: [
      { timeOfDay: 'MORNING', locationSlug: 'storykeeper-castle' },
      { timeOfDay: 'AFTERNOON', locationSlug: 'castle-writing-room' },
      { timeOfDay: 'EVENING', locationSlug: 'storykeeper-castle' },
    ],
    dialogue: [
      {
        id: 'quill-returning-author',
        conditions: [{ type: 'MEMORY_FLAG', flag: 'finishedAStory', equals: true }],
        text: 'The story you made is on my shelf now. Shall we start a new one?',
        choices: [
          { id: 'quill-new-story', label: 'Yes, a new story!' },
          { id: 'quill-just-visiting', label: 'I am just visiting.' },
        ],
        awardsRelationshipPoints: 2,
      },
      {
        id: 'quill-greeting',
        conditions: [{ type: 'ALWAYS' }],
        text: 'Welcome to the castle library. Every story here is missing one thing: your ideas.',
        choices: [{ id: 'quill-greeting-bye', label: 'I have lots of ideas!' }],
        narration: {
          allowedTopic: 'welcoming the child into the castle library full of unfinished stories',
          fallbackText:
            'Welcome to the castle library. Every story here is missing one thing: your ideas.',
        },
        setsMemoryFlags: ['metQuill'],
        awardsRelationshipPoints: 1,
      },
    ],
    questOffers: [
      {
        questId: 'tell-a-story-together',
        summary: 'Build a story with Keeper Quill, one choice at a time.',
        conditions: [{ type: 'ALWAYS' }],
      },
    ],
  },
  {
    id: 'bolt',
    displayName: 'Bolt',
    role: "Tinkerer at Bolt's Workshop. Offers building and sorting work.",
    homeLocationSlug: 'bolts-workshop',
    interactionId: 'meet-bolt',
    schedule: [
      { timeOfDay: 'MORNING', locationSlug: 'bolts-workshop' },
      { timeOfDay: 'AFTERNOON', locationSlug: 'bolts-workshop' },
      { timeOfDay: 'EVENING', locationSlug: 'bolts-workshop' },
    ],
    dialogue: [
      {
        id: 'bolt-friend-greeting',
        conditions: [{ type: 'RELATIONSHIP_AT_LEAST', level: 'FRIEND' }],
        text: 'My favorite helper is back. I saved the interesting gears for you.',
        choices: [{ id: 'bolt-friend-bye', label: 'Show me!' }],
        awardsRelationshipPoints: 2,
      },
      {
        id: 'bolt-greeting',
        conditions: [{ type: 'ALWAYS' }],
        text: 'Careful where you step, there are springs everywhere. I am Bolt. I fix things.',
        choices: [{ id: 'bolt-greeting-bye', label: 'Hello, Bolt!' }],
        narration: {
          allowedTopic: 'introducing a cluttered workshop full of springs and gears',
          fallbackText:
            'Careful where you step, there are springs everywhere. I am Bolt. I fix things.',
        },
        setsMemoryFlags: ['metBolt'],
        awardsRelationshipPoints: 1,
      },
    ],
    questOffers: [
      {
        questId: 'sort-the-workshop',
        summary: 'Help Bolt sort the workshop parts into the right bins.',
        conditions: [{ type: 'MEMORY_FLAG', flag: 'metBolt', equals: true }],
      },
    ],
  },
  /*
    Ember (`docs/regions/dragons-sanctuary-roadmap.md` Phase 2, "Ember and the
    Sanctuary Introduction").

    She was authored for the one-screen arrival scene at the end of "The
    Dragon of Ember Mountain", with a single line thanking the child. The
    sanctuary is now an explorable region and she is its first dragon, so she
    gains the forge story - but she is deliberately *extended* rather than
    replaced, and a second `ember` definition written for the 3D region was
    deleted in favour of this one.

    That matters more than tidiness. The reconciliation document's section 6.3
    named a story collision: this location unlocks on
    `DRAGON_OF_EMBER_MOUNTAIN_COMPLETE`, at the end of a story about making a
    frightened dragon feel safe, while the roadmap's Phase 2 opens on a ruined
    sanctuary its dragons have abandoned. Her existing opening line - "You are
    the one who helped me. I remember." - already resolves it: she is not a
    stranger asking a favour, she is someone the child has already helped,
    showing them what she cannot fix alone. Two Embers would have thrown that
    away and given the child a dragon who had forgotten them.

    Phase 4 names five more dragons (Zephyr, Terra, Tide, Luna, the Elder).
    They are absent rather than stubbed: a dragon a child can walk up to and
    get nothing from is a worse promise than a roost that is visibly empty.

    Every line here is authored. `narration` hints mark what Chatty may
    re-voice, bounded by `allowedTopic` and anchored to `fallbackText`;
    nothing in this file lets a model decide what happens (ADR-002/003,
    CLAUDE.md section 7). Phase 5's contextual AI dialogue and Polly voice are
    not built, and Polly is still a pending provider decision.
  */
  {
    id: 'ember-dragon',
    displayName: 'Ember',
    role: "Young dragon at the Dragon's Sanctuary. Appears only after the Ember Mountain story, and asks the child to help relight the forge.",
    homeLocationSlug: 'dragons-sanctuary',
    interactionId: 'meet-ember-dragon',
    schedule: [
      { timeOfDay: 'MORNING', locationSlug: 'dragons-sanctuary' },
      { timeOfDay: 'AFTERNOON', locationSlug: 'dragons-sanctuary' },
      { timeOfDay: 'EVENING', locationSlug: 'dragons-sanctuary' },
    ],
    dialogue: [
      {
        /*
          The forge is lit. Ordered first so it wins selection over every other
          opening line: a child who fixed this place must never be greeted by a
          dragon who has not noticed.
        */
        id: 'ember-forge-thanks',
        conditions: [{ type: 'MEMORY_FLAG', flag: 'forgeLit', equals: true }],
        text: 'Look at it! Warm all the way to the back wall. I had almost stopped believing it would light again. Thank you.',
        choices: [{ id: 'ember-thanks-bye', label: 'It looks wonderful.' }],
        awardsRelationshipPoints: 3,
        narration: {
          allowedTopic: 'a dragon delighted that the sanctuary forge is burning again',
          fallbackText:
            'Look at it! Warm all the way to the back wall. I had almost stopped believing it would light again. Thank you.',
        },
      },
      {
        id: 'ember-runes-all-found',
        conditions: [{ type: 'MEMORY_FLAG', flag: 'allRunesFound', equals: true }],
        text: 'All three! You found all three. Take them to the hearth and set them in the sockets. I would do it myself, but my claws are far too big for the little slots.',
        choices: [{ id: 'ember-runes-bye', label: 'I will go and set them.' }],
        awardsRelationshipPoints: 2,
        narration: {
          allowedTopic: 'a dragon urging the child to set three found runes into the forge hearth',
          fallbackText:
            'All three! You found all three. Take them to the hearth and set them in the sockets. I would do it myself, but my claws are far too big for the little slots.',
        },
      },
      {
        id: 'ember-runes-hint',
        conditions: [{ type: 'MEMORY_FLAG', flag: 'heardAboutForge', equals: true }],
        text: 'Three fire runes, and they are not lost so much as scattered. One rolled behind the Keeper Lodge. One is down among the boulders. And one is out on the cold ledge where you can see the sky cliffs.',
        choices: [{ id: 'ember-hint-bye', label: 'I will look for them.' }],
        narration: {
          allowedTopic: 'a dragon describing where three fire runes came to rest around the valley',
          fallbackText:
            'Three fire runes, and they are not lost so much as scattered. One rolled behind the Keeper Lodge. One is down among the boulders. And one is out on the cold ledge where you can see the sky cliffs.',
        },
      },
      {
        /*
          Her original line, kept word for word. It is the child's welcome and
          the proof she remembers them, and it stays the greeting for a child
          who has not yet asked what happened here.
        */
        id: 'ember-greeting',
        conditions: [{ type: 'ALWAYS' }],
        text: 'You are the one who helped me. I remember. This sanctuary is yours to visit anytime.',
        choices: [
          {
            id: 'ember-greeting-ask',
            label: 'Why is it so empty?',
            nextNodeId: 'ember-forge-story',
          },
          { id: 'ember-greeting-bye', label: 'Thank you, Ember!' },
        ],
        setsMemoryFlags: ['metEmber'],
        awardsRelationshipPoints: 2,
      },
      {
        /*
          The follow-up to "Why is it so empty?". `followUpOnly` keeps it out
          of opening-line selection, and it is the un-gated route to
          `heardAboutForge`, so a child who has not built a relationship yet
          can still start the quest.
        */
        id: 'ember-forge-story',
        followUpOnly: true,
        conditions: [{ type: 'ALWAYS' }],
        text: 'The forge went out. That is what happened. Everything here ran on its warmth, and when it stopped, the hatchery went cold and the others left one by one. I cannot light it. It needs its three fire runes, and I cannot find them.',
        choices: [{ id: 'ember-story-bye', label: 'I could look for them.' }],
        setsMemoryFlags: ['heardAboutForge'],
        narration: {
          allowedTopic:
            'a dragon explaining that the sanctuary forge went out and needs three missing runes',
          fallbackText:
            'The forge went out. That is what happened. Everything here ran on its warmth, and when it stopped, the hatchery went cold and the others left one by one. I cannot light it. It needs its three fire runes, and I cannot find them.',
        },
      },
    ],
    /*
      No quest offer yet. `rekindle-the-forge` is not authored in
      `quests/content/`, and pointing an offer at a quest id that does not
      exist would open a conversation whose accept button leads nowhere. The
      quest is the next increment; the dialogue above already carries the
      story it will hang on.
    */
    questOffers: [],
  },
];
