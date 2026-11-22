import type { IslandLocation } from '../island/locations';
import type { DialogueNode, NpcCondition, NpcDefinition } from '../npc/types';
import type { QuestDefinition, QuestObjective } from '../quests/types';
import type {
  CollectibleSet,
  ItemDefinition,
  JournalSubject,
  RewardRule,
  RewardTable,
} from '../rewards/types';
import type { WorldDefinition } from '../worlds/types';

/**
 * North Pole: The Missing Christmas Star (docs/north-pole/NORTH_POLE_DESIGN.md, ADR-080).
 *
 * Export-only, like `firepeakContent.ts`: the Amplify app loads none of it. It reaches Django
 * through the one content import (`manage.py load_content`); after that Django is authoritative.
 * The 3D Area's layout, puzzles, chests and pickups are spatial content authored elsewhere with the
 * same ids and world change keys as here (contract sections 4 and 5).
 *
 * All three age bands. Copy is written to be read aloud, has no em dashes, and keeps science real
 * ("Real reindeer...") while the Christmas Star is island magic.
 */

export const NORTH_POLE_WORLD_SLUG = 'north-pole';
export const NORTH_POLE_PLACE_SLUG = 'north-pole-village';

type Band = 'SPROUT' | 'PATHFINDER' | 'EXPLORER';
const ALL_BANDS: Band[] = ['SPROUT', 'PATHFINDER', 'EXPLORER'];

/** World change keys (contract section 5). Every one is recorded at `north-pole-village`. */
const k = (name: string) => `NORTH_POLE_${name}`;

export const NORTH_POLE_KEYS = {
  welcomeLooked: k('WELCOME_LOOKED'),
  workshopToysCounted: k('WORKSHOP_TOYS_COUNTED'),
  workshopPresentsSorted: k('WORKSHOP_PRESENTS_SORTED'),
  workshopPatternFixed: k('WORKSHOP_PATTERN_FIXED'),
  workshopGiftsChecked: k('WORKSHOP_GIFTS_CHECKED'),
  workshopRestored: k('WORKSHOP_RESTORED'),
  forestSequenceDone: k('FOREST_SEQUENCE_DONE'),
  forestSignsRead: k('FOREST_SIGNS_READ'),
  forestDone: k('FOREST_DONE'),
  lakeBridge: k('LAKE_BRIDGE'),
  lakeOrdered: k('LAKE_ORDERED'),
  lakeDone: k('LAKE_DONE'),
  stablesFactsLearned: k('STABLES_FACTS_LEARNED'),
  stablesTracksFollowed: k('STABLES_TRACKS_FOLLOWED'),
  stablesSuppliesFound: k('STABLES_SUPPLIES_FOUND'),
  snowballFound: k('SNOWBALL_FOUND'),
  snowballHome: k('SNOWBALL_HOME'),
  gingerShapesMatched: k('GINGER_SHAPES_MATCHED'),
  gingerSymmetryDone: k('GINGER_SYMMETRY_DONE'),
  gingerRecipeRead: k('GINGER_RECIPE_READ'),
  gingerMeasured: k('GINGER_MEASURED'),
  gingerRepaired: k('GINGER_REPAIRED'),
  mountainBridgeOne: k('MOUNTAIN_BRIDGE_ONE'),
  mountainBridgeTwo: k('MOUNTAIN_BRIDGE_TWO'),
  mountainSummit: k('MOUNTAIN_SUMMIT'),
  obsStarsLearned: k('OBS_STARS_LEARNED'),
  obsConstellationFound: k('OBS_CONSTELLATION_FOUND'),
  obsSequenceDone: k('OBS_SEQUENCE_DONE'),
  fragmentsPlaced: k('FRAGMENTS_PLACED'),
  starRestored: k('STAR_RESTORED'),
  christmasEve: k('CHRISTMAS_EVE'),
  adventureComplete: k('ADVENTURE_COMPLETE'),
} as const;

export const NORTH_POLE_ZONES = [
  'VILLAGE',
  'WORKSHOP',
  'FOREST',
  'LAKE',
  'STABLES',
  'GINGERBREAD',
  'MOUNTAIN',
] as const;

const zoneName: Record<(typeof NORTH_POLE_ZONES)[number], string> = {
  VILLAGE: 'village',
  WORKSHOP: 'workshop',
  FOREST: 'forest',
  LAKE: 'lake',
  STABLES: 'stables',
  GINGERBREAD: 'gingerbread',
  MOUNTAIN: 'mountain',
};

const numbered = (count: number, pad = false) =>
  Array.from({ length: count }, (_, i) => (pad ? String(i + 1).padStart(2, '0') : String(i + 1)));

// ---------------------------------------------------------------------------------------------
// Realm and Place
// ---------------------------------------------------------------------------------------------

export const NORTH_POLE_QUEST_IDS = [
  'np-q01-welcome',
  'np-q02-toy-workshop',
  'np-q03-candy-cane-forest',
  'np-q04-frozen-lake',
  'np-q05-missing-reindeer',
  'np-q06-gingerbread-mystery',
  'np-q07-snowflake-mountain',
  'np-q08-restore-the-star',
  'np-q09-christmas-eve',
] as const;

export const NORTH_POLE_NPC_IDS = [
  'santa-claus',
  'mrs-claus',
  'jingle',
  'tinker',
  'peppermint',
  'frosty',
  'noel',
  'ginger',
  'polaris',
  'snowball',
] as const;

export const NORTH_POLE_WORLD: WorldDefinition = {
  slug: NORTH_POLE_WORLD_SLUG,
  title: 'North Pole',
  tagline: 'A snowy village where a missing star needs your help.',
  description:
    'A winter village of elves, reindeer, and gingerbread houses. A storm has scattered the Christmas Star, and friends along the way need help to find its seven pieces.',
  supportedAgeBands: [...ALL_BANDS],
};

export const NORTH_POLE_LOCATIONS: readonly IslandLocation[] = [
  {
    slug: NORTH_POLE_PLACE_SLUG,
    worldSlug: NORTH_POLE_WORLD_SLUG,
    title: 'North Pole Village',
    tagline: 'Find the pieces of the Christmas Star.',
    description:
      'A snowy village with a toy workshop, a candy cane forest, a frozen lake, reindeer stables, a gingerbread village, a mountain, and a star observatory.',
    skills: ['Counting', 'Patterns', 'Reading', 'Shapes', 'Winter science'],
    subjectAreas: ['MATH', 'SCIENCE', 'READING'],
    decoration: 'Snow drifts down over the village. Jingle waves from Santa’s Landing.',
  },
];

// ---------------------------------------------------------------------------------------------
// Items, sets and reward rules
// ---------------------------------------------------------------------------------------------

const SET_FRAGMENTS = 'np-set-star-fragments';
const SET_SNOWFLAKES = 'np-set-snowflakes';
const SET_CANDY_CANES = 'np-set-candy-canes';
const SET_ORNAMENTS = 'np-set-ornaments';
const SET_COOKIES = 'np-set-cookies';
const SET_GOLDEN_BELLS = 'np-set-golden-bells';

const journalOf = (subject: JournalSubject, questId: string) => ({ subject, questId });

const FRAGMENT_NAMES: Record<(typeof NORTH_POLE_ZONES)[number], string> = {
  VILLAGE: 'village',
  WORKSHOP: 'workshop',
  FOREST: 'forest',
  LAKE: 'lake',
  STABLES: 'stables',
  GINGERBREAD: 'gingerbread village',
  MOUNTAIN: 'mountain',
};

