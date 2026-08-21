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
 *   by Chatty.
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
        choices: [{ id: 'pip-greeting-bye', label: 'Nice to meet you!' }],
        setsMemoryFlags: ['metPip'],
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
  {
    id: 'ember-dragon',
    displayName: 'Ember',
    role: "Young dragon at the Dragon's Sanctuary. Appears only after the Ember Mountain story.",
    homeLocationSlug: 'dragons-sanctuary',
    interactionId: 'meet-ember-dragon',
    schedule: [
      { timeOfDay: 'MORNING', locationSlug: 'dragons-sanctuary' },
      { timeOfDay: 'AFTERNOON', locationSlug: 'dragons-sanctuary' },
      { timeOfDay: 'EVENING', locationSlug: 'dragons-sanctuary' },
    ],
    dialogue: [
      {
        id: 'ember-greeting',
        conditions: [{ type: 'ALWAYS' }],
        text: 'You are the one who helped me. I remember. This sanctuary is yours to visit anytime.',
        choices: [{ id: 'ember-greeting-bye', label: 'Thank you, Ember!' }],
        setsMemoryFlags: ['metEmber'],
        awardsRelationshipPoints: 2,
      },
    ],
    questOffers: [],
  },
];

export function findNpc(npcId: string): NpcDefinition | null {
  return ISLAND_NPCS.find((npc) => npc.id === npcId) ?? null;
}
