import type { IslandLocation } from '../island/locations';
import type { DialogueNode, NpcDefinition } from '../npc/types';
import type { QuestDefinition } from '../quests/types';
import type { CollectibleSet, ItemDefinition, RewardTable } from '../rewards/types';
import { HOME_WORLD_SLUG } from '../worlds/slugs';
import { FIREPEAK_CHANGE_KEYS } from './firepeakContent';

/**
 * The Heart of Firepeak: authored content (docs/firepeak/HEART_OF_FIREPEAK_DESIGN.md sections 3,
 * 6, 7 and 8). Export-only, exactly like `firepeakContent.ts`: nothing here is loaded by the
 * Amplify app. It reaches Django through `manage.py load_content`, after which Django is
 * authoritative (ADR-047).
 *
 * The 3D Area's layout and puzzle parameters are authored in the Django seed with the same ids
 * and change keys as here. Ages: Pathfinders and Explorers only (FPV-D3). Copy is written to be
 * read aloud, avoids em dashes, and keeps real science (Professor Basalt) apart from island magic.
 * No line pressures, shames or asks the child for anything private.
 */

export const HEART_PLACE_SLUG = 'firepeak-heart';
export const HEART_QUEST_ID = 'the-heart-of-firepeak';

export const HEART_NPC_IDS = {
  flint: 'flint',
  kindle: 'kindle',
  basalt: 'professor-basalt',
  cinder: 'cinder',
  ignis: 'ignis',
} as const;

/** World changes recorded at `firepeak-heart` (design section 6). */
export const HEART_CHANGE_KEYS = {
  mapRead: 'FIREPEAK_HEART_MAP_READ',
  patternSolved: 'FIREPEAK_HEART_PATTERN_SOLVED',
  emberwoodDone: 'FIREPEAK_HEART_EMBERWOOD_DONE',
  lavaBridge: 'FIREPEAK_HEART_LAVA_BRIDGE',
  lavaCrossed: 'FIREPEAK_HEART_LAVA_CROSSED',
  shapesMatched: 'FIREPEAK_HEART_SHAPES_MATCHED',
  cavernLit: 'FIREPEAK_HEART_CAVERN_LIT',
  forgePowered: 'FIREPEAK_HEART_FORGE_POWERED',
  forgeRestored: 'FIREPEAK_HEART_FORGE_RESTORED',
  rocksNamed: 'FIREPEAK_HEART_ROCKS_NAMED',
  summitReached: 'FIREPEAK_HEART_SUMMIT_REACHED',
  crystalsSet: 'FIREPEAK_HEART_CRYSTALS_SET',
  restored: 'FIREPEAK_HEART_RESTORED',
  celebrated: 'FIREPEAK_HEART_CELEBRATED',
  /** Recorded when the quest completes. */
  complete: 'FIREPEAK_HEART_COMPLETE',
} as const;

const K = HEART_CHANGE_KEYS;
const BANDS = ['PATHFINDER', 'EXPLORER'] as const;
type Band = (typeof BANDS)[number];
type PuzzlePart = NonNullable<DialogueNode['puzzleLine']>['part'];

export const HEART_LOCATIONS: readonly IslandLocation[] = [
  {
    slug: HEART_PLACE_SLUG,
    worldSlug: HOME_WORLD_SLUG,
    title: 'Heart of Firepeak',
    tagline: 'Bring the glow back to the heart of the mountain.',
    description:
      'The Heart of Firepeak is a crystal of island magic that keeps the mountain calm, and it has gone dim. Cross seven places with Flint and Kindle, solve number, pattern and logic puzzles, learn real volcano science from Professor Basalt, and light the Heart again.',
    skills: [
      'Earth science',
      'Number sense',
      'Patterns and sequences',
      'Shapes',
      'Logic and problem solving',
    ],
    subjectAreas: ['SCIENCE', 'MATH'],
    decoration:
      'Warm light flickers inside the mountain. Flint waits at Explorer’s Landing with a map.',
  },
];

/* ------------------------------------------------------------------ puzzle lines */

type LineSet = readonly [part: PuzzlePart, band: Band | 'ALL', text: string];

function lineNodes(
  prefix: string,
  puzzleId: string,
  lines: readonly LineSet[],
  speaker?: string,
): DialogueNode[] {
  const short = puzzleId.replace(/^fh-/, '');
  return lines.map(([part, band, text]) => ({
    id: `${prefix}-${short}-${part}-${band.toLowerCase()}`,
    conditions: [],
    followUpOnly: true,
    text,
    choices: [],
    puzzleLine: { puzzleId, part },
    ...(band === 'ALL' ? {} : { ageBands: [band] }),
    ...(speaker ? { speaker } : {}),
  }));
}

const FLINT_LINES: DialogueNode[] = [
  ...lineNodes('flint', 'fh-landing-map', [
    [
      'intro',
      'PATHFINDER',
      'This is my map of Firepeak. Tap three places on it and I will tell you about each one.',
    ],
    [
      'intro',
      'EXPLORER',
      'This is my map of Firepeak. Find five places on it: the forest, the lava river, the caverns, the forge and the summit. Take your time.',
    ],
    ['completeMessage', 'PATHFINDER', 'You found three places! Now we know where we are going.'],
    [
      'completeMessage',
      'EXPLORER',
      'You found all five places. A good explorer reads the map before the journey. The forest gate is open.',
    ],
    [
      'scienceNote',
      'ALL',
      'Scientists who study volcanoes use maps to see where the mountain is high, where the lava flowed, and where it is safe to walk.',
    ],
  ]),
];