const fragmentItems: ItemDefinition[] = NORTH_POLE_ZONES.map((zone, i) => ({
  id: `np-star-fragment-${zoneName[zone]}`,
  displayName: `Star piece ${i + 1}: ${FRAGMENT_NAMES[zone]}`,
  description: `A glowing piece of the Christmas Star, found in the ${FRAGMENT_NAMES[zone]}.`,
  category: 'QUEST_ITEM',
  rarity: 'UNCOMMON',
  setId: SET_FRAGMENTS,
}));

const snowflakeItems: ItemDefinition[] = numbered(10, true).map((n) => ({
  id: `np-snowflake-${n}`,
  displayName: `Snowflake ${Number(n)}`,
  description: 'A tiny, sparkling snowflake. Real snowflakes have six sides.',
  category: 'COLLECTIBLE',
  rarity: 'COMMON',
  setId: SET_SNOWFLAKES,
}));

const candyCaneItems: ItemDefinition[] = numbered(5).map((n) => ({
  id: `np-candy-cane-${n}`,
  displayName: `Candy cane ${n}`,
  description: 'A red and white striped candy cane from the forest.',
  category: 'COLLECTIBLE',
  rarity: 'COMMON',
  setId: SET_CANDY_CANES,
}));

const ornamentItems: ItemDefinition[] = numbered(5).map((n) => ({
  id: `np-ornament-${n}`,
  displayName: `Shiny ornament ${n}`,
  description: 'A shiny ornament that was tucked away in a hiding place.',
  category: 'COLLECTIBLE',
  rarity: 'UNCOMMON',
  setId: SET_ORNAMENTS,
  hidden: true,
}));

const cookieItems: ItemDefinition[] = numbered(3).map((n) => ({
  id: `np-cookie-${n}`,
  displayName: `Gingerbread cookie ${n}`,
  description: 'A warm, spicy gingerbread cookie.',
  category: 'COLLECTIBLE',
  rarity: 'COMMON',
  setId: SET_COOKIES,
}));

const goldenBellItems: ItemDefinition[] = numbered(3).map((n) => ({
  id: `np-golden-bell-${n}`,
  displayName: `Golden bell ${n}`,
  description: 'A little golden bell from the hidden ice cave. It jingles softly.',
  category: 'COLLECTIBLE',
  rarity: 'RARE',
  setId: SET_GOLDEN_BELLS,
  hidden: true,
}));

export const NORTH_POLE_ITEMS: readonly ItemDefinition[] = [
  ...fragmentItems,
  ...snowflakeItems,
  ...candyCaneItems,
  ...ornamentItems,
  ...cookieItems,
  ...goldenBellItems,
  {
    id: 'np-snowball-collar',
    displayName: 'Snowball’s collar',
    description: 'A little collar with a bell, found in Pine Hollow. Noel will want to see it.',
    category: 'QUEST_ITEM',
    rarity: 'COMMON',
  },
  {
    id: 'np-reindeer-token',
    displayName: 'Reindeer token',
    description: 'A wooden token from Noel, for bringing Snowball safely home.',
    category: 'KEEPSAKE',
    rarity: 'UNCOMMON',
  },
  {
    id: 'np-gift-wrapped-present',
    displayName: 'Gift wrapped present',
    description: 'A present wrapped in shiny paper and tied with a bow.',
    category: 'COLLECTIBLE',
    rarity: 'COMMON',
  },
  {
    id: 'np-badge-north-pole-explorer',
    displayName: 'North Pole Explorer Badge',
    description: 'For looking all around the North Pole village.',
    category: 'KEEPSAKE',
    rarity: 'COMMON',
  },
  {
    id: 'np-badge-master-toymaker',
    displayName: 'Master Toymaker Badge',
    description: 'For helping Tinker fix the toy workshop machine.',
    category: 'KEEPSAKE',
    rarity: 'COMMON',
  },
  {
    id: 'np-badge-candy-cane-trailblazer',
    displayName: 'Candy Cane Trailblazer Badge',
    description: 'For finding the way through the candy cane forest.',
    category: 'KEEPSAKE',
    rarity: 'COMMON',
  },
  {
    id: 'np-badge-ice-hopper',
    displayName: 'Ice Hopper Badge',
    description: 'For raising the ice bridge across the frozen lake.',
    category: 'KEEPSAKE',
    rarity: 'COMMON',
  },
  {
    id: 'np-badge-reindeer-rescuer',
    displayName: 'Reindeer Rescuer Badge',
    description: 'For helping Snowball the reindeer calf get home.',
    category: 'KEEPSAKE',
    rarity: 'UNCOMMON',
  },
  {
    id: 'np-badge-gingerbread-builder',
    displayName: 'Gingerbread Builder Badge',
    description: 'For mending the gingerbread village wall.',
    category: 'KEEPSAKE',
    rarity: 'COMMON',
  },
  {
    id: 'np-badge-snowflake-mountain-champion',
    displayName: 'Snowflake Mountain Champion Badge',
    description: 'For reaching the top of Snowflake Mountain.',
    category: 'KEEPSAKE',
    rarity: 'UNCOMMON',
  },
  {
    id: 'np-badge-santas-helper',
    displayName: 'Santa’s Helper Badge',
    description: 'For helping the whole North Pole get ready for Christmas Eve.',
    category: 'KEEPSAKE',
    rarity: 'UNCOMMON',
  },
  {
    id: 'np-trophy-christmas-star',
    displayName: 'Christmas Star Trophy',
    description: 'A tiny shining star, for putting the Christmas Star back together.',
    category: 'KEEPSAKE',
    rarity: 'RARE',
  },
  {
    id: 'np-cosmetic-santa-hat',
    displayName: 'Santa hat',
    description: 'A soft red hat with a white fluffy edge.',
    category: 'COSMETIC',
    rarity: 'UNCOMMON',
    cosmeticSlot: 'HAT',
  },
  {
    id: 'np-cosmetic-elf-backpack',
    displayName: 'Elf backpack',
    description: 'A small green backpack, just right for an elf helper.',
    category: 'COSMETIC',
    rarity: 'UNCOMMON',
    cosmeticSlot: 'BACKPACK',
  },
  {
    id: 'np-cosmetic-snowflake-scarf',
    displayName: 'Snowflake scarf',
    description: 'A cosy blue scarf covered in snowflakes.',
    category: 'COSMETIC',
    rarity: 'RARE',
    cosmeticSlot: 'ACCESSORY',
  },
  {
    id: 'np-journal-snow-and-ice',
    displayName: 'Snow and ice',
    description:
      'Snow is made of tiny ice crystals. Water freezes into ice when it gets cold enough.',
    category: 'COLLECTIBLE',
    rarity: 'COMMON',
    journal: journalOf('EARTH_SCIENCE', 'np-q04-frozen-lake'),
  },
  {
    id: 'np-journal-water-states',
    displayName: 'Three states of water',
    description: 'Water can be ice, liquid water, or a gas called water vapour.',
    category: 'COLLECTIBLE',
    rarity: 'COMMON',
    journal: journalOf('EARTH_SCIENCE', 'np-q07-snowflake-mountain'),
  },
  {
    id: 'np-journal-stars',
    displayName: 'Stars',
    description:
      'Real stars are huge balls of hot gas, very far away. Our Sun is a star, and the Christmas Star is island magic.',
    category: 'COLLECTIBLE',
    rarity: 'COMMON',
    journal: journalOf('EARTH_SCIENCE', 'np-q08-restore-the-star'),
  },
  {
    id: 'np-journal-patterns',
    displayName: 'Patterns',
    description: 'A pattern repeats. If you find the rule, you can tell what comes next.',
    category: 'COLLECTIBLE',
    rarity: 'COMMON',
    journal: journalOf('MATHEMATICS', 'np-q02-toy-workshop'),
  },
];

