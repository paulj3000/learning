import type { IslandLocation } from '../island/locations';
import type { NpcDefinition } from '../npc/types';
import type { QuestDefinition } from '../quests/types';
import type { CollectibleSet, ItemDefinition, RewardTable } from '../rewards/types';
import { HOME_WORLD_SLUG } from '../worlds/slugs';

/**
 * Firepeak Volcano's initial content (docs/FIREPEAK_VOLCANO_ROADMAP.md, ADR-047).
 *
 * Export-only, like `treasureRushContent.ts`: nothing here is loaded by the Amplify app, so it
 * changes nothing a child sees in an Amplify build. It reaches Django through the one content
 * import (`manage.py load_content`). After that import, Django is authoritative (ADR-047):
 * administrators edit these records in Django Admin as versioned content, and a later import
 * never overwrites a record they have published.
 *
 * The 3D Area's layout and its puzzles' first parameters are spatial and mechanical content,
 * authored in `lai/apps/regions/firepeak_seed.py` with the same ids and change keys as here.
 *
 * Ages: Pathfinders and Explorers only (FP-D2). Copy is written to be read aloud.
 */

export const FIREPEAK_PLACE_SLUG = 'firepeak-volcano';
export const FIREPEAK_QUEST_ID = 'the-volcano-awakens';
export const FIREPEAK_NPC_ID = 'professor-ember';

/** One world change per stage, recorded by that stage's puzzle (FP-D7). */
export const FIREPEAK_CHANGE_KEYS = {
  featuresObserved: 'FIREPEAK_FEATURES_OBSERVED',
  crossingRepaired: 'FIREPEAK_CROSSING_REPAIRED',
  steamRedirected: 'FIREPEAK_STEAM_REDIRECTED',
  crystalFound: 'FIREPEAK_HEART_CRYSTAL_FOUND',
  reportedToEmber: 'FIREPEAK_REPORTED_TO_EMBER',
  /** Recorded when the quest completes; the next adventure's future prerequisite (FP-D8). */
  awakened: 'FIREPEAK_VOLCANO_AWAKENED',
} as const;

const BANDS = ['PATHFINDER', 'EXPLORER'] as const;

export const FIREPEAK_LOCATIONS: readonly IslandLocation[] = [
  {
    slug: FIREPEAK_PLACE_SLUG,
    worldSlug: HOME_WORLD_SLUG,
    title: 'Firepeak Volcano',
    tagline: 'Explore a waking volcano with Professor Ember.',
    description:
      'A sleepy volcano that has started to rumble. Look closely, build a safe path, follow the steam, and learn how volcanoes and crystals form.',
    skills: ['Earth science', 'Spatial reasoning', 'Cause and effect', 'Problem solving'],
    decoration: 'Steam curls from the mountain. Professor Ember waits at the base camp.',
  },
];

export const FIREPEAK_NPCS: readonly NpcDefinition[] = [
  {
    id: FIREPEAK_NPC_ID,
    displayName: 'Professor Ember',
    role: 'Volcano researcher at Firepeak base camp. Offers The Volcano Awakens.',
    homeLocationSlug: FIREPEAK_PLACE_SLUG,
    interactionId: 'meet-professor-ember',
    schedule: [],
    dialogue: [
      {
        id: 'ember-thanks',
        conditions: [{ type: 'WORLD_CHANGE', changeKey: FIREPEAK_CHANGE_KEYS.awakened }],
        text: 'You did it, explorer! The volcano is calmer, and the first Heart Crystal fragment is safe with us.',
        choices: [{ id: 'ember-thanks-bye', label: 'That was amazing!' }],
      },
      {
        id: 'ember-crystal-found',
        conditions: [{ type: 'WORLD_CHANGE', changeKey: FIREPEAK_CHANGE_KEYS.crystalFound }],
        text: 'Is that glow what I think it is? Show me the crystal fragment!',
        choices: [{ id: 'ember-show-crystal', label: 'Here it is!' }],
      },
      {
        id: 'ember-greeting',
        conditions: [{ type: 'ALWAYS' }],
        text: 'Hello, explorer! I am Professor Ember. I study volcanoes, and this one has started to rumble.',
        choices: [
          {
            id: 'ember-greeting-ask',
            label: 'Why is it rumbling?',
            nextNodeId: 'ember-why-rumble',
          },
          { id: 'ember-greeting-bye', label: 'Let us find out!' },
        ],
      },
      {
        id: 'ember-why-rumble',
        conditions: [{ type: 'ALWAYS' }],
        followUpOnly: true,
        text: 'Deep below us there is hot melted rock called magma. When it moves, the ground shakes and steam comes out.',
        choices: [{ id: 'ember-why-bye', label: 'Let us take a look!' }],
      },
    ],
    questOffers: [
      {
        questId: FIREPEAK_QUEST_ID,
        summary: 'Help Professor Ember find out why Firepeak is waking up.',
        conditions: [{ type: 'ALWAYS' }],
      },
    ],
  },
];

