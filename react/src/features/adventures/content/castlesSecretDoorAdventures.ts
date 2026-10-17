import type { AdventureDefinition } from '../engine/types';

/**
 * The two Adventure Engine challenges embedded in "The Castle's Secret
 * Door", the Adventure Library's mystery arc (docs/ROADMAP.md Phase 15,
 * `docs/LEARNING_ADVENTURE_ISLAND_EXPLORABLE_WORLD_ROADMAP.md` section 34).
 * `locationSlug: 'castle-secret-passage'` is a story-only pseudo-location:
 * it deliberately does not reuse `storykeeper-castle`, because an
 * adventure carrying a real location slug would show up as that location's
 * card-based adventure on `IslandLocationPage`, ahead of or instead of the
 * location's own authored adventure. Arc challenges are only ever reachable
 * through the Story Engine.
 *
 * Scoped to Explorers only (ages 7-8): the mystery turns on reading a
 * written clue and holding three separate pieces of evidence in mind at
 * once, which is squarely the Explorer band's "multi-stage missions" and
 * reading-comprehension profile (CLAUDE.md section 3). This is the only arc
 * in the launch library authored for that band alone, so it is also what
 * makes the library's age gate visible: a Pathfinder sees four arcs, not
 * five.
 *
 * The mystery stays gentle by construction. Nothing is frightening behind
 * the door, no one is in danger, and the "secret" is a kindness the
 * castle's old Storykeepers left behind, not a threat
 * (docs/UX_AND_ACCESSIBILITY.md's calm-engagement rules).
 */