export const NORTH_POLE_COLLECTIBLE_SETS: readonly CollectibleSet[] = [
  {
    id: SET_FRAGMENTS,
    displayName: 'Christmas Star pieces',
    completionMessage: 'You found all seven pieces of the Christmas Star!',
    itemIds: fragmentItems.map((i) => i.id),
  },
  {
    id: SET_SNOWFLAKES,
    displayName: 'Snowflakes',
    completionMessage: 'Ten sparkling snowflakes! Here is a snowflake scarf.',
    itemIds: snowflakeItems.map((i) => i.id),
    completionItemId: 'np-cosmetic-snowflake-scarf',
  },
  {
    id: SET_CANDY_CANES,
    displayName: 'Candy canes',
    completionMessage: 'You found every candy cane in the forest!',
    itemIds: candyCaneItems.map((i) => i.id),
  },
  {
    id: SET_ORNAMENTS,
    displayName: 'Shiny ornaments',
    completionMessage: 'Every hidden ornament is found!',
    itemIds: ornamentItems.map((i) => i.id),
  },
  {
    id: SET_COOKIES,
    displayName: 'Gingerbread cookies',
    completionMessage: 'All three cookies are yours!',
    itemIds: cookieItems.map((i) => i.id),
  },
  {
    id: SET_GOLDEN_BELLS,
    displayName: 'Golden bells',
    completionMessage: 'All three golden bells are jingling together!',
    itemIds: goldenBellItems.map((i) => i.id),
  },
];

const worldChangeRule = (
  id: string,
  changeKey: string,
  itemIds: string[],
  message: string,
): RewardRule => ({ id, trigger: { type: 'WORLD_CHANGE', changeKey }, itemIds, message });

/** One rule per pickup: the pickup records its key, this rule grants its item (once). */
const pickupRules: RewardRule[] = [
  ...NORTH_POLE_ZONES.map((zone) =>
    worldChangeRule(
      `np-rule-fragment-${zoneName[zone]}`,
      k(`FRAGMENT_${zone}`),
      [`np-star-fragment-${zoneName[zone]}`],
      'You found a piece of the Christmas Star!',
    ),
  ),
  ...numbered(10, true).map((n) =>
    worldChangeRule(
      `np-rule-snowflake-${n}`,
      k(`SNOWFLAKE_${n}`),
      [`np-snowflake-${n}`],
      'A sparkling snowflake for your collection!',
    ),
  ),
  ...numbered(5).map((n) =>
    worldChangeRule(
      `np-rule-candy-cane-${n}`,
      k(`CANDY_CANE_${n}`),
      [`np-candy-cane-${n}`],
      'A candy cane for your collection!',
    ),
  ),
  ...numbered(5).map((n) =>
    worldChangeRule(
      `np-rule-ornament-${n}`,
      k(`ORNAMENT_${n}`),
      [`np-ornament-${n}`],
      'You found a hidden ornament!',
    ),
  ),
  ...numbered(3).map((n) =>
    worldChangeRule(
      `np-rule-cookie-${n}`,
      k(`COOKIE_${n}`),
      [`np-cookie-${n}`],
      'A gingerbread cookie for your collection!',
    ),
  ),
  ...numbered(3).map((n) =>
    worldChangeRule(
      `np-rule-golden-bell-${n}`,
      k(`GOLDEN_BELL_${n}`),
      [`np-golden-bell-${n}`],
      'You found a golden bell!',
    ),
  ),
  worldChangeRule(
    'np-rule-snowball-found',
    NORTH_POLE_KEYS.snowballFound,
    ['np-snowball-collar'],
    'You found Snowball’s collar. Take it to Noel.',
  ),
];

/** Quest and puzzle rewards. The two mountain lever chests have no rule (the bridge is the reward). */
const storyRules: RewardRule[] = [
  worldChangeRule(
    'np-rule-welcome',
    NORTH_POLE_KEYS.welcomeLooked,
    ['np-badge-north-pole-explorer'],
    'You earned the North Pole Explorer Badge!',
  ),
  worldChangeRule(
    'np-rule-workshop-gifts',
    NORTH_POLE_KEYS.workshopGiftsChecked,
    ['np-gift-wrapped-present'],
    'A gift wrapped present for you!',
  ),
  worldChangeRule(
    'np-rule-workshop',
    NORTH_POLE_KEYS.workshopRestored,
    ['np-badge-master-toymaker', 'np-journal-patterns'],
    'You earned the Master Toymaker Badge and a new journal page about patterns!',
  ),
  worldChangeRule(
    'np-rule-forest',
    NORTH_POLE_KEYS.forestDone,
    ['np-badge-candy-cane-trailblazer'],
    'You earned the Candy Cane Trailblazer Badge!',
  ),
  worldChangeRule(
    'np-rule-lake',
    NORTH_POLE_KEYS.lakeDone,
    ['np-badge-ice-hopper', 'np-journal-snow-and-ice'],
    'You earned the Ice Hopper Badge and a journal page about snow and ice!',
  ),
  worldChangeRule(
    'np-rule-reindeer',
    NORTH_POLE_KEYS.snowballHome,
    ['np-badge-reindeer-rescuer', 'np-reindeer-token'],
    'Snowball is home! You earned the Reindeer Rescuer Badge and a reindeer token.',
  ),
  worldChangeRule(
    'np-rule-gingerbread',
    NORTH_POLE_KEYS.gingerRepaired,
    ['np-badge-gingerbread-builder'],
    'You earned the Gingerbread Builder Badge!',
  ),
  worldChangeRule(
    'np-rule-mountain',
    NORTH_POLE_KEYS.mountainSummit,
    ['np-badge-snowflake-mountain-champion', 'np-journal-water-states'],
    'You reached the top! You earned the Snowflake Mountain Champion Badge and a journal page about water.',
  ),
  worldChangeRule(
    'np-rule-star',
    NORTH_POLE_KEYS.starRestored,
    ['np-trophy-christmas-star', 'np-journal-stars'],
    'The Christmas Star shines again! You earned the Christmas Star Trophy and a journal page about stars.',
  ),
  worldChangeRule(
    'np-rule-christmas-eve',
    NORTH_POLE_KEYS.christmasEve,
    ['np-badge-santas-helper', 'np-cosmetic-santa-hat', 'np-cosmetic-elf-backpack'],
    'You earned the Santa’s Helper Badge, a Santa hat, and an elf backpack!',
  ),
];

export const NORTH_POLE_REWARD_RULES: RewardTable = [...storyRules, ...pickupRules];

// ---------------------------------------------------------------------------------------------
// Quests (contract section 6)
// ---------------------------------------------------------------------------------------------

interface QuestSpec {
  id: (typeof NORTH_POLE_QUEST_IDS)[number];
  title: string;
  summary: string;
  giver: string;
  prerequisite: string | null;
  objectives: ReadonlyArray<readonly [changeKey: string, label: string]>;
  journalNote: string;
  extraCompletionKeys?: readonly string[];
}