const journal = (subject: 'EARTH_SCIENCE' | 'PROBLEM_SOLVING') => ({
  subject,
  questId: FIREPEAK_QUEST_ID,
});

export const FIREPEAK_DISCOVERY_JOURNAL_SET_ID = 'firepeak-discovery-journal';

export const FIREPEAK_ITEMS: readonly ItemDefinition[] = [
  {
    id: 'heart-crystal-fragment-1',
    displayName: 'First Heart Crystal Fragment',
    description: 'A warm, glowing crystal piece that shines with island magic.',
    category: 'KEEPSAKE',
    rarity: 'UNCOMMON',
  },
  {
    id: 'volcano-explorer-badge',
    displayName: 'Volcano Explorer Badge',
    description: 'For helping Professor Ember explore Firepeak Volcano.',
    category: 'KEEPSAKE',
    rarity: 'COMMON',
  },
  {
    id: 'journal-volcano-crater',
    displayName: 'Volcano crater',
    description: 'The bowl-shaped opening at the top of a volcano, where gas and lava come out.',
    category: 'COLLECTIBLE',
    rarity: 'COMMON',
    setId: FIREPEAK_DISCOVERY_JOURNAL_SET_ID,
    journal: journal('EARTH_SCIENCE'),
  },
  {
    id: 'journal-lava',
    displayName: 'Lava',
    description: 'Melted rock that comes out of the ground. Under the ground it is called magma.',
    category: 'COLLECTIBLE',
    rarity: 'COMMON',
    setId: FIREPEAK_DISCOVERY_JOURNAL_SET_ID,
    journal: journal('EARTH_SCIENCE'),
  },
  {
    id: 'journal-steam-vents',
    displayName: 'Steam vents',
    description: 'Cracks in the ground that let out steam, heated by magma deep below.',
    category: 'COLLECTIBLE',
    rarity: 'COMMON',
    setId: FIREPEAK_DISCOVERY_JOURNAL_SET_ID,
    journal: journal('EARTH_SCIENCE'),
  },
  {
    id: 'journal-volcanic-minerals',
    displayName: 'Volcanic minerals',
    description:
      'When hot, mineral-rich rock cools slowly, tiny pieces line up and grow into crystals.',
    category: 'COLLECTIBLE',
    rarity: 'COMMON',
    setId: FIREPEAK_DISCOVERY_JOURNAL_SET_ID,
    journal: journal('EARTH_SCIENCE'),
  },
  {
    id: 'journal-heart-crystal',
    displayName: 'Heart Crystal fragment',
    description:
      'A piece of the legendary Heart Crystal. Real crystals form in rock; this one also glows with island magic.',
    category: 'COLLECTIBLE',
    rarity: 'COMMON',
    setId: FIREPEAK_DISCOVERY_JOURNAL_SET_ID,
    journal: journal('PROBLEM_SOLVING'),
  },
];

export const FIREPEAK_COLLECTIBLE_SETS: readonly CollectibleSet[] = [
  {
    id: FIREPEAK_DISCOVERY_JOURNAL_SET_ID,
    displayName: 'Discovery Journal: Firepeak Volcano',
    completionMessage: 'Your Firepeak journal page is full of discoveries!',
    itemIds: [
      'journal-volcano-crater',
      'journal-lava',
      'journal-steam-vents',
      'journal-volcanic-minerals',
      'journal-heart-crystal',
    ],
  },
];