export const SECRET_DOOR_CHAPTER_1_THREE_CLUES: AdventureDefinition = {
  slug: 'secret-door-chapter-1-three-clues',
  version: 1,
  title: 'Three Clues',
  locationSlug: 'castle-secret-passage',
  ageBands: ['EXPLORER'],
  entryStepId: 'the-door-with-no-handle',
  steps: [
    {
      id: 'the-door-with-no-handle',
      type: 'NARRATIVE',
      objectiveIds: [],
      presentation: {
        kind: 'narrative',
        speaker: 'Keeper Quill',
        text: 'Behind the last bookshelf there is a door with no handle, no keyhole, and no hinges you can see. I have never opened it. Perhaps you can.',
      },
      transitions: [{ when: 'always', nextStepId: 'read-the-note' }],
      fallback: { text: 'There is a door with no handle behind the last bookshelf.' },
    },
    {
      id: 'read-the-note',
      type: 'CHOICE',
      objectiveIds: ['reading-comprehension'],
      presentation: {
        kind: 'choice',
        prompt:
          'A folded note is tucked into the frame. It reads: "The door has no handle, for it is not pulled. It listens for the pattern of the stars above it." What does the note tell us to look for?',
        options: [
          { id: 'a-pattern', label: 'A pattern in the carved stars above the door' },
          { id: 'a-hidden-key', label: 'A key hidden somewhere in the library' },
          { id: 'a-magic-word', label: 'A magic word to shout at the door' },
        ],
        correctOptionId: 'a-pattern',
      },
      transitions: [
        { when: 'correct', nextStepId: 'order-the-clues' },
        { when: 'incorrect', nextStepId: 'read-the-note' },
      ],
      hintPolicy: {
        ladder: [
          'Good reading! Let’s look at the note again.',
          'The note says the door is "not pulled", so it is not about handles or keys.',
          'It says the door "listens for" something.',
          'Read the last three words: "the stars above it".',
          'The note points to a pattern in the carved stars. Choose that one.',
        ],
      },
      fallback: { text: 'The note points to a pattern in the carved stars above the door.' },
    },
    {
      id: 'order-the-clues',
      type: 'ORDERING',
      objectiveIds: ['sequencing'],
      presentation: {
        kind: 'ordering',
        prompt:
          'Three clues were left behind, each dated. Put them in the order they were written.',
        items: [
          { id: 'clue-map', label: 'A map of the library, marked "the last shelf"' },
          { id: 'clue-note', label: 'The folded note about the stars' },
          { id: 'clue-diary', label: 'A diary page: "Today we built a door"' },
        ],
        correctOrder: ['clue-diary', 'clue-map', 'clue-note'],
      },
      transitions: [
        { when: 'correct', nextStepId: 'count-the-stars' },
        { when: 'incorrect', nextStepId: 'order-the-clues' },
      ],
      hintPolicy: {
        ladder: [
          'Nice work. Think about the story these clues tell.',
          'Something has to be built before anyone can write directions to it.',
          'The diary page is about building the door, so it came first.',
          'Then someone marked the shelf on a map.',
          'Diary page, then map, then the note about the stars.',
        ],
      },
      fallback: { text: 'The diary page came first, then the map, then the note.' },
    },
    {
      id: 'count-the-stars',
      type: 'NUMBER_INPUT',
      objectiveIds: ['addition-within-ten'],
      presentation: {
        kind: 'number-input',
        prompt:
          'Above the door there are 5 carved stars in the top row and 4 in the bottom row. How many carved stars are there altogether?',
        correctValue: 9,
      },
      transitions: [
        { when: 'correct', nextStepId: 'clues-narration' },
        { when: 'incorrect', nextStepId: 'count-the-stars' },
      ],
      hintPolicy: {
        ladder: [
          'You can do this. There are two rows to add.',
          'Hold the 5 from the top row in your head.',
          'Count on 4 more: 6, 7, 8, 9.',
          '5 and 4 make nine.',
          'There are 9 carved stars. Type 9 to keep going.',
        ],
      },
      fallback: { text: '5 stars and 4 stars make 9 carved stars.' },
    },
    {
      id: 'clues-narration',
      type: 'NARRATIVE',
      objectiveIds: [],
      presentation: {
        kind: 'narrative',
        speaker: 'Keeper Quill',
        text: 'Nine stars, three clues, and a door that listens. You have found more in one afternoon than I have in years.',
      },
      transitions: [{ when: 'always', nextStepId: 'clues-collected' }],
      fallback: { text: 'You have gathered all three clues.' },
    },
    {
      id: 'clues-collected',
      type: 'WORLD_CHANGE',
      objectiveIds: [],
      presentation: {
        kind: 'world-change',
        text: 'The three clues are pinned side by side on the library wall, under the nine carved stars.',
        payload: {
          changeType: 'CREATE',
          changeKey: 'SECRET_DOOR_CLUES_COLLECTED',
          locationSlug: 'castle-secret-passage',
        },
      },
      transitions: [{ when: 'always', nextStepId: 'complete' }],
      fallback: { text: 'The three clues are pinned on the library wall.' },
    },
    {
      id: 'complete',
      type: 'COMPLETE',
      objectiveIds: [],
      presentation: {
        kind: 'complete',
        text: 'You gathered every clue! Now you know what the door is waiting for: a pattern.',
      },
      transitions: [],
      fallback: { text: 'You gathered every clue!' },
    },
  ],
};