const frag = (zone: (typeof NORTH_POLE_ZONES)[number]) => k(`FRAGMENT_${zone}`);

const QUEST_SPECS: readonly QuestSpec[] = [
  {
    id: 'np-q01-welcome',
    title: 'Welcome to the North Pole',
    summary: 'Look around Santa’s Landing with Jingle and find the first star piece.',
    giver: 'jingle',
    prerequisite: null,
    objectives: [
      [NORTH_POLE_KEYS.welcomeLooked, 'Look around the village'],
      [frag('VILLAGE'), 'Find the star piece by the steps'],
    ],
    journalNote: 'You met Jingle, looked around the village, and found the first star piece.',
  },
  {
    id: 'np-q02-toy-workshop',
    title: 'Trouble in the Toy Workshop',
    summary: 'Help Tinker fix the toy machine.',
    giver: 'tinker',
    prerequisite: NORTH_POLE_KEYS.welcomeLooked,
    objectives: [
      [NORTH_POLE_KEYS.workshopToysCounted, 'Count the toys'],
      [NORTH_POLE_KEYS.workshopPresentsSorted, 'Sort the presents'],
      [NORTH_POLE_KEYS.workshopPatternFixed, 'Fix the pattern on the belt'],
      [NORTH_POLE_KEYS.workshopGiftsChecked, 'Open the gift chest'],
      [NORTH_POLE_KEYS.workshopRestored, 'Build the toy to wake the machine'],
      [frag('WORKSHOP'), 'Find the star piece on the high shelf'],
    ],
    journalNote: 'You helped Tinker fix the toy machine and found a star piece.',
  },
  {
    id: 'np-q03-candy-cane-forest',
    title: 'Candy Cane Forest',
    summary: 'Help Peppermint find the path through the candy cane forest.',
    giver: 'peppermint',
    prerequisite: NORTH_POLE_KEYS.workshopRestored,
    objectives: [
      [NORTH_POLE_KEYS.forestSequenceDone, 'Follow the number path'],
      [NORTH_POLE_KEYS.forestSignsRead, 'Read the signs'],
      [NORTH_POLE_KEYS.forestDone, 'Put the candy stripes in order'],
      [frag('FOREST'), 'Find the star piece at the end of the stones'],
    ],
    journalNote: 'You helped Peppermint clear the forest path and found a star piece.',
  },
  {
    id: 'np-q04-frozen-lake',
    title: 'The Frozen Lake',
    summary: 'Help Frosty raise the ice bridge across the lake.',
    giver: 'frosty',
    prerequisite: NORTH_POLE_KEYS.forestDone,
    objectives: [
      [NORTH_POLE_KEYS.lakeBridge, 'Raise the ice bridge'],
      [NORTH_POLE_KEYS.lakeOrdered, 'Put the ice floes in order'],
      [NORTH_POLE_KEYS.lakeDone, 'Match the shapes on the ice'],
      [frag('LAKE'), 'Find the star piece on the far island'],
    ],
    journalNote: 'You helped Frosty with the frozen lake and found a star piece.',
  },
  {
    id: 'np-q05-missing-reindeer',
    title: 'The Missing Reindeer',
    summary: 'Help Noel find Snowball the reindeer calf.',
    giver: 'noel',
    prerequisite: NORTH_POLE_KEYS.lakeDone,
    objectives: [
      [NORTH_POLE_KEYS.stablesFactsLearned, 'Learn about reindeer'],
      [NORTH_POLE_KEYS.stablesTracksFollowed, 'Follow the footprints'],
      [NORTH_POLE_KEYS.stablesSuppliesFound, 'Find what Snowball needs'],
      [NORTH_POLE_KEYS.snowballFound, 'Find Snowball in Pine Hollow'],
      [NORTH_POLE_KEYS.snowballHome, 'Bring the collar back to Noel'],
      [frag('STABLES'), 'Find the star piece beside Snowball'],
    ],
    journalNote: 'You helped Noel bring Snowball home and found a star piece.',
  },
  {
    id: 'np-q06-gingerbread-mystery',
    title: 'The Gingerbread Mystery',
    summary: 'Help Ginger mend the gingerbread village wall.',
    giver: 'ginger',
    prerequisite: NORTH_POLE_KEYS.snowballHome,
    objectives: [
      [NORTH_POLE_KEYS.gingerShapesMatched, 'Match the shapes'],
      [NORTH_POLE_KEYS.gingerSymmetryDone, 'Finish the matching window'],
      [NORTH_POLE_KEYS.gingerRecipeRead, 'Read Mrs. Claus’s recipe'],
      [NORTH_POLE_KEYS.gingerMeasured, 'Measure the cookie beams'],
      [NORTH_POLE_KEYS.gingerRepaired, 'Mend the gingerbread wall'],
      [frag('GINGERBREAD'), 'Find the star piece on the rooftop'],
    ],
    journalNote: 'You helped Ginger and Mrs. Claus mend the village and found a star piece.',
  },
  {
    id: 'np-q07-snowflake-mountain',
    title: 'Snowflake Mountain',
    summary: 'Climb Snowflake Mountain with Jingle.',
    giver: 'jingle',
    prerequisite: NORTH_POLE_KEYS.gingerRepaired,
    objectives: [
      [NORTH_POLE_KEYS.mountainBridgeOne, 'Raise the first bridge'],
      [NORTH_POLE_KEYS.mountainBridgeTwo, 'Raise the second bridge'],
      [NORTH_POLE_KEYS.mountainSummit, 'Reach the top of the mountain'],
      [frag('MOUNTAIN'), 'Find the star piece at the top'],
    ],
    journalNote: 'You climbed Snowflake Mountain and found the last star piece.',
  },
  {
    id: 'np-q08-restore-the-star',
    title: 'Restore the Christmas Star',
    summary: 'Help Polaris put the seven star pieces back together.',
    giver: 'polaris',
    prerequisite: NORTH_POLE_KEYS.mountainSummit,
    objectives: [
      [NORTH_POLE_KEYS.obsStarsLearned, 'Learn about stars'],
      [NORTH_POLE_KEYS.obsConstellationFound, 'Find the constellation'],
      [NORTH_POLE_KEYS.obsSequenceDone, 'Put the night sky in order'],
      [NORTH_POLE_KEYS.fragmentsPlaced, 'Place the seven star pieces'],
      [NORTH_POLE_KEYS.starRestored, 'Make the star shine'],
    ],
    journalNote: 'You helped Polaris put the Christmas Star back together.',
  },
  {
    id: 'np-q09-christmas-eve',
    title: 'Christmas Eve Celebration',
    summary: 'Ring the sleigh bell with Santa.',
    giver: 'santa-claus',
    prerequisite: NORTH_POLE_KEYS.starRestored,
    objectives: [[NORTH_POLE_KEYS.christmasEve, 'Ring Santa’s sleigh bell']],
    journalNote: 'You rang the sleigh bell, and the whole North Pole celebrated with you.',
    extraCompletionKeys: [NORTH_POLE_KEYS.adventureComplete],
  },
];