const KINDLE_LINES: DialogueNode[] = [
  ...lineNodes('kindle', 'fh-emberwood-pattern', [
    ['intro', 'PATHFINDER', 'These crystals make a pattern. Look closely. What comes next?'],
    [
      'intro',
      'EXPLORER',
      'Patterns grow and change. Study the crystals and the numbers, then work out what comes next.',
    ],
    ['completeMessage', 'PATHFINDER', 'Yes! You spotted the pattern. Well done!'],
    [
      'completeMessage',
      'EXPLORER',
      'You found the rule of the pattern. Rules help us know what comes next, even before we see it.',
    ],
  ]),
  ...lineNodes('kindle', 'fh-emberwood-count', [
    ['intro', 'PATHFINDER', 'I collected some embers. Can you count them with me?'],
    [
      'intro',
      'EXPLORER',
      'My embers are sitting in groups. Count in steps, or count the groups, to find how many there are.',
    ],
    [
      'completeMessage',
      'PATHFINDER',
      'You counted them just right. The path through the forest is open!',
    ],
    [
      'completeMessage',
      'EXPLORER',
      'Counting in groups is quicker than counting one by one. The forest path is open!',
    ],
  ]),
  ...lineNodes('kindle', 'fh-lava-numbers', [
    [
      'intro',
      'PATHFINDER',
      'Each stone has a number. Choose the stone that makes the sum true, and a bridge will rise.',
    ],
    [
      'intro',
      'EXPLORER',
      'The stones across the lava river are numbered. Solve the sum or the fact, and choose the stone with the answer. A wide bridge will rise.',
    ],
    ['completeMessage', 'PATHFINDER', 'The bridge is rising. You can walk across!'],
    [
      'completeMessage',
      'EXPLORER',
      'The bridge is ready. If you like a challenge, the stepping stones lead to a hidden shard.',
    ],
  ]),
  ...lineNodes('kindle', 'fh-lava-compare', [
    ['intro', 'PATHFINDER', 'Two paths, two numbers. Which number is bigger, or which is smaller?'],
    [
      'intro',
      'EXPLORER',
      'Each path shows a number or a fraction. Compare them, and choose the path the puzzle asks for.',
    ],
    ['completeMessage', 'PATHFINDER', 'That is the right path. Off we go to the caverns!'],
    [
      'completeMessage',
      'EXPLORER',
      'Comparing carefully, you chose well. The way to the caverns is open.',
    ],
  ]),
  ...lineNodes('kindle', 'fh-heart-restore', [
    [
      'intro',
      'ALL',
      'The four crystals are in place. Now let us set the shard back into the Heart together.',
    ],
    ['completeMessage', 'ALL', 'Look! The Heart is glowing again. Go and tell Ignis!'],
  ]),
];

const BASALT_LINES: DialogueNode[] = [
  ...lineNodes('basalt', 'fh-caverns-shapes', [
    [
      'intro',
      'PATHFINDER',
      'The crystals in here are shaped like circles, squares, triangles and hexagons. Match each one to its clue.',
    ],
    [
      'intro',
      'EXPLORER',
      'Crystals can have many faces, sides and corners. Read the clue carefully, then pick the shape that fits it.',
    ],
    ['completeMessage', 'PATHFINDER', 'You know your shapes! The crystals glow brighter.'],
    [
      'completeMessage',
      'EXPLORER',
      'Well matched. Counting sides and corners is how mathematicians tell shapes apart.',
    ],
  ]),
  ...lineNodes('basalt', 'fh-caverns-arrange', [
    ['intro', 'PATHFINDER', 'Put the crystals in a row, from the smallest to the largest.'],
    [
      'intro',
      'EXPLORER',
      'Put the crystals in order. Follow the rule on the card: it may be the number of sides, or the size of a fraction.',
    ],
    ['completeMessage', 'PATHFINDER', 'A perfect row! The cavern is lit.'],
    [
      'completeMessage',
      'EXPLORER',
      'The order is right and the cavern is lit. A secret passage has opened too.',
    ],
    [
      'scienceNote',
      'PATHFINDER',
      'Real crystals grow slowly, over a very long time, inside rock. These ones also glow with island magic.',
    ],
    [
      'scienceNote',
      'EXPLORER',
      'In the real world, crystals grow when minerals in hot liquid cool slowly and their tiny parts line up in a pattern. The glow in this cave is island magic, not science.',
    ],
  ]),
  ...lineNodes('basalt', 'fh-summit-rocks', [
    [
      'intro',
      'PATHFINDER',
      'Here are rock samples from the mountain. Let us learn about them. Choose the answer you think is right.',
    ],
    [
      'intro',
      'EXPLORER',
      'Here are three rocks from Firepeak: basalt, pumice and obsidian. Look at how each one looks and feels, then answer.',
    ],
    ['completeMessage', 'PATHFINDER', 'Well done, young scientist!'],
    ['completeMessage', 'EXPLORER', 'Excellent! You are thinking like a volcano scientist.'],
    [
      'scienceNote',
      'PATHFINDER',
      'Real volcanoes have hot melted rock called magma underground. When it comes out, it is called lava. Lava cools and hardens into rock.',
    ],
    [
      'scienceNote',
      'EXPLORER',
      'Basalt, pumice and obsidian are igneous rocks: they form when lava cools. Basalt is dark and heavy. Pumice is full of tiny bubbles and so light that it can float. Obsidian is shiny volcanic glass. A volcano is active if it can erupt, dormant if it is sleeping, and extinct if it is not expected to erupt again.',
    ],
  ]),
  ...lineNodes('basalt', 'fh-summit-island', [
    [
      'intro',
      'PATHFINDER',
      'Real islands can be made by volcanoes! Put the steps in order to see how.',
    ],
    [
      'intro',
      'EXPLORER',
      'Some real islands were built by volcanoes. Put the steps in order, from the magma deep below to the island above the sea.',
    ],
    ['completeMessage', 'PATHFINDER', 'You told the story of a volcano island in the right order!'],
    [
      'completeMessage',
      'EXPLORER',
      'That is the true story of a volcanic island. The summit is yours to explore. Ignis is waiting beyond.',
    ],
    [
      'scienceNote',
      'PATHFINDER',
      'Magma rises, lava comes out and cools into rock, and over a very long time the rock piles up into an island.',
    ],
    [
      'scienceNote',
      'EXPLORER',
      'In the real world, magma rises and erupts under the sea. Lava cools into new rock, and layer upon layer builds up over a very long time, until the volcano rises above the water. The island of Hawaii grew this way.',
    ],
  ]),
];

