import type { AdventureDefinition } from '../engine/types';

/**
 * The two Adventure Engine challenges embedded in "Save the Butterfly
 * Garden", the Adventure Library's nature arc (docs/ROADMAP.md Phase 15,
 * `docs/LEARNING_ADVENTURE_ISLAND_EXPLORABLE_WORLD_ROADMAP.md` section 34).
 * `locationSlug: 'butterfly-garden'` is a story-only pseudo-location
 * matching no entry in `src/features/island/locations.ts`, same precedent
 * as every other embedded arc challenge.
 *
 * These are the first authored adventures in the repository to include the
 * **Sprout** band (ages 3-4), so they are shaped by CLAUDE.md section 3's
 * rules for that band rather than copied from the Pathfinder adventures:
 * every graded step is a single `CHOICE` with three picture-sized options
 * (a one-step decision), there is no `NUMBER_INPUT` (a Sprout is not
 * expected to type a numeral) and no `ORDERING` (its up/down reordering is
 * a multi-step manipulation), prompts are one short sentence, and each
 * adventure is four steps long so a full run fits inside a 5-8 minute
 * session. Counting still happens, but as "which picture shows two
 * butterflies", not as arithmetic.
 *
 * Sources (docs/CONTENT_SOURCES.md):
 * - Butterflies feed mainly on nectar, the sweet liquid inside flowers,
 *   which they drink through a long tube-shaped mouthpart (the proboscis)
 *   that curls up when not in use. Standard entomology; checked against
 *   general science-communication consensus on 2026-08-17.
 * - A butterfly's life cycle runs egg, caterpillar, chrysalis, butterfly,
 *   in that order (complete metamorphosis). Standard entomology; checked
 *   2026-08-17.
 * - Caterpillars eat leaves, and many species can only eat particular host
 *   plants, which is why a garden needs leafy plants as well as flowers to
 *   support butterflies. Standard entomology and widely published garden
 *   guidance; checked 2026-08-17.
 */

export const BUTTERFLY_CHAPTER_1_QUIET_GARDEN: AdventureDefinition = {
  slug: 'butterfly-chapter-1-quiet-garden',
  version: 1,
  title: 'The Quiet Garden',
  locationSlug: 'butterfly-garden',
  ageBands: ['SPROUT', 'PATHFINDER'],
  entryStepId: 'the-garden-is-quiet',
  steps: [
    {
      id: 'the-garden-is-quiet',
      type: 'NARRATIVE',
      objectiveIds: [],
      presentation: {
        kind: 'narrative',
        speaker: 'Chatty the Parrot',
        text: 'This garden used to be full of butterflies. Today it is very quiet. Let’s look and see why.',
      },
      transitions: [{ when: 'always', nextStepId: 'count-the-butterflies' }],
      fallback: { text: 'The butterfly garden is very quiet today.' },
    },
    {
      id: 'count-the-butterflies',
      type: 'CHOICE',
      objectiveIds: ['counting-sets'],
      presentation: {
        kind: 'choice',
        prompt: 'Only one butterfly is left, resting on a stone. How many butterflies do you see?',
        options: [
          { id: 'one', label: 'One butterfly' },
          { id: 'two', label: 'Two butterflies' },
          { id: 'three', label: 'Three butterflies' },
        ],
        correctOptionId: 'one',
      },
      transitions: [
        { when: 'correct', nextStepId: 'what-butterflies-drink' },
        { when: 'incorrect', nextStepId: 'count-the-butterflies' },
      ],
      hintPolicy: {
        ladder: [
          'Let’s count together.',
          'Look at the flat grey stone.',
          'Point at each butterfly you can see.',
          'There is just one butterfly on the stone.',
          'The answer is one butterfly. Tap "One butterfly".',
        ],
      },
      fallback: { text: 'There is one butterfly left in the garden.' },
    },
    {
      id: 'what-butterflies-drink',
      type: 'CHOICE',
      objectiveIds: ['animal-science'],
      presentation: {
        kind: 'choice',
        prompt: 'Butterflies drink something sweet from inside flowers. What is it called?',
        options: [
          { id: 'nectar', label: 'Nectar' },
          { id: 'sand', label: 'Sand' },
          { id: 'stones', label: 'Stones' },
        ],
        correctOptionId: 'nectar',
      },
      transitions: [
        { when: 'correct', nextStepId: 'the-empty-beds' },
        { when: 'incorrect', nextStepId: 'what-butterflies-drink' },
      ],
      hintPolicy: {
        ladder: [
          'Good wondering! It is a drink.',
          'It is sweet, like juice.',
          'It hides deep inside a flower.',
          'It starts with the sound "nnn".',
          'It is called nectar. Tap "Nectar".',
        ],
      },
      fallback: { text: 'Butterflies drink sweet nectar from flowers.' },
    },
    {
      id: 'the-empty-beds',
      type: 'NARRATIVE',
      objectiveIds: [],
      presentation: {
        kind: 'narrative',
        speaker: 'Chatty the Parrot',
        text: 'Now we know. The flower beds are empty, so there is no nectar to drink. No wonder the butterflies flew away.',
      },
      transitions: [{ when: 'always', nextStepId: 'garden-understood' }],
      fallback: { text: 'The flower beds are empty, so there is no nectar.' },
    },
    {
      id: 'garden-understood',
      type: 'WORLD_CHANGE',
      objectiveIds: [],
      presentation: {
        kind: 'world-change',
        text: 'A little sign now stands by the garden gate: "Empty beds. Flowers needed."',
        payload: {
          changeType: 'CREATE',
          changeKey: 'BUTTERFLY_GARDEN_SURVEYED',
          locationSlug: 'butterfly-garden',
        },
      },
      transitions: [{ when: 'always', nextStepId: 'complete' }],
      fallback: { text: 'There is a new sign by the garden gate.' },
    },
    {
      id: 'complete',
      type: 'COMPLETE',
      objectiveIds: [],
      presentation: {
        kind: 'complete',
        text: 'You worked out why the garden is quiet. Next, let’s fill it with flowers.',
      },
      transitions: [],
      fallback: { text: 'You worked out why the garden is quiet!' },
    },
  ],
};