function questFrom(spec: QuestSpec): QuestDefinition {
  const n = spec.id.slice(4, 6);
  const objectives: QuestObjective[] = spec.objectives.map(([changeKey, label], i) => ({
    id: `${spec.id}-obj-${i + 1}`,
    label,
    kind: 'BUILD' as const,
    changeKey,
  }));
  return {
    id: spec.id,
    title: spec.title,
    summary: spec.summary,
    giverNpcId: spec.giver,
    ageBands: [...ALL_BANDS],
    prerequisites: spec.prerequisite
      ? [{ type: 'WORLD_CHANGE', changeKey: spec.prerequisite }]
      : [{ type: 'ALWAYS' }],
    entryStageId: `${spec.id}-stage`,
    stages: [{ id: `${spec.id}-stage`, title: spec.title, objectives }],
    completion: {
      journalNote: spec.journalNote,
      worldChanges: [
        {
          locationSlug: NORTH_POLE_PLACE_SLUG,
          changeType: 'UNLOCK',
          changeKey: k(`Q${n}_COMPLETE`),
        },
        ...(spec.extraCompletionKeys ?? []).map((changeKey) => ({
          locationSlug: NORTH_POLE_PLACE_SLUG,
          changeType: 'UNLOCK',
          changeKey,
        })),
      ],
    },
  };
}

export const NORTH_POLE_QUESTS: readonly QuestDefinition[] = QUEST_SPECS.map(questFrom);

// ---------------------------------------------------------------------------------------------
// NPC dialogue
// ---------------------------------------------------------------------------------------------

type PuzzlePart = NonNullable<DialogueNode['puzzleLine']>['part'];

function puzzleLine(
  npcId: string,
  puzzleId: string,
  part: PuzzlePart,
  text: string,
  bands?: readonly Band[],
): DialogueNode {
  const suffix = bands ? bands.map((b) => b.toLowerCase()).join('-') : 'all';
  return {
    id: `${npcId}-${puzzleId.replace(/^np-/, '')}-${part}-${suffix}`,
    conditions: [],
    followUpOnly: true,
    text,
    choices: [],
    puzzleLine: { puzzleId, part },
    ...(bands ? { ageBands: [...bands] } : {}),
  };
}

interface PuzzleSpec {
  id: string;
  /** Sprout, Pathfinder, Explorer. */
  intro: readonly [string, string, string];
  /** Sprout, then Pathfinder and Explorer together. */
  done: readonly [string, string];
  science?: string;
}

function puzzleNodes(npcId: string, puzzles: readonly PuzzleSpec[]): DialogueNode[] {
  return puzzles.flatMap((p) => [
    puzzleLine(npcId, p.id, 'intro', p.intro[0], ['SPROUT']),
    puzzleLine(npcId, p.id, 'intro', p.intro[1], ['PATHFINDER']),
    puzzleLine(npcId, p.id, 'intro', p.intro[2], ['EXPLORER']),
    puzzleLine(npcId, p.id, 'completeMessage', p.done[0], ['SPROUT']),
    puzzleLine(npcId, p.id, 'completeMessage', p.done[1], ['PATHFINDER', 'EXPLORER']),
    ...(p.science ? [puzzleLine(npcId, p.id, 'scienceNote', p.science)] : []),
  ]);
}

interface NpcSpec {
  id: string;
  displayName: string;
  role: string;
  /** Sprout, Pathfinder, Explorer openers. */
  openers: readonly [string, string, string];
  help: string;
  hint: string;
  /** Conditioned on the zone's final key, listed first. */
  thanks: ReadonlyArray<readonly [changeKey: string, text: string]>;
  puzzles: readonly PuzzleSpec[];
  offers: ReadonlyArray<readonly [questId: string, prerequisite: string | null]>;
}

const when = (key: string): NpcCondition[] => [{ type: 'WORLD_CHANGE', changeKey: key }];

function buildNpc(spec: NpcSpec): NpcDefinition {
  const { id } = spec;
  const thanks: DialogueNode[] = spec.thanks.map(([key, text], i) => ({
    id: `${id}-thanks${i === 0 ? '' : `-${i + 1}`}`,
    conditions: when(key),
    text,
    choices: [{ id: `${id}-thanks-${i + 1}-bye`, label: 'You are welcome!' }],
  }));
  const openers: DialogueNode[] = ALL_BANDS.map((band, i) => {
    const b = band.toLowerCase();
    return {
      id: `${id}-greeting-${b}`,
      conditions: [],
      text: spec.openers[i] as string,
      ageBands: [band],
      choices: [
        { id: `${id}-greeting-${b}-help`, label: 'What can I do?', nextNodeId: `${id}-help` },
        { id: `${id}-greeting-${b}-hint`, label: 'I need a hint.', nextNodeId: `${id}-hint` },
        { id: `${id}-greeting-${b}-bye`, label: 'See you soon!' },
      ],
    };
  });
  const followUps: DialogueNode[] = [
    {
      id: `${id}-help`,
      conditions: [{ type: 'ALWAYS' }],
      followUpOnly: true,
      text: spec.help,
      choices: [{ id: `${id}-help-bye`, label: 'Thank you!' }],
    },
    {
      id: `${id}-hint`,
      conditions: [{ type: 'ALWAYS' }],
      followUpOnly: true,
      text: spec.hint,
      choices: [{ id: `${id}-hint-bye`, label: 'Thank you!' }],
    },
  ];
  return {
    id,
    displayName: spec.displayName,
    role: spec.role,
    homeLocationSlug: NORTH_POLE_PLACE_SLUG,
    interactionId: `meet-${id}`,
    schedule: [],
    dialogue: [...thanks, ...openers, ...followUps, ...puzzleNodes(id, spec.puzzles)],
    questOffers: spec.offers.map(([questId, prerequisite]) => ({
      questId,
      summary: QUEST_SPECS.find((q) => q.id === questId)?.summary ?? '',
      conditions: prerequisite ? when(prerequisite) : [{ type: 'ALWAYS' }],
    })),
  };
}

const K = NORTH_POLE_KEYS;

const JINGLE: NpcSpec = {
  id: 'jingle',
  displayName: 'Jingle',
  role: 'Cheerful elf guide at Santa’s Landing and the base of Snowflake Mountain. Offers Welcome to the North Pole and Snowflake Mountain.',
  openers: [
    'Hi, friend! I am Jingle the elf. Welcome to the North Pole!',
    'Hello! I am Jingle, an elf who helps visitors. A storm has scattered the Christmas Star, and we need your help.',
    'Welcome to the North Pole! I am Jingle. A winter storm broke the Christmas Star into seven pieces. Will you help me find them?',
  ],
  help: 'Use the move controls to walk, and the jump button to hop over small gaps. Every jump has a walking way too, so you can always walk around.',
  hint: 'Stuck? Look around for something that glows, or talk to a friend nearby. You can always take the walking way.',
  thanks: [
    [
      K.mountainSummit,
      'You climbed Snowflake Mountain! You kept trying, and that is what matters most.',
    ],
    [
      K.welcomeLooked,
      'You looked all around the village. The workshop gate is open now. You can walk right in.',
    ],
  ],
  puzzles: [
    {
      id: 'np-welcome-look',
      intro: [
        'Look around the village. Can you spot three special places?',
        'Look all around the village. Can you spot four special places?',
        'Look carefully around Santa’s Landing and find five landmarks. Good explorers notice small things.',
      ],
      done: [
        'You looked all around! The workshop gate is open.',
        'Great looking! The snowdrift by the workshop path has melted. You can walk right in.',
      ],
    },
    {
      id: 'np-mountain-weather',
      intro: [
        'What is this? Is it snow, ice, or water?',
        'Snow, ice, and water are all the same stuff in different forms. Which one is this?',
        'Water can be ice, liquid, or a gas called water vapour. Choose the answer that matches the winter weather.',
      ],
      done: [
        'You made it to the top! What a view.',
        'You made it to the top of the mountain! You know a lot about winter weather.',
      ],
      science:
        'Real snow is made of tiny ice crystals, and most snowflakes have six sides. Water freezes when it is cold and melts when it warms up.',
    },
  ],
  offers: [
    ['np-q01-welcome', null],
    ['np-q07-snowflake-mountain', K.gingerRepaired],
  ],
};