/** Each rule is named by its puzzle (`rewardRuleId`), which the server grants once. */
export const FIREPEAK_REWARD_RULES: RewardTable = [
  {
    id: 'reward-firepeak-telescope',
    trigger: { type: 'WORLD_CHANGE', changeKey: FIREPEAK_CHANGE_KEYS.featuresObserved },
    itemIds: ['journal-volcano-crater', 'journal-lava', 'journal-steam-vents'],
    message: 'Three new pages for your Discovery Journal: the crater, lava, and steam vents!',
  },
  {
    id: 'reward-firepeak-crystal',
    trigger: { type: 'WORLD_CHANGE', changeKey: FIREPEAK_CHANGE_KEYS.crystalFound },
    itemIds: ['heart-crystal-fragment-1', 'journal-volcanic-minerals', 'journal-heart-crystal'],
    message: 'You found the first Heart Crystal fragment!',
  },
  {
    id: 'reward-firepeak-complete',
    trigger: { type: 'WORLD_CHANGE', changeKey: FIREPEAK_CHANGE_KEYS.reportedToEmber },
    itemIds: ['volcano-explorer-badge'],
    message: 'You earned the Volcano Explorer Badge!',
  },
];

const stage = (
  id: string,
  title: string,
  changeKey: string,
  label: string,
  nextStageId?: string,
) => ({
  id,
  title,
  objectives: [{ id: `${id}-done`, label, kind: 'BUILD' as const, changeKey }],
  ...(nextStageId ? { nextStageId } : {}),
});

export const FIREPEAK_QUESTS: readonly QuestDefinition[] = [
  {
    id: FIREPEAK_QUEST_ID,
    title: 'The Volcano Awakens',
    summary: 'Help Professor Ember find out why Firepeak is waking up.',
    giverNpcId: FIREPEAK_NPC_ID,
    ageBands: [...BANDS],
    prerequisites: [{ type: 'ALWAYS' }],
    entryStageId: 'meet-professor-ember',
    stages: [
      stage(
        'meet-professor-ember',
        'Look through the telescope',
        FIREPEAK_CHANGE_KEYS.featuresObserved,
        'Find the crater, the lava flow and the steam vent',
        'repair-the-crossing',
      ),
      stage(
        'repair-the-crossing',
        'Repair the lava crossing',
        FIREPEAK_CHANGE_KEYS.crossingRepaired,
        'Put a stone that fits into each gap',
        'redirect-the-steam',
      ),
      stage(
        'redirect-the-steam',
        'Redirect the steam',
        FIREPEAK_CHANGE_KEYS.steamRedirected,
        'Send the steam out through the sky vent',
        'discover-the-crystal',
      ),
      stage(
        'discover-the-crystal',
        'Discover the Heart Crystal',
        FIREPEAK_CHANGE_KEYS.crystalFound,
        'Find the glowing crystal in the cavern',
        'return-to-ember',
      ),
      stage(
        'return-to-ember',
        'Return to Professor Ember',
        FIREPEAK_CHANGE_KEYS.reportedToEmber,
        'Show Professor Ember what you found',
      ),
    ],
    completion: {
      journalNote:
        'You helped Professor Ember explore Firepeak and found a Heart Crystal fragment.',
      worldChanges: [
        {
          locationSlug: FIREPEAK_PLACE_SLUG,
          changeType: 'UNLOCK',
          changeKey: FIREPEAK_CHANGE_KEYS.awakened,
        },
      ],
    },
  },
];

/** Added to the home Island's content pack in the export only (`build.ts`). */
export const FIREPEAK_PACK_ADDITIONS = {
  worldSlug: HOME_WORLD_SLUG,
  locationSlugs: [FIREPEAK_PLACE_SLUG],
  questIds: [FIREPEAK_QUEST_ID],
  npcIds: [FIREPEAK_NPC_ID],
  itemIds: FIREPEAK_ITEMS.map((item) => item.id),
  collectibleSetIds: [FIREPEAK_DISCOVERY_JOURNAL_SET_ID],
} as const;