const CINDER_LINES: DialogueNode[] = [
  ...lineNodes('cinder', 'fh-forge-switches', [
    [
      'intro',
      'PATHFINDER',
      'The old machine needs three switches pressed in the right order. Think about what must happen first.',
    ],
    [
      'intro',
      'EXPLORER',
      'The machine needs four steps in the right order. Remember: before the gears turn, the water must cool. Read the clues, then press the switches.',
    ],
    ['completeMessage', 'PATHFINDER', 'It hums! You got the order just right.'],
    [
      'completeMessage',
      'EXPLORER',
      'The forge is powered. Machines work when each step happens in the right order.',
    ],
  ]),
  ...lineNodes('cinder', 'fh-forge-circuit', [
    ['intro', 'PATHFINDER', 'The lamp needs power. Which path reaches the lamp?'],
    [
      'intro',
      'EXPLORER',
      'A circuit must make a full path for the power to flow. Find the path that completes the circuit, or share the crystals fairly if the clue asks.',
    ],
    ['completeMessage', 'PATHFINDER', 'The lamp is shining! The steam is clearing.'],
    [
      'completeMessage',
      'EXPLORER',
      'The circuit is complete and the forge is restored. The steam gates are open.',
    ],
    [
      'scienceNote',
      'ALL',
      'In real life, electricity flows only when there is a complete loop, called a circuit. A gap in the loop stops it.',
    ],
  ]),
];

const IGNIS_LINES: DialogueNode[] = [
  ...lineNodes('ignis', 'fh-heart-crystals', [
    [
      'intro',
      'PATHFINDER',
      'Four crystals came with you on your journey. Set them in the order you found them.',
    ],
    [
      'intro',
      'EXPLORER',
      'Read the clues about your journey. Then set the four crystals in the order you found them.',
    ],
    ['completeMessage', 'PATHFINDER', 'You remembered the whole journey. Thank you!'],
    [
      'completeMessage',
      'EXPLORER',
      'You set them in the order of your journey. The Heart has begun to glow.',
    ],
  ]),
  ...lineNodes('ignis', 'fh-heart-return', [
    ['intro', 'ALL', 'The Heart is shining again. Come and tell me all about it.'],
    ['completeMessage', 'PATHFINDER', 'The mountain is calm again. Thank you, brave explorer!'],
    [
      'completeMessage',
      'EXPLORER',
      'The mountain is calm and the Heart glows. Thank you, explorer, for your patience and your clear thinking.',
    ],
  ]),
];

/** Every puzzle in design section 6 that speaks, for tests. */
export const HEART_PUZZLE_IDS = [
  'fh-landing-map',
  'fh-emberwood-pattern',
  'fh-emberwood-count',
  'fh-lava-numbers',
  'fh-lava-compare',
  'fh-caverns-shapes',
  'fh-caverns-arrange',
  'fh-forge-switches',
  'fh-forge-circuit',
  'fh-summit-rocks',
  'fh-summit-island',
  'fh-heart-crystals',
  'fh-heart-restore',
  'fh-heart-return',
] as const;

/* ------------------------------------------------------------------ conversation */

type Choice = DialogueNode['choices'][number];
const choice = (id: string, label: string, nextNodeId?: string): Choice => ({
  id,
  label,
  ...(nextNodeId ? { nextNodeId } : {}),
});
const when = (changeKey: string) => [{ type: 'WORLD_CHANGE' as const, changeKey }];
const ALWAYS = [{ type: 'ALWAYS' as const }];

function node(
  id: string,
  text: string,
  choices: Choice[],
  conditions: DialogueNode['conditions'] = ALWAYS,
  followUpOnly = false,
): DialogueNode {
  return { id, conditions, text, choices, ...(followUpOnly ? { followUpOnly: true } : {}) };
}