const TINKER: NpcSpec = {
  id: 'tinker',
  displayName: 'Tinker',
  role: 'Toymaker elf in Santa’s Workshop. Offers Trouble in the Toy Workshop.',
  openers: [
    'Hello! I am Tinker. I make toys. My toy machine stopped!',
    'Hi! I am Tinker the toymaker. My toy machine has stopped, and the toys are piling up. Can you help me?',
    'Welcome to the workshop! I am Tinker. The toy machine has stopped, and I need to count, sort, and fix things to start it again. Can you help?',
  ],
  help: 'Count the toys, sort the presents, and fix the pattern on the belt. Then we can build a toy and start the machine. Take your time.',
  hint: 'Look at the toys one at a time. Touch each one as you count, and take a breath. Try again as many times as you like.',
  thanks: [
    [
      K.workshopRestored,
      'The machine hums again! Thank you for helping me. The toys will be ready.',
    ],
  ],
  puzzles: [
    {
      id: 'np-workshop-count',
      intro: [
        'Count the toys on the shelf. How many do you see?',
        'Count the toys in each pile. Pick the number that matches.',
        'The toy shelf needs a careful count. Count every toy, then pick the right total.',
      ],
      done: [
        'You counted them all! Well done.',
        'Counting done! Every toy is ready for the next job.',
      ],
    },
    {
      id: 'np-workshop-sort',
      intro: [
        'Sort the presents. Which ones go together?',
        'Sort the presents by colour, shape, or kind. Find the one that belongs.',
        'Presents get sorted by colour, shape, or kind. Look for what the group has in common, then pick the one that fits.',
      ],
      done: [
        'All sorted! The presents look tidy.',
        'Sorted! Putting like things together makes a big job easier.',
      ],
    },
    {
      id: 'np-workshop-pattern',
      intro: [
        'The belt has a pattern. What comes next?',
        'The toys on the belt repeat in a pattern. Which toy comes next?',
        'A pattern runs along the belt. Work out the rule, then choose the toy that comes next.',
      ],
      done: [
        'The pattern is fixed! Toys can roll again.',
        'Pattern fixed! Patterns repeat, so once you know the rule you can tell what comes next.',
      ],
    },
    {
      id: 'np-workshop-assemble',
      intro: [
        'Build the toy. Put the parts in order.',
        'Put the toy parts in order, one step at a time.',
        'Every toy has an order for building it. Work out which part goes first, next, and last.',
      ],
      done: [
        'You built the toy! The workshop works again.',
        'The toy is built, and the workshop machine hums again. Thank you for your help!',
      ],
    },
  ],
  offers: [['np-q02-toy-workshop', K.welcomeLooked]],
};

const PEPPERMINT: NpcSpec = {
  id: 'peppermint',
  displayName: 'Peppermint',
  role: 'Guide of the Candy Cane Forest. Offers Candy Cane Forest.',
  openers: [
    'Hello! I am Peppermint. The forest smells minty!',
    'Hi there! I am Peppermint. I look after the candy cane forest, and the path is all tangled. Can you help?',
    'Welcome to the Candy Cane Forest! I am Peppermint. The trail signs got mixed up in the storm, and we need to put them right.',
  ],
  help: 'Follow the number path, read the signs, and put the candy stripes in order. The stepping stones are fun to hop, and you can walk the path around them too.',
  hint: 'Say the numbers out loud, one by one. Look for what changes each time. You can hop the stones or walk around.',
  thanks: [[K.forestDone, 'The forest path is clear! Thank you. It smells even more minty now.']],
  puzzles: [
    {
      id: 'np-forest-sequence',
      intro: [
        'Follow the numbers on the candy canes. What comes next?',
        'The candy cane signs count in order. Which number comes next?',
        'Numbers on the signs follow a rule, like counting by twos or fives. Find the rule and choose the next number.',
      ],
      done: [
        'You found the path! It smells minty.',
        'The path is clear. Number rules help us find our way.',
      ],
    },
    {
      id: 'np-forest-signs',
      intro: [
        'Read the sign. Which way does the arrow point?',
        'Read the signs. Which way should you go?',
        'Read the signposts carefully. Each one gives a direction. Choose the way that matches the words.',
      ],
      done: [
        'You read the signs! You know the way.',
        'You read the signs well. Reading helps us find our way.',
      ],
    },
    {
      id: 'np-forest-stripes',
      intro: [
        'Put the red and white stripes in order.',
        'Put the candy stripes in order to match the pattern.',
        'Rebuild the candy cane stripes. Look at the pattern, then order each stripe so it repeats.',
      ],
      done: [
        'The candy cane is stripy again!',
        'The stripes match! The forest path is open. You can walk it, or hop the stones if you like.',
      ],
    },
  ],
  offers: [['np-q03-candy-cane-forest', K.workshopRestored]],
};

const FROSTY: NpcSpec = {
  id: 'frosty',
  displayName: 'Frosty',
  role: 'Elf ice-skating guide at the Frozen Lake. Offers The Frozen Lake.',
  openers: [
    'Hi! I am Frosty, an elf who loves to skate. Wheee!',
    'Hello! I am Frosty, the elf who skates on the frozen lake. The ice bridge is not up yet. Can you help me raise it?',
    'Welcome to the Frozen Lake! I am Frosty. The far island has something shiny on it, and we need to build the ice bridge to reach it.',
  ],
  help: 'Solve each number question and choose the ice floe with the answer. The ice bridge grows as you go. You can walk across it when it is ready.',
  hint: 'Count on your fingers or draw the numbers in the snow. Try again if you like. Take your time on the ice.',
  thanks: [
    [
      K.lakeDone,
      'The ice bridge is strong! Thank you for helping. Real ice takes a long, cold time to grow.',
    ],
  ],
  puzzles: [
    {
      id: 'np-lake-sums',
      intro: [
        'Pick the ice floe with the right answer.',
        'Add the numbers, then choose the ice floe with the answer. The ice bridge will grow.',
        'Solve the sum, then choose the ice floe that shows the answer. Each answer helps the ice bridge grow.',
      ],
      done: [
        'The ice bridge is up! You can walk across.',
        'The ice bridge rises! You can walk across it.',
      ],
      science:
        'Real ice forms when water gets cold enough to freeze. A frozen lake can look strong, so grown-ups always check it first.',
    },
    {
      id: 'np-lake-order',
      intro: [
        'Put the ice floes in number order. Start with the smallest.',
        'Put the ice floes in number order, from smallest to biggest.',
        'The floes are out of order. Arrange them from smallest to biggest to make a path.',
      ],
      done: [
        'All in order! Nice work.',
        'In order! Putting numbers in order shows which is bigger.',
      ],
    },
    {
      id: 'np-lake-shapes',
      intro: [
        'Which shape is on the ice? Pick the same one.',
        'Look at the shapes on the ice. Pick the one that matches.',
        'Shapes can be cut into equal parts, like halves and quarters. Pick the answer that matches the picture.',
      ],
      done: [
        'You matched the shapes! Wheee!',
        'Matched! Shapes and equal parts are all around us.',
      ],
    },
  ],
  offers: [['np-q04-frozen-lake', K.forestDone]],
};