export const SECRET_DOOR_CHAPTER_2_PATTERN_LOCK: AdventureDefinition = {
  slug: 'secret-door-chapter-2-pattern-lock',
  version: 1,
  title: 'The Pattern Lock',
  locationSlug: 'castle-secret-passage',
  ageBands: ['EXPLORER'],
  entryStepId: 'study-the-stars',
  steps: [
    {
      id: 'study-the-stars',
      type: 'NARRATIVE',
      objectiveIds: [],
      presentation: {
        kind: 'narrative',
        speaker: 'Keeper Quill',
        text: 'Look closely at the carvings. They are not all stars. Star, moon, star, moon, star, and then one carving worn too smooth to read.',
      },
      transitions: [{ when: 'always', nextStepId: 'continue-the-pattern' }],
      fallback: { text: 'The carvings go star, moon, star, moon, star, and then one worn smooth.' },
    },
    {
      id: 'continue-the-pattern',
      type: 'CHOICE',
      objectiveIds: ['patterns'],
      presentation: {
        kind: 'choice',
        prompt: 'Star, moon, star, moon, star. Which carving must the worn one be?',
        options: [
          { id: 'moon', label: 'A moon' },
          { id: 'star', label: 'A star' },
          { id: 'sun', label: 'A sun' },
        ],
        correctOptionId: 'moon',
      },
      transitions: [
        { when: 'correct', nextStepId: 'order-the-keys' },
        { when: 'incorrect', nextStepId: 'continue-the-pattern' },
      ],
      hintPolicy: {
        ladder: [
          'You are close. Say the carvings out loud in order.',
          'Star, moon, star, moon, star.',
          'Two shapes keep taking turns.',
          'Every star is followed by a moon.',
          'The worn carving is a moon. Choose the moon.',
        ],
      },
      fallback: { text: 'The pattern takes turns, so the worn carving is a moon.' },
    },
    {
      id: 'order-the-keys',
      type: 'ORDERING',
      objectiveIds: ['measurement'],
      presentation: {
        kind: 'ordering',
        prompt:
          'Three slots open in the door, each a different depth. Put the rods in order from shortest to longest.',
        items: [
          { id: 'long-rod', label: 'The long brass rod' },
          { id: 'medium-rod', label: 'The medium iron rod' },
          { id: 'short-rod', label: 'The short silver rod' },
        ],
        correctOrder: ['short-rod', 'medium-rod', 'long-rod'],
      },
      transitions: [
        { when: 'correct', nextStepId: 'what-does-ajar-mean' },
        { when: 'incorrect', nextStepId: 'order-the-keys' },
      ],
      hintPolicy: {
        ladder: [
          'Careful measuring wins here.',
          'Hold the rods side by side in your mind.',
          'Which rod would disappear into the deepest slot?',
          'The silver rod is shortest and the brass rod is longest.',
          'Short silver, then medium iron, then long brass.',
        ],
      },
      fallback: { text: 'Short silver, then medium iron, then long brass.' },
    },
    {
      id: 'what-does-ajar-mean',
      type: 'CHOICE',
      objectiveIds: ['vocabulary'],
      presentation: {
        kind: 'choice',
        prompt: 'The door swings ajar. What does "ajar" mean?',
        options: [
          { id: 'open-a-little', label: 'Open a little way' },
          { id: 'locked-tight', label: 'Locked tight' },
          { id: 'painted-blue', label: 'Painted blue' },
        ],
        correctOptionId: 'open-a-little',
      },
      transitions: [
        { when: 'correct', nextStepId: 'door-opens-narration' },
        { when: 'incorrect', nextStepId: 'what-does-ajar-mean' },
      ],
      hintPolicy: {
        ladder: [
          'New word! Let’s work it out from the sentence.',
          'The door swings, so something is moving.',
          'A locked door cannot swing at all.',
          'It is open, but only a little way.',
          '"Ajar" means open a little way. Choose that one.',
        ],
      },
      fallback: { text: '"Ajar" means open a little way.' },
    },
    {
      id: 'door-opens-narration',
      type: 'NARRATIVE',
      objectiveIds: [],
      presentation: {
        kind: 'narrative',
        speaker: 'Keeper Quill',
        text: 'The rods slide home, the moon carving glows for a moment, and the door swings ajar. Warm light spills out across the library floor.',
        aiNarrated: true,
      },
      transitions: [{ when: 'always', nextStepId: 'door-opened' }],
      fallback: { text: 'The door swings ajar and warm light spills out.' },
    },
    {
      id: 'door-opened',
      type: 'WORLD_CHANGE',
      objectiveIds: [],
      presentation: {
        kind: 'world-change',
        text: 'The secret door stands open, and the passage behind it is lit again.',
        payload: {
          changeType: 'UNLOCK',
          changeKey: 'CASTLE_SECRET_DOOR_OPENED',
          locationSlug: 'castle-secret-passage',
        },
      },
      transitions: [{ when: 'always', nextStepId: 'complete' }],
      fallback: { text: 'The secret door stands open.' },
    },
    {
      id: 'complete',
      type: 'COMPLETE',
      objectiveIds: [],
      presentation: {
        kind: 'complete',
        text: 'You solved the pattern lock and opened the door! Time to see what is inside.',
      },
      transitions: [],
      fallback: { text: 'You opened the secret door!' },
    },
  ],
};

export const CASTLES_SECRET_DOOR_ADVENTURES: AdventureDefinition[] = [
  SECRET_DOOR_CHAPTER_1_THREE_CLUES,
  SECRET_DOOR_CHAPTER_2_PATTERN_LOCK,
];