const FLINT: NpcDefinition = {
  id: HEART_NPC_IDS.flint,
  displayName: 'Flint',
  role: 'Explorer and guide at Explorer’s Landing. Offers The Heart of Firepeak.',
  homeLocationSlug: HEART_PLACE_SLUG,
  interactionId: 'meet-flint',
  schedule: [],
  dialogue: [
    node(
      'flint-thanks',
      'You did it, explorer! The Heart of Firepeak is glowing and the mountain is calm. I could not have done it without you.',
      [choice('flint-thanks-bye', 'That was amazing!', 'flint-bye')],
      when(K.complete),
    ),
    node(
      'flint-map-read',
      'You read the map very well. Follow the path north to Emberwood Forest. Kindle is waiting there.',
      [
        choice('flint-map-help', 'Can you help me?', 'flint-help'),
        choice('flint-map-bye', 'On my way!', 'flint-bye'),
      ],
      when(K.mapRead),
    ),
    node(
      'flint-greeting-awakened',
      'Welcome, explorer! I heard you helped Professor Ember wake Firepeak safely. Now the mountain needs a hero for its Heart.',
      [
        choice('flint-awakened-ask', 'What happened to the Heart?', 'flint-help'),
        choice('flint-awakened-bye', 'Let us start!', 'flint-bye'),
      ],
      when(FIREPEAK_CHANGE_KEYS.awakened),
    ),
    node(
      'flint-greeting',
      'Welcome to Firepeak, explorer! I am Flint. The Heart of the mountain has gone dim, and I could use your help.',
      [
        choice('flint-greeting-ask', 'What is the Heart?', 'flint-help'),
        choice('flint-greeting-hint', 'How do I move around?', 'flint-hint'),
        choice('flint-greeting-bye', 'Let us go!', 'flint-bye'),
      ],
    ),
    node(
      'flint-help',
      'The Heart of Firepeak is a crystal of island magic. It keeps the mountain calm. Seven places lie ahead, and each one has a puzzle that brings a little of its light back. Take your time, there is no rush.',
      [
        choice('flint-help-hint', 'Any tips?', 'flint-hint'),
        choice('flint-help-bye', 'I am ready!', 'flint-bye'),
      ],
      ALWAYS,
      true,
    ),
    node(
      'flint-hint',
      'Walk with the controls, and press jump to hop over small things. Every jump has a path you can walk instead, so you never have to jump. If you fall, you will start again from the last checkpoint.',
      [choice('flint-hint-thanks', 'Thanks, Flint!', 'flint-bye')],
      ALWAYS,
      true,
    ),
    node(
      'flint-bye',
      'Good luck, explorer! I will be right here if you want to talk.',
      [],
      ALWAYS,
      true,
    ),
    ...FLINT_LINES,
  ],
  questOffers: [
    {
      questId: HEART_QUEST_ID,
      summary: 'Help Flint light the Heart of Firepeak again.',
      conditions: ALWAYS,
    },
  ],
};

const KINDLE: NpcDefinition = {
  id: HEART_NPC_IDS.kindle,
  displayName: 'Kindle',
  role: 'A small, friendly fire spirit made of island magic. Gives hints and carries crystals.',
  homeLocationSlug: HEART_PLACE_SLUG,
  interactionId: 'meet-kindle',
  schedule: [],
  dialogue: [
    node(
      'kindle-thanks',
      'The Heart is glowing and the mountain is calm! I am a little spark of island magic, and I am glad I got to explore with you.',
      [choice('kindle-thanks-bye', 'Goodbye, Kindle!', 'kindle-bye')],
      when(K.complete),
    ),
    node(
      'kindle-restored',
      'The Heart is shining! Go and tell Ignis. I will wait right here.',
      [choice('kindle-restored-bye', 'I will!', 'kindle-bye')],
      when(K.restored),
    ),
    node(
      'kindle-crystals-set',
      'All four crystals are in place. Now we can set the shard back into the Heart.',
      [choice('kindle-crystals-hint', 'What do I do?', 'kindle-hint')],
      when(K.crystalsSet),
    ),
    node(
      'kindle-lava-crossed',
      'You crossed the lava river! I like warm places, but even I stay on the bridge.',
      [choice('kindle-lava-bye', 'Let us keep going!', 'kindle-bye')],
      when(K.lavaCrossed),
    ),
    node(
      'kindle-emberwood-done',
      'You counted the embers! The path ahead leads to the lava river. Stay on the bridge and the stones.',
      [choice('kindle-ember-hint', 'Any tips?', 'kindle-hint')],
      when(K.emberwoodDone),
    ),
    node(
      'kindle-greeting',
      'Hello! I am Kindle, a little fire spirit made of island magic. May I come along on your adventure?',
      [
        choice('kindle-greeting-ask', 'What do you do?', 'kindle-help'),
        choice('kindle-greeting-hint', 'Can I have a hint?', 'kindle-hint'),
        choice('kindle-greeting-bye', 'Let us go!', 'kindle-bye'),
      ],
    ),
    node(
      'kindle-help',
      'I carry the crystals and I like to give hints. When a puzzle is tricky, ask me, and I will help you think about it. You always do the solving.',
      [
        choice('kindle-help-hint', 'Can I have a hint?', 'kindle-hint'),
        choice('kindle-help-bye', 'Let us go!', 'kindle-bye'),
      ],
      ALWAYS,
      true,
    ),
    node(
      'kindle-hint',
      'Look closely at the puzzle and say the question out loud. Try one answer. If it is not right, you can try again as many times as you like.',
      [choice('kindle-hint-thanks', 'Thank you, Kindle!', 'kindle-bye')],
      ALWAYS,
      true,
    ),
    node('kindle-bye', 'See you soon! I will stay close.', [], ALWAYS, true),
    ...KINDLE_LINES,
  ],
  questOffers: [],
};