const NOEL: NpcSpec = {
  id: 'noel',
  displayName: 'Noel',
  role: 'Reindeer keeper at the stables. Offers The Missing Reindeer.',
  openers: [
    'Hello! I am Noel. I look after the reindeer. One baby reindeer is missing.',
    'Hi! I am Noel, the reindeer keeper. Snowball, our youngest calf, has wandered off. Will you help me find Snowball?',
    'Welcome to the stables! I am Noel. Our youngest reindeer calf, Snowball, wandered away in the storm. Real reindeer calves can walk soon after they are born, so Snowball can go far.',
  ],
  help: 'Learn about reindeer, follow the footprints, and find what Snowball needs. Then bring the collar back to me. Pine Hollow is out in the snow, so take your time.',
  hint: 'Look closely at the footprints. Which way do the toes point? Real reindeer have wide hooves that spread out in the snow.',
  thanks: [
    [
      K.snowballHome,
      'Snowball is home, warm and safe! Thank you for helping. You are a true reindeer rescuer.',
    ],
  ],
  puzzles: [
    {
      id: 'np-stables-facts',
      intro: [
        'Let us learn about reindeer. Pick the right picture.',
        'Let us learn about real reindeer. Read the question, then pick the answer.',
        'Real reindeer live in cold places. Read each fact carefully, then choose the answer that matches.',
      ],
      done: [
        'You know about reindeer now!',
        'Great learning! Now you know some real reindeer facts.',
      ],
      science:
        'Real reindeer have wide hooves that spread out like snowshoes, so they can walk on snow. Both male and female reindeer can grow antlers.',
    },
    {
      id: 'np-stables-tracks',
      intro: [
        'Follow the footprints. Which way did Snowball go?',
        'Look at the footprints. Which way do they lead?',
        'Look at the direction, size, and spacing of the footprints. Work out which way the calf went.',
      ],
      done: ['You followed the footprints!', 'You followed the trail well. Footprints are clues.'],
      science:
        'Real animals leave prints that tell us how big they are and how fast they moved. Prints that are far apart mean the animal was trotting.',
    },
    {
      id: 'np-stables-supplies',
      intro: [
        'What do reindeer eat? Pick the food.',
        'Choose what Snowball needs for the trip home.',
        'Choose the supplies a reindeer calf needs. Think about what reindeer really eat.',
      ],
      done: ['Good food for Snowball!', 'You picked just what a hungry calf needs.'],
      science:
        'Real reindeer eat lichen, grass, and leaves, and they dig through snow with their hooves to find food.',
    },
    {
      id: 'np-stables-return',
      intro: [
        'Take Snowball’s collar to Noel.',
        'Take the collar you found to Noel.',
        'Bring Snowball’s collar back to Noel and tell him what you found.',
      ],
      done: [
        'Snowball is home! Hooray!',
        'Snowball is home! Thank you. The stables feel warm and happy again.',
      ],
    },
  ],
  offers: [['np-q05-missing-reindeer', K.lakeDone]],
};

const GINGER: NpcSpec = {
  id: 'ginger',
  displayName: 'Ginger',
  role: 'Baker and builder in the Gingerbread Village. Offers The Gingerbread Mystery.',
  openers: [
    'Hi! I am Ginger. I bake and build with gingerbread!',
    'Hello! I am Ginger. A wall in the gingerbread village crumbled, and I need help to mend it. Can you?',
    'Welcome to the Gingerbread Village! I am Ginger. Part of our wall crumbled, and the mystery is how to rebuild it with the right shapes and sizes.',
  ],
  help: 'Match the shapes, finish the window, measure the cookie beams, and build the wall. Cookie steps lead up to the roof, and there is a ramp too.',
  hint: 'Look at the shapes slowly. How many sides does each one have? You can hop the cookie steps or walk up the ramp.',
  thanks: [
    [
      K.gingerRepaired,
      'The wall is mended! Thank you. The whole village smells like warm gingerbread.',
    ],
  ],
  puzzles: [
    {
      id: 'np-ginger-shapes',
      intro: [
        'Match the shapes on the gingerbread houses.',
        'Match each shape on the gingerbread houses to its name.',
        'Gingerbread houses are built from shapes like triangles and rectangles. Match each shape to its name and count its sides.',
      ],
      done: ['You matched the shapes!', 'Shapes matched! Houses are built from shapes.'],
    },
    {
      id: 'np-ginger-symmetry',
      intro: [
        'One side of the window is done. Pick the matching side.',
        'Complete the window so both sides match.',
        'A symmetric window looks the same on both sides, like a mirror. Choose the piece that completes it.',
      ],
      done: ['The window is done!', 'Both sides match! That is called symmetry.'],
    },
    {
      id: 'np-ginger-measure',
      intro: [
        'Which cookie beam is longer?',
        'Measure the cookie beam. Which one fits the gap?',
        'Measure with the ruler. Choose the beam that fits the gap exactly.',
      ],
      done: [
        'You picked the longer beam!',
        'You measured well. The right size makes a strong wall.',
      ],
    },
    {
      id: 'np-ginger-build',
      intro: [
        'Put the cookie beams in the gaps.',
        'Place each cookie beam into a gap in the wall.',
        'The wall has gaps. Place cookie beams that fit them, one at a time.',
      ],
      done: [
        'The gingerbread wall is mended!',
        'The wall is mended! The beams all fit, and the village is safe.',
      ],
    },
  ],
  offers: [['np-q06-gingerbread-mystery', K.snowballHome]],
};

const MRS_CLAUS: NpcSpec = {
  id: 'mrs-claus',
  displayName: 'Mrs. Claus',
  role: 'Kind baker and teacher in the Gingerbread Village.',
  openers: [
    'Hello, little explorer! I am Mrs. Claus. I love to bake.',
    'Hello, explorer! I am Mrs. Claus. Come in and read my recipe card with me.',
    'Welcome, explorer! I am Mrs. Claus. I bake for the whole village, and a good recipe needs careful reading.',
  ],
  help: 'Read the recipe card slowly. Each step comes in order. If a word is tricky, ask me to read it with you.',
  hint: 'Look at the pictures on the card, then read the words next to them. Take your time. Try again if you like.',
  thanks: [
    [K.gingerRepaired, 'The wall is mended and the cookies are baking. Thank you, dear explorer.'],
  ],
  puzzles: [
    {
      id: 'np-ginger-recipe',
      intro: [
        'I have a recipe. Which picture is the next step?',
        'Read my recipe card. Which step comes next?',
        'Read my recipe card carefully. Recipes work in order, so work out which step comes next.',
      ],
      done: [
        'You read the recipe! Yum.',
        'You read the recipe well. Reading helps us make good things.',
      ],
      science:
        'When cookies bake, the heat makes the dough firm and turns it golden. That is a real change that cannot be undone.',
    },
  ],
  offers: [],
};