export const BUTTERFLY_CHAPTER_2_PLANT_THE_FLOWERS: AdventureDefinition = {
  slug: 'butterfly-chapter-2-plant-the-flowers',
  version: 1,
  title: 'Plant the Flowers',
  locationSlug: 'butterfly-garden',
  ageBands: ['SPROUT', 'PATHFINDER'],
  entryStepId: 'seeds-in-hand',
  steps: [
    {
      id: 'seeds-in-hand',
      type: 'NARRATIVE',
      objectiveIds: [],
      presentation: {
        kind: 'narrative',
        speaker: 'Chatty the Parrot',
        text: 'Here is a bag of seeds and a watering can. Let’s plant this garden back to life.',
      },
      transitions: [{ when: 'always', nextStepId: 'what-grows-nectar' }],
      fallback: { text: 'We have seeds and a watering can.' },
    },
    {
      id: 'what-grows-nectar',
      type: 'CHOICE',
      objectiveIds: ['cause-and-effect'],
      presentation: {
        kind: 'choice',
        prompt: 'Which one should we plant so butterflies have nectar to drink?',
        options: [
          { id: 'flower-seeds', label: 'Flower seeds' },
          { id: 'paper-flags', label: 'Paper flags' },
          { id: 'pebbles', label: 'Pebbles' },
        ],
        correctOptionId: 'flower-seeds',
      },
      transitions: [
        { when: 'correct', nextStepId: 'life-cycle-first' },
        { when: 'incorrect', nextStepId: 'what-grows-nectar' },
      ],
      hintPolicy: {
        ladder: [
          'You remember where nectar hides.',
          'Nectar is inside real flowers.',
          'We need something that will grow.',
          'Paper and pebbles never grow into flowers.',
          'Flower seeds grow real flowers. Tap "Flower seeds".',
        ],
      },
      fallback: { text: 'Flower seeds grow real flowers full of nectar.' },
    },
    {
      id: 'life-cycle-first',
      type: 'CHOICE',
      objectiveIds: ['sequencing'],
      presentation: {
        kind: 'choice',
        prompt: 'A butterfly starts very small. What comes first of all?',
        options: [
          { id: 'egg', label: 'A tiny egg' },
          { id: 'caterpillar', label: 'A hungry caterpillar' },
          { id: 'butterfly', label: 'A flying butterfly' },
        ],
        correctOptionId: 'egg',
      },
      transitions: [
        { when: 'correct', nextStepId: 'leaves-for-caterpillars' },
        { when: 'incorrect', nextStepId: 'life-cycle-first' },
      ],
      hintPolicy: {
        ladder: [
          'Let’s think about the very beginning.',
          'Which one is the smallest of all?',
          'The caterpillar has to come out of something.',
          'It comes out of a tiny egg on a leaf.',
          'A tiny egg comes first. Tap "A tiny egg".',
        ],
      },
      fallback: { text: 'A butterfly starts as a tiny egg.' },
    },
    {
      id: 'leaves-for-caterpillars',
      type: 'NARRATIVE',
      objectiveIds: [],
      presentation: {
        kind: 'narrative',
        speaker: 'Chatty the Parrot',
        text: 'So we need leafy plants too, for the caterpillars to munch, and flowers for the butterflies to drink from. In go the seeds, and out comes the water.',
        aiNarrated: true,
      },
      transitions: [{ when: 'always', nextStepId: 'garden-replanted' }],
      fallback: { text: 'We plant leafy plants for caterpillars and flowers for butterflies.' },
    },
    {
      id: 'garden-replanted',
      type: 'WORLD_CHANGE',
      objectiveIds: [],
      presentation: {
        kind: 'world-change',
        text: 'The butterfly garden is planted again, with rows of flowers and leafy green plants.',
        payload: {
          changeType: 'RESTORE',
          changeKey: 'BUTTERFLY_GARDEN_REPLANTED',
          locationSlug: 'butterfly-garden',
        },
      },
      transitions: [{ when: 'always', nextStepId: 'complete' }],
      fallback: { text: 'The butterfly garden is planted again.' },
    },
    {
      id: 'complete',
      type: 'COMPLETE',
      objectiveIds: [],
      presentation: {
        kind: 'complete',
        text: 'You planted the whole garden! Now we wait and watch.',
      },
      transitions: [],
      fallback: { text: 'You planted the whole garden!' },
    },
  ],
};

export const BUTTERFLY_GARDEN_ADVENTURES: AdventureDefinition[] = [
  BUTTERFLY_CHAPTER_1_QUIET_GARDEN,
  BUTTERFLY_CHAPTER_2_PLANT_THE_FLOWERS,
];