const BASALT: NpcDefinition = {
  id: HEART_NPC_IDS.basalt,
  displayName: 'Professor Basalt',
  role: 'Volcano scientist. Explains how real volcanoes, rocks and islands work.',
  homeLocationSlug: HEART_PLACE_SLUG,
  interactionId: 'meet-professor-basalt',
  schedule: [],
  dialogue: [
    node(
      'basalt-thanks',
      'The Heart glows and the mountain is calm. Remember, real volcanoes are watched carefully by scientists. You made a fine scientist today.',
      [choice('basalt-thanks-bye', 'Thank you, Professor!', 'basalt-bye')],
      when(K.complete),
    ),
    node(
      'basalt-summit-reached',
      'You reached the top, and you named the rocks. Ignis is waiting just beyond the summit.',
      [
        choice('basalt-summit-ask', 'What did I learn?', 'basalt-help'),
        choice('basalt-summit-bye', 'Goodbye, Professor!', 'basalt-bye'),
      ],
      when(K.summitReached),
    ),
    node(
      'basalt-rocks-named',
      'You know your rocks. Next, a story about how volcano islands grow. It is real science.',
      [choice('basalt-rocks-bye', 'I am ready!', 'basalt-bye')],
      when(K.rocksNamed),
    ),
    node(
      'basalt-cavern-lit',
      'The cavern is lit. The crystals here glow because of island magic. The rocks around them are real volcanic rock.',
      [
        choice('basalt-cavern-ask', 'What is the difference?', 'basalt-help'),
        choice('basalt-cavern-bye', 'Goodbye, Professor!', 'basalt-bye'),
      ],
      when(K.cavernLit),
    ),
    node(
      'basalt-greeting',
      'Greetings, young scientist! I am Professor Basalt. I study real volcanoes. Some things on Firepeak are island magic, and I will tell you which is which.',
      [
        choice('basalt-greeting-ask', 'What is a volcano?', 'basalt-help'),
        choice('basalt-greeting-hint', 'Can you give me a hint?', 'basalt-hint'),
        choice('basalt-greeting-bye', 'Goodbye, Professor!', 'basalt-bye'),
      ],
    ),
    node(
      'basalt-help',
      'Real volcanoes have hot melted rock called magma underground. When it comes out, it is called lava, and it cools into rock. The glowing crystals and the Heart of Firepeak are island magic.',
      [
        choice('basalt-help-hint', 'Can you give me a hint?', 'basalt-hint'),
        choice('basalt-help-bye', 'Thank you!', 'basalt-bye'),
      ],
      ALWAYS,
      true,
    ),
    node(
      'basalt-hint',
      'Scientists look carefully and compare. Look at the clues in the puzzle, think about each answer, and try the one that fits best.',
      [choice('basalt-hint-thanks', 'Thank you, Professor!', 'basalt-bye')],
      ALWAYS,
      true,
    ),
    node('basalt-bye', 'Keep asking questions, scientist. That is how we learn.', [], ALWAYS, true),
    ...BASALT_LINES,
  ],
  questOffers: [],
};

const CINDER: NpcDefinition = {
  id: HEART_NPC_IDS.cinder,
  displayName: 'Cinder',
  role: 'Keeper of the Ancient Forge. Needs help restarting the old machines.',
  homeLocationSlug: HEART_PLACE_SLUG,
  interactionId: 'meet-cinder',
  schedule: [],
  dialogue: [
    node(
      'cinder-thanks',
      'The forge hums and the Heart glows. Thank you, friend. I will keep the machines in good order.',
      [choice('cinder-thanks-bye', 'Goodbye, Cinder!', 'cinder-bye')],
      when(K.complete),
    ),
    node(
      'cinder-restored',
      'The forge is working again, and the steam gates are open. Go up to the summit. The view is grand.',
      [choice('cinder-restored-bye', 'Thank you, Cinder!', 'cinder-bye')],
      when(K.forgeRestored),
    ),
    node(
      'cinder-powered',
      'Hear that hum? The machine is powered. One more puzzle, and the lamp will shine.',
      [choice('cinder-powered-hint', 'Any tips?', 'cinder-hint')],
      when(K.forgePowered),
    ),
    node(
      'cinder-greeting',
      'Ah, a visitor. I am Cinder. I keep the old forge, but the machines have been quiet for a long time. Could you help me wake them?',
      [
        choice('cinder-greeting-ask', 'How do the machines work?', 'cinder-help'),
        choice('cinder-greeting-hint', 'Can I have a hint?', 'cinder-hint'),
        choice('cinder-greeting-bye', 'I will help!', 'cinder-bye'),
      ],
    ),
    node(
      'cinder-help',
      'Every machine works in steps. One thing happens, then the next. If you do the steps in the right order, the machine runs. Go slowly and think it through.',
      [
        choice('cinder-help-hint', 'Can I have a hint?', 'cinder-hint'),
        choice('cinder-help-bye', 'I am ready!', 'cinder-bye'),
      ],
      ALWAYS,
      true,
    ),
    node(
      'cinder-hint',
      'Ask yourself what must happen first. Then ask what comes next. Say the steps out loud, one at a time.',
      [choice('cinder-hint-thanks', 'Thanks, Cinder!', 'cinder-bye')],
      ALWAYS,
      true,
    ),
    node('cinder-bye', 'Take your time. The forge will wait.', [], ALWAYS, true),
    ...CINDER_LINES,
  ],
  questOffers: [],
};