const POLARIS: NpcSpec = {
  id: 'polaris',
  displayName: 'Polaris',
  role: 'Star watcher at the Observatory. Offers Restore the Christmas Star.',
  openers: [
    'Hello! I am Polaris. I watch the stars.',
    'Hello! I am Polaris. I study stars in the observatory. We need to put the Christmas Star back together.',
    'Welcome to the Observatory! I am Polaris. I study the night sky. Real stars are balls of gas, but the Christmas Star is island magic, and it needs all seven pieces.',
  ],
  help: 'Learn about stars, find a constellation, and put the night sky in order. Then we can place the seven star pieces and make the star shine.',
  hint: 'Look at the dots as if they were a dot to dot picture. Real stars look tiny only because they are very far away.',
  thanks: [
    [
      K.starRestored,
      'The Christmas Star shines again! Thank you. It is island magic, and you helped it.',
    ],
  ],
  puzzles: [
    {
      id: 'np-obs-stars',
      intro: [
        'Let us look at the stars. Pick the right picture.',
        'Let us learn about stars. Read the question, then pick the answer.',
        'Let us learn some real astronomy. Read each question carefully and choose the answer.',
      ],
      done: ['You know about stars now!', 'Great learning! You know some real facts about stars.'],
      science:
        'Real stars are huge balls of hot gas, very far away. Our Sun is a star too. The Christmas Star is island magic.',
    },
    {
      id: 'np-obs-constellation',
      intro: [
        'Find the shape in the stars. Which picture is it?',
        'Find the constellation. Which shape do the stars make?',
        'A constellation is a pattern of stars. Look at the dots and choose the constellation they make.',
      ],
      done: [
        'You found the shape in the stars!',
        'You found it! Looking for shapes in stars is how people have named them.',
      ],
      science:
        'A constellation is a pattern of stars that people gave a name, like a dot to dot picture in the sky. Real Polaris, the North Star, stays almost in one spot in the northern sky.',
    },
    {
      id: 'np-obs-sequence',
      intro: [
        'Put the night sky in order. What comes first?',
        'Put the night sky pictures in order, from first to last.',
        'The night sky changes in order through the evening. Put the pictures in the order they happen.',
      ],
      done: ['All in order!', 'In order! The sky changes in a steady pattern each day.'],
      science:
        'Real stars are in the sky all day too. We cannot see them because the Sun is so bright.',
    },
    {
      id: 'np-obs-fragments',
      intro: [
        'Put the seven star pieces back. Follow your journey.',
        'Put the seven star pieces back in the order you found them.',
        'Set the seven star pieces into their places in the order of your journey. Think back to where you found each one.',
      ],
      done: [
        'All seven pieces are in!',
        'All seven pieces are in place. You remembered the whole journey.',
      ],
    },
    {
      id: 'np-obs-final',
      intro: [
        'One last question. Let us count the stars.',
        'One last question to make the star shine. Take your time.',
        'One last challenge to make the star shine. Use what you have learned on your journey.',
      ],
      done: [
        'The star shines! It is island magic.',
        'The Christmas Star shines again! It is island magic, and you helped make it happen.',
      ],
    },
  ],
  offers: [['np-q08-restore-the-star', K.mountainSummit]],
};

const SANTA: NpcSpec = {
  id: 'santa-claus',
  displayName: 'Santa Claus',
  role: 'Jolly host at Santa’s Landing. Offers Christmas Eve Celebration.',
  openers: [
    'Ho ho ho! I am Santa. Hello, friend!',
    'Ho ho ho! I am Santa Claus. Thank you for coming all the way to the North Pole to help us.',
    'Ho ho ho! Welcome back to Santa’s Landing. I am Santa. I heard how hard everyone worked on the Christmas Star, and I am glad you came.',
  ],
  help: 'Walk to the sleigh and ring the bell. Everyone will be so happy! You can walk right up to it.',
  hint: 'The sleigh bell is near the sleigh. Look for something that jingles.',
  thanks: [
    [
      K.christmasEve,
      'Well done! You worked hard, tried again when it was tricky, and helped your friends. That makes me so happy.',
    ],
  ],
  puzzles: [
    {
      id: 'np-eve-sleigh-bell',
      intro: [
        'Ring the sleigh bell! Jingle jingle!',
        'Ring Santa’s sleigh bell to start the celebration.',
        'The Christmas Star is shining. Ring the sleigh bell and let the whole North Pole celebrate.',
      ],
      done: [
        'Jingle jingle! Hooray!',
        'You did it! Thank you for your hard work and kindness. The sleigh is ready.',
      ],
    },
  ],
  offers: [['np-q09-christmas-eve', K.starRestored]],
};

const SNOWBALL: NpcDefinition = {
  id: 'snowball',
  displayName: 'Snowball',
  role: 'Reindeer calf. Speaks only in animal sound captions.',
  homeLocationSlug: NORTH_POLE_PLACE_SLUG,
  interactionId: 'meet-snowball',
  schedule: [],
  dialogue: [
    {
      id: 'snowball-home',
      conditions: when(K.snowballHome),
      text: 'Snowball snuffles happily in the warm stable.',
      choices: [{ id: 'snowball-home-bye', label: 'Sleep well!' }],
    },
    {
      id: 'snowball-found',
      conditions: when(K.snowballFound),
      text: 'Snowball nuzzles you and follows close.',
      choices: [{ id: 'snowball-found-bye', label: 'Let us go home!' }],
    },
    {
      id: 'snowball-greeting',
      conditions: [],
      text: 'Snowball nuzzles your hand.',
      choices: [
        { id: 'snowball-greeting-pat', label: 'Pat Snowball', nextNodeId: 'snowball-huff' },
        { id: 'snowball-greeting-listen', label: 'Listen', nextNodeId: 'snowball-click' },
        { id: 'snowball-greeting-bye', label: 'Hello, Snowball!' },
      ],
    },
    {
      id: 'snowball-huff',
      conditions: [{ type: 'ALWAYS' }],
      followUpOnly: true,
      text: 'Snowball makes a soft huffing sound.',
      choices: [{ id: 'snowball-huff-bye', label: 'Good Snowball!' }],
    },
    {
      id: 'snowball-click',
      conditions: [{ type: 'ALWAYS' }],
      followUpOnly: true,
      text: 'Click, click, click. Snowball’s hooves click as they walk.',
      choices: [{ id: 'snowball-click-bye', label: 'Good Snowball!' }],
    },
  ],
  questOffers: [],
};

export const NORTH_POLE_NPCS: readonly NpcDefinition[] = [
  buildNpc(SANTA),
  buildNpc(MRS_CLAUS),
  buildNpc(JINGLE),
  buildNpc(TINKER),
  buildNpc(PEPPERMINT),
  buildNpc(FROSTY),
  buildNpc(NOEL),
  buildNpc(GINGER),
  buildNpc(POLARIS),
  SNOWBALL,
];

/** Puzzle id to the NPC who hosts it (contract section 5 zones). Used by the tests. */
export const NORTH_POLE_PUZZLE_HOSTS: Readonly<Record<string, string>> = Object.fromEntries(
  [JINGLE, TINKER, PEPPERMINT, FROSTY, NOEL, GINGER, MRS_CLAUS, POLARIS, SANTA].flatMap((npc) =>
    npc.puzzles.map((p) => [p.id, npc.id] as const),
  ),
);

/** The Realm's content pack (the export lists it as its own Island, not the home one). */
export const NORTH_POLE_PACK = {
  version: 1,
  locationSlugs: [NORTH_POLE_PLACE_SLUG],
  adventureSlugs: [] as string[],
  questIds: [...NORTH_POLE_QUEST_IDS],
  itemIds: NORTH_POLE_ITEMS.map((item) => item.id),
  collectibleSetIds: NORTH_POLE_COLLECTIBLE_SETS.map((set) => set.id),
  npcIds: [...NORTH_POLE_NPC_IDS],
  discoveryIds: [] as string[],
  storySlugs: [] as string[],
};