const IGNIS: NpcDefinition = {
  id: HEART_NPC_IDS.ignis,
  displayName: 'Ignis',
  role: 'Gentle guardian of the Heart of Firepeak. Asks the child to set the crystals in order.',
  homeLocationSlug: HEART_PLACE_SLUG,
  interactionId: 'meet-ignis',
  schedule: [],
  dialogue: [
    node(
      'ignis-thanks',
      'The Heart of Firepeak shines and the mountain is calm. You brought the light back. The island thanks you, explorer.',
      [choice('ignis-thanks-bye', 'I loved the adventure!', 'ignis-bye')],
      when(K.complete),
    ),
    node(
      'ignis-celebrated',
      'We did it. The whole mountain is warm and calm. Take the portal back to the landing whenever you like.',
      [choice('ignis-celebrated-bye', 'Goodbye, Ignis!', 'ignis-bye')],
      when(K.celebrated),
    ),
    node(
      'ignis-restored',
      'The Heart is glowing, thanks to you. Come and tell me what it was like.',
      [choice('ignis-restored-bye', 'It was wonderful!', 'ignis-bye')],
      when(K.restored),
    ),
    node(
      'ignis-crystals-set',
      'The four crystals are in their places. Kindle will help you set the shard into the Heart.',
      [choice('ignis-set-bye', 'Thank you, Ignis!', 'ignis-bye')],
      when(K.crystalsSet),
    ),
    node(
      'ignis-summit-reached',
      'You came a long way to reach me. The Heart is dim, and four crystals came with you. Will you set them in order?',
      [
        choice('ignis-summit-ask', 'How do I do that?', 'ignis-help'),
        choice('ignis-summit-hint', 'Can I have a hint?', 'ignis-hint'),
      ],
      when(K.summitReached),
    ),
    node(
      'ignis-greeting',
      'Welcome, traveler. I am Ignis, the guardian of the Heart. The way to the Heart opens when you have crossed the whole mountain.',
      [
        choice('ignis-greeting-ask', 'What is the Heart?', 'ignis-help'),
        choice('ignis-greeting-bye', 'I will come back.', 'ignis-bye'),
      ],
    ),
    node(
      'ignis-help',
      'The Heart is a crystal of island magic. When we set the crystals in the order of your journey, it remembers the places you passed through, and it glows. There is no hurry.',
      [
        choice('ignis-help-hint', 'Can I have a hint?', 'ignis-hint'),
        choice('ignis-help-bye', 'I am ready.', 'ignis-bye'),
      ],
      ALWAYS,
      true,
    ),
    node(
      'ignis-hint',
      'Think back to your journey. Which place came first? Which came next? Say them in order, then set the crystals.',
      [choice('ignis-hint-thanks', 'Thank you, Ignis!', 'ignis-bye')],
      ALWAYS,
      true,
    ),
    node('ignis-bye', 'Go gently, explorer. The mountain is glad you came.', [], ALWAYS, true),
    ...IGNIS_LINES,
  ],
  questOffers: [],
};

export const HEART_NPCS: readonly NpcDefinition[] = [FLINT, KINDLE, BASALT, CINDER, IGNIS];

/* ------------------------------------------------------------------ items */

const journalEntry = { subject: 'EARTH_SCIENCE' as const, questId: HEART_QUEST_ID };

export const HEART_CRYSTALS_SET_ID = 'fh-set-elemental-crystals';
export const HEART_SHARDS_SET_ID = 'fh-set-ember-shards';

const crystal = (id: string, displayName: string, description: string): ItemDefinition => ({
  id,
  displayName,
  description,
  category: 'QUEST_ITEM',
  rarity: 'UNCOMMON',
  setId: HEART_CRYSTALS_SET_ID,
});

const SHARD_ZONES = [
  ['landing', 'Landing', 'Explorer’s Landing'],
  ['emberwood', 'Emberwood', 'Emberwood Forest'],
  ['lava', 'Lava Jumper', 'the Lava Crossing'],
  ['caverns', 'Caverns', 'the Crystal Caverns'],
  ['forge', 'Forge', 'the Ancient Forge'],
  ['summit', 'Summit', 'Firepeak Summit'],
  ['heart', 'Heart', 'the Heart Chamber'],
] as const;

const badge = (
  id: string,
  displayName: string,
  description: string,
  rarity: ItemDefinition['rarity'] = 'COMMON',
): ItemDefinition => ({ id, displayName, description, category: 'KEEPSAKE', rarity });

const journal = (id: string, displayName: string, description: string): ItemDefinition => ({
  id,
  displayName,
  description,
  category: 'COLLECTIBLE',
  rarity: 'COMMON',
  journal: journalEntry,
});

export const HEART_ITEMS: readonly ItemDefinition[] = [
  crystal(
    'fh-crystal-forest',
    'Forest Crystal',
    'A green crystal from Emberwood Forest. It glows softly with island magic.',
  ),
  crystal(
    'fh-crystal-magma',
    'Magma Crystal',
    'A red crystal from the Lava Crossing. It stays warm, thanks to island magic.',
  ),
  crystal(
    'fh-crystal-cavern',
    'Cavern Crystal',
    'A blue crystal from the Crystal Caverns. It twinkles in the dark.',
  ),
  crystal(
    'fh-crystal-forge',
    'Forge Crystal',
    'A golden crystal from the Ancient Forge. It hums like a tiny machine.',
  ),
  ...SHARD_ZONES.map(([zone, name, place]): ItemDefinition => ({
    id: `fh-shard-item-${zone}`,
    displayName: `Ember Shard: ${name}`,
    description: `A little glowing shard you found at ${place}.`,
    category: 'COLLECTIBLE',
    rarity: zone === 'landing' ? 'COMMON' : 'UNCOMMON',
    setId: HEART_SHARDS_SET_ID,
    ...(zone === 'emberwood' || zone === 'lava' || zone === 'caverns' ? { hidden: true } : {}),
  })),
  badge(
    'fh-badge-first-steps',
    'First Steps into Firepeak',
    'For reading the map and starting the journey.',
  ),
  badge(
    'fh-badge-emberwood-explorer',
    'Emberwood Explorer',
    'For finding the way through Emberwood Forest.',
  ),
  badge(
    'fh-badge-lava-jumper',
    'Lava Jumper',
    'For finding the shard at the end of the stepping stones.',
  ),
  badge(
    'fh-badge-crystal-collector',
    'Crystal Collector',
    'For gathering all four elemental crystals.',
    'UNCOMMON',
  ),
  badge(
    'fh-badge-forge-master',
    'Master of the Forge',
    'For waking the old machines of the Ancient Forge.',
  ),
  badge(
    'fh-badge-volcano-scientist',
    'Volcano Scientist',
    'For learning how real volcanoes, rocks and islands work.',
  ),
  badge('fh-badge-summit-explorer', 'Summit Explorer', 'For reaching the top of Firepeak.'),
  badge(
    'fh-badge-heart-of-firepeak',
    'Heart of Firepeak',
    'For lighting the Heart of Firepeak again.',
    'UNCOMMON',
  ),
  badge(
    'fh-badge-master-explorer',
    'Firepeak Master Explorer',
    'For finding every ember shard on the mountain.',
    'RARE',
  ),
  journal(
    'fh-journal-magma',
    'Magma and lava',
    'Magma is hot melted rock underground. When it comes out of a volcano, it is called lava.',
  ),
  journal(
    'fh-journal-rocks',
    'Volcanic rocks',
    'Basalt, pumice and obsidian are igneous rocks. They form when lava cools.',
  ),
  journal(
    'fh-journal-volcano-layers',
    'Volcano layers',
    'A volcano grows when lava and ash from eruptions pile up in layers and harden.',
  ),
  journal(
    'fh-journal-island',
    'How volcano islands form',
    'Some islands, like Hawaii, grew as eruptions built up layers of rock until the volcano rose above the sea.',
  ),
];

export const HEART_COLLECTIBLE_SETS: readonly CollectibleSet[] = [
  {
    id: HEART_CRYSTALS_SET_ID,
    displayName: 'Elemental Crystals',
    completionMessage: 'All four elemental crystals are yours!',
    itemIds: ['fh-crystal-forest', 'fh-crystal-magma', 'fh-crystal-cavern', 'fh-crystal-forge'],
    completionItemId: 'fh-badge-crystal-collector',
  },
  {
    id: HEART_SHARDS_SET_ID,
    displayName: 'Ember Shards',
    completionMessage: 'You found every ember shard on Firepeak!',
    itemIds: SHARD_ZONES.map(([zone]) => `fh-shard-item-${zone}`),
    completionItemId: 'fh-badge-master-explorer',
  },
];

/* ------------------------------------------------------------------ reward rules */

const rule = (
  id: string,
  changeKey: string,
  itemIds: readonly string[],
  message: string,
): RewardTable[number] => ({
  id,
  trigger: { type: 'WORLD_CHANGE', changeKey },
  itemIds,
  message,
});

export const HEART_REWARD_RULES: RewardTable = [
  rule(
    'fh-rule-first-steps',
    K.mapRead,
    ['fh-badge-first-steps'],
    'You earned First Steps into Firepeak!',
  ),
  rule(
    'fh-rule-emberwood',
    K.emberwoodDone,
    ['fh-crystal-forest', 'fh-badge-emberwood-explorer'],
    'You earned the Forest Crystal and the Emberwood Explorer badge!',
  ),
  rule('fh-rule-lava', K.lavaCrossed, ['fh-crystal-magma'], 'You earned the Magma Crystal!'),
  rule(
    'fh-rule-caverns',
    K.cavernLit,
    ['fh-crystal-cavern', 'fh-journal-rocks'],
    'You earned the Cavern Crystal and a new page for your journal about volcanic rocks!',
  ),
  rule(
    'fh-rule-forge',
    K.forgeRestored,
    ['fh-crystal-forge', 'fh-badge-forge-master'],
    'You earned the Forge Crystal and the Master of the Forge badge!',
  ),
  rule(
    'fh-rule-scientist',
    K.summitReached,
    [
      'fh-badge-volcano-scientist',
      'fh-journal-magma',
      'fh-journal-volcano-layers',
      'fh-journal-island',
    ],
    'You earned the Volcano Scientist badge and three new journal pages!',
  ),
  rule(
    'fh-rule-heart',
    K.celebrated,
    ['fh-badge-heart-of-firepeak'],
    'You earned the Heart of Firepeak badge!',
  ),
  ...SHARD_ZONES.map(([zone, name]) =>
    rule(
      `fh-rule-shard-${zone}`,
      `FIREPEAK_HEART_SHARD_${zone.toUpperCase()}`,
      [
        `fh-shard-item-${zone}`,
        ...(zone === 'lava' ? ['fh-badge-lava-jumper'] : []),
        ...(zone === 'summit' ? ['fh-badge-summit-explorer'] : []),
      ],
      zone === 'lava'
        ? 'You found the Lava Jumper shard and earned the Lava Jumper badge!'
        : zone === 'summit'
          ? 'You found the Summit shard and earned the Summit Explorer badge!'
          : `You found the ${name} ember shard!`,
    ),
  ),
];

/* ------------------------------------------------------------------ quest */

const objective = (stageId: string, key: string, changeKey: string, label: string) => ({
  id: `${stageId}-${key}`,
  label,
  kind: 'BUILD' as const,
  changeKey,
});

export const HEART_QUESTS: readonly QuestDefinition[] = [
  {
    id: HEART_QUEST_ID,
    title: 'The Heart of Firepeak',
    summary: 'Help Flint light the Heart of Firepeak again.',
    giverNpcId: HEART_NPC_IDS.flint,
    ageBands: [...BANDS],
    prerequisites: [{ type: 'ALWAYS' }],
    entryStageId: 'fh-stage-landing',
    stages: [
      {
        id: 'fh-stage-landing',
        title: 'Read the map at Explorer’s Landing',
        objectives: [objective('fh-stage-landing', 'map', K.mapRead, 'Find places on Flint’s map')],
        nextStageId: 'fh-stage-emberwood',
      },
      {
        id: 'fh-stage-emberwood',
        title: 'Cross Emberwood Forest',
        objectives: [
          objective(
            'fh-stage-emberwood',
            'pattern',
            K.patternSolved,
            'Continue the crystal pattern',
          ),
          objective('fh-stage-emberwood', 'count', K.emberwoodDone, 'Count the embers'),
        ],
        nextStageId: 'fh-stage-lava',
      },
      {
        id: 'fh-stage-lava',
        title: 'Cross the lava river',
        objectives: [
          objective(
            'fh-stage-lava',
            'bridge',
            K.lavaBridge,
            'Solve the numbers to raise the bridge',
          ),
          objective(
            'fh-stage-lava',
            'crossed',
            K.lavaCrossed,
            'Choose the right path to the far bank',
          ),
        ],
        nextStageId: 'fh-stage-caverns',
      },
      {
        id: 'fh-stage-caverns',
        title: 'Light the Crystal Caverns',
        objectives: [
          objective(
            'fh-stage-caverns',
            'shapes',
            K.shapesMatched,
            'Match the crystals to their shapes',
          ),
          objective(
            'fh-stage-caverns',
            'lit',
            K.cavernLit,
            'Arrange the crystals to light the cavern',
          ),
        ],
        nextStageId: 'fh-stage-forge',
      },
      {
        id: 'fh-stage-forge',
        title: 'Restore the Ancient Forge',
        objectives: [
          objective(
            'fh-stage-forge',
            'powered',
            K.forgePowered,
            'Press the switches in the right order',
          ),
          objective('fh-stage-forge', 'restored', K.forgeRestored, 'Complete the circuit'),
        ],
        nextStageId: 'fh-stage-summit',
      },
      {
        id: 'fh-stage-summit',
        title: 'Climb Firepeak Summit',
        objectives: [
          objective('fh-stage-summit', 'rocks', K.rocksNamed, 'Learn about the rock samples'),
          objective(
            'fh-stage-summit',
            'reached',
            K.summitReached,
            'Tell how a volcano island forms',
          ),
        ],
        nextStageId: 'fh-stage-heart',
      },
      {
        id: 'fh-stage-heart',
        title: 'Light the Heart',
        objectives: [
          objective('fh-stage-heart', 'crystals', K.crystalsSet, 'Set the crystals in order'),
          objective('fh-stage-heart', 'restored', K.restored, 'Restore the Heart'),
          objective(
            'fh-stage-heart',
            'celebrated',
            K.celebrated,
            'Tell Ignis the Heart is glowing',
          ),
        ],
      },
    ],
    completion: {
      journalNote:
        'You crossed Firepeak, learned real volcano science from Professor Basalt, and lit the Heart of Firepeak again.',
      worldChanges: [
        { locationSlug: HEART_PLACE_SLUG, changeType: 'UNLOCK', changeKey: K.complete },
      ],
    },
  },
];

/** Added to the home Island's content pack in the export only (`build.ts`). */
export const HEART_PACK_ADDITIONS = {
  worldSlug: HOME_WORLD_SLUG,
  locationSlugs: [HEART_PLACE_SLUG],
  questIds: [HEART_QUEST_ID],
  npcIds: HEART_NPCS.map((npc) => npc.id),
  itemIds: HEART_ITEMS.map((item) => item.id),
  collectibleSetIds: [HEART_CRYSTALS_SET_ID, HEART_SHARDS_SET_ID],
} as const;
