import type { AdventureDefinition } from '../engine/types';

/**
 * Creature Care Cove's adventures (docs/ROADMAP.md Phase 29, "world-specific
 * assets and rules built on the shared curriculum, mastery, quest,
 * inventory, and tutor engines from Phases 19 to 27, so a new island is
 * primarily a content-authoring task").
 *
 * This file is the evidence for that claim. A whole new world arrives here
 * as three `AdventureDefinition`s in the existing format, using the existing
 * step types, the existing learning objectives, the existing hint ladder,
 * and the existing world-change payload. Nothing in the Adventure Engine,
 * the Mastery Engine, the Quest Engine, or the Tutor knows the cove exists,
 * and none of them needed to change for it to be playable.
 *
 * All three are **the same act at three bands**: helping Nella through the
 * morning care round. That is why all three record the same
 * `COVE_CREATURES_FED` world change, following the precedent
 * `THREE_PLANKS_FOR_THE_BRIDGE` set for the bay ("the same act at a younger
 * band reuses the key"), rather than the precedent
 * `THE_TIDE_GATE_CALCULATION` set ("a different act at the same place earns
 * its own key"). It matters beyond tidiness: the cove's quest and its reward
 * rules both hang off that one key, so a Sprout, a Pathfinder, and an
 * Explorer all reach the same payoff by doing the work their own band was
 * authored for.
 *
 * Nella the cove keeper is a `speaker`, not an `NpcDefinition`. The cove has
 * no explorable Phaser map yet, and Phase 23's NPC memory, relationships,
 * and dialogue trees are only reachable from inside a world view, so
 * authoring Nella as an NPC would have put a character on the island whom no
 * child could talk to. See the Phase 29 known limitations in
 * docs/IMPLEMENTATION_STATUS.md.
 */

/** Ages 3 to 4: one decision per step, pictures to count, and no typing. */
export const BREAKFAST_AT_THE_COVE: AdventureDefinition = {
  slug: 'breakfast-at-the-cove',
  version: 1,
  title: 'Breakfast at the Cove',
  locationSlug: 'cove-care-beach',
  ageBands: ['SPROUT'],
  entryStepId: 'nella-says-hello',
  steps: [
    {
      id: 'nella-says-hello',
      type: 'NARRATIVE',
      objectiveIds: [],
      presentation: {
        kind: 'narrative',
        speaker: 'Nella the cove keeper',
        text: 'Good morning! Everyone here is hungry, and I only have two hands. Will you help me feed them?',
      },
      transitions: [{ when: 'always', nextStepId: 'which-bucket' }],
      fallback: { text: 'Nella needs help feeding the creatures at the cove.' },
    },
    {
      id: 'which-bucket',
      type: 'CHOICE',
      objectiveIds: ['classification'],
      presentation: {
        kind: 'choice',
        prompt: 'The little sea turtle eats green weed. Which bucket should we bring her?',
        options: [
          { id: 'weed', label: 'The bucket of green weed' },
          { id: 'fish', label: 'The bucket of silver fish' },
          { id: 'shells', label: 'The bucket of round shells' },
        ],
        correctOptionId: 'weed',
      },
      transitions: [
        { when: 'correct', nextStepId: 'how-many-fish' },
        { when: 'incorrect', nextStepId: 'which-bucket' },
      ],
      hintPolicy: {
        ladder: [
          'Look at the buckets. One of them is green.',
          'The turtle eats green weed, so we want the green one.',
          'The bucket of green weed is the one. Tap it to bring it over.',
        ],
      },
      fallback: { text: 'The turtle eats the green weed.' },
    },
    {
      id: 'how-many-fish',
      type: 'CHOICE',
      objectiveIds: ['counting-sets'],
      presentation: {
        kind: 'choice',
        prompt: 'Two crabs are waiting, and each crab gets one fish. How many fish do we need?',
        options: [
          { id: 'one', label: '1 fish', groups: [1] },
          { id: 'two', label: '2 fish', groups: [1, 1] },
          { id: 'three', label: '3 fish', groups: [1, 1, 1] },
        ],
        correctOptionId: 'two',
      },
      transitions: [
        { when: 'correct', nextStepId: 'the-sleeping-seal' },
        { when: 'incorrect', nextStepId: 'how-many-fish' },
      ],
      hintPolicy: {
        ladder: [
          'Count the crabs with me. One crab, two crabs.',
          'Each crab gets one fish, so we need the same number of fish as crabs.',
          'There are two crabs, so we need 2 fish. Tap the two fish.',
        ],
      },
      fallback: { text: 'Two crabs need 2 fish.' },
    },
    {
      id: 'the-sleeping-seal',
      type: 'CHOICE',
      objectiveIds: ['empathy'],
      presentation: {
        kind: 'choice',
        prompt: 'The baby seal is fast asleep in her warm pen. What should we do?',
        options: [
          { id: 'wait', label: 'Leave her food and let her sleep' },
          { id: 'wake', label: 'Wake her up right now' },
          { id: 'skip', label: 'Take her food away again' },
        ],
        correctOptionId: 'wait',
      },
      transitions: [
        { when: 'correct', nextStepId: 'nella-is-glad' },
        { when: 'incorrect', nextStepId: 'the-sleeping-seal' },
      ],
      hintPolicy: {
        ladder: [
          'How do you feel when someone wakes you up too soon?',
          'A sleepy seal is a growing seal. Her food can wait for her.',
          'We leave her food and let her sleep. Tap that one.',
        ],
      },
      fallback: { text: 'We leave the food and let the sleeping seal rest.' },
    },
    {
      id: 'nella-is-glad',
      type: 'NARRATIVE',
      objectiveIds: [],
      presentation: {
        kind: 'narrative',
        speaker: 'Nella the cove keeper',
        text: 'Everybody is fed, and nobody got the wrong breakfast. You are a good helper.',
      },
      transitions: [{ when: 'always', nextStepId: 'creatures-fed' }],
      fallback: { text: 'Everyone at the cove has been fed.' },
    },
    {
      id: 'creatures-fed',
      type: 'WORLD_CHANGE',
      objectiveIds: [],
      presentation: {
        kind: 'world-change',
        text: 'The care pens are full of happy noises. Every creature at the cove has had breakfast.',
        payload: {
          changeType: 'UPDATE',
          changeKey: 'COVE_CREATURES_FED',
          locationSlug: 'cove-care-beach',
        },
      },
      transitions: [{ when: 'always', nextStepId: 'complete' }],
      fallback: { text: 'The creatures at the cove have been fed.' },
    },
  ],
};

/** Ages 5 to 6: a few steps, a set to count, and a routine to put in order. */
export const THE_MORNING_CARE_ROUND: AdventureDefinition = {
  slug: 'the-morning-care-round',
  version: 1,
  title: 'The Morning Care Round',
  locationSlug: 'cove-care-beach',
  ageBands: ['PATHFINDER'],
  entryStepId: 'nella-needs-a-hand',
  steps: [
    {
      id: 'nella-needs-a-hand',
      type: 'NARRATIVE',
      objectiveIds: [],
      presentation: {
        kind: 'narrative',
        speaker: 'Nella the cove keeper',
        text: 'Every morning I do the care round: fresh water, food, a check on each pen, and then the log book. Come and do it with me.',
      },
      transitions: [{ when: 'always', nextStepId: 'how-many-buckets' }],
      fallback: { text: 'Nella needs help with the morning care round.' },
    },
    {
      id: 'how-many-buckets',
      type: 'CHOICE',
      objectiveIds: ['counting-sets'],
      presentation: {
        kind: 'choice',
        prompt:
          'There are three care pens, and each pen needs two buckets of fresh water. How many buckets do we carry?',
        options: [
          { id: 'five', label: '5 buckets', groups: [2, 2, 1] },
          { id: 'six', label: '6 buckets', groups: [2, 2, 2] },
          { id: 'seven', label: '7 buckets', groups: [2, 2, 3] },
        ],
        correctOptionId: 'six',
      },
      transitions: [
        { when: 'correct', nextStepId: 'order-the-round' },
        { when: 'incorrect', nextStepId: 'how-many-buckets' },
      ],
      hintPolicy: {
        ladder: [
          'Take your time. Count the pens first, then the buckets each one needs.',
          'Three pens, and every pen wants two buckets.',
          'Count two for the first pen, two for the second, two for the third.',
          'That is 2 and 2 and 2 altogether.',
          'Two, four, six. We carry 6 buckets. Choose that one.',
        ],
      },
      fallback: { text: 'Three pens with two buckets each need 6 buckets.' },
    },
    {
      id: 'order-the-round',
      type: 'ORDERING',
      objectiveIds: ['sequencing'],
      presentation: {
        kind: 'ordering',
        prompt: 'Put the care round in the order Nella does it.',
        items: [
          { id: 'water', label: 'Fill every pen with fresh water' },
          { id: 'feed', label: 'Give each creature its own food' },
          { id: 'check', label: 'Check that everybody looks well' },
          { id: 'log', label: 'Write what happened in the log book' },
        ],
        correctOrder: ['water', 'feed', 'check', 'log'],
      },
      transitions: [
        { when: 'correct', nextStepId: 'the-turtle-tells-us-something' },
        { when: 'incorrect', nextStepId: 'order-the-round' },
      ],
      hintPolicy: {
        ladder: [
          'Think about the very first thing a thirsty creature needs.',
          'Clean water comes before food, so nobody eats in a dirty pen.',
          'After feeding, Nella walks past every pen to see how everyone looks.',
          'Writing it down is always last, because you can only write what already happened.',
          'The order is water, then food, then the check, then the log book.',
        ],
      },
      fallback: { text: 'Water first, then food, then the check, then the log book.' },
    },
    {
      id: 'the-turtle-tells-us-something',
      type: 'CHOICE',
      objectiveIds: ['cause-and-effect'],
      presentation: {
        kind: 'choice',
        prompt:
          'The sea turtle keeps bumping her nose on the shallow end of her pen. What is she telling us?',
        options: [
          { id: 'deeper', label: 'She needs deeper water to swim in' },
          { id: 'hungry', label: 'She wants a second breakfast' },
          { id: 'nothing', label: 'Turtles bump into things for no reason' },
        ],
        correctOptionId: 'deeper',
      },
      transitions: [
        { when: 'correct', nextStepId: 'nella-writes-it-down' },
        { when: 'incorrect', nextStepId: 'the-turtle-tells-us-something' },
      ],
      hintPolicy: {
        ladder: [
          'Watch where she bumps. It is always the shallow end.',
          'A turtle swims. What happens when the water is too shallow to swim in?',
          'She keeps running out of water before she runs out of swimming.',
          'She is asking for deeper water. Choose that answer.',
        ],
      },
      fallback: { text: 'The turtle needs deeper water in her pen.' },
    },
    {
      id: 'nella-writes-it-down',
      type: 'NARRATIVE',
      objectiveIds: [],
      presentation: {
        kind: 'narrative',
        speaker: 'Nella the cove keeper',
        text: 'Water, food, a good look at everyone, and now the log book. I am writing down what you noticed about the turtle. That is how she gets a deeper pen tomorrow.',
      },
      transitions: [{ when: 'always', nextStepId: 'creatures-fed' }],
      fallback: { text: 'Nella writes the care round in her log book.' },
    },
    {
      id: 'creatures-fed',
      type: 'WORLD_CHANGE',
      objectiveIds: [],
      presentation: {
        kind: 'world-change',
        text: 'Every pen at the cove holds clean water and a fed, settled creature. The log book has today on its page.',
        payload: {
          changeType: 'UPDATE',
          changeKey: 'COVE_CREATURES_FED',
          locationSlug: 'cove-care-beach',
        },
      },
      transitions: [{ when: 'always', nextStepId: 'complete' }],
      fallback: { text: 'The creatures at the cove have been cared for.' },
    },
  ],
};

/**
 * Ages 7 to 8: numbers past ten, a two-step calculation, a prediction that
 * has to be reasoned rather than recognised, and a rule to apply. Pitched
 * above the Pathfinder round the same way `THE_TIDE_GATE_CALCULATION` is
 * pitched above `REPAIR_THE_MOONLIGHT_BRIDGE`.
 */
export const THE_COVE_CARE_PLAN: AdventureDefinition = {
  slug: 'the-cove-care-plan',
  version: 1,
  title: 'The Cove Care Plan',
  locationSlug: 'cove-care-beach',
  ageBands: ['EXPLORER'],
  entryStepId: 'the-supply-boat-problem',
  steps: [
    {
      id: 'the-supply-boat-problem',
      type: 'NARRATIVE',
      objectiveIds: [],
      presentation: {
        kind: 'narrative',
        speaker: 'Nella the cove keeper',
        text: 'The supply boat only comes every few days, so I have to plan the food instead of guessing. Work the numbers through with me and we will get it right.',
      },
      transitions: [{ when: 'always', nextStepId: 'food-per-day' }],
      fallback: { text: 'Nella needs help planning the food supply at the cove.' },
    },
    {
      id: 'food-per-day',
      type: 'NUMBER_INPUT',
      objectiveIds: ['measurement'],
      presentation: {
        kind: 'number-input',
        prompt:
          'The log book says the sea turtle eats 14 pieces of food a day and the seal eats 9. How many pieces does the cove use in one day?',
        correctValue: 23,
      },
      transitions: [
        { when: 'correct', nextStepId: 'what-is-left-in-the-crate' },
        { when: 'incorrect', nextStepId: 'food-per-day' },
      ],
      hintPolicy: {
        ladder: [
          'Take your time. Two numbers are given, and you need their total.',
          'One day of food is the turtle’s share added to the seal’s share.',
          'Set it out as 14 + 9.',
          '14 + 6 is 20, and there are 3 more to add.',
          'The cove uses 23 pieces a day. Type 23 to keep going.',
        ],
      },
      fallback: { text: 'The cove uses 23 pieces of food a day.' },
    },
    {
      id: 'what-is-left-in-the-crate',
      type: 'NUMBER_INPUT',
      objectiveIds: ['measurement'],
      presentation: {
        kind: 'number-input',
        prompt:
          'The supply crate started this morning with 40 pieces. After today’s round, how many pieces are left?',
        correctValue: 17,
      },
      transitions: [
        { when: 'correct', nextStepId: 'will-it-last' },
        { when: 'incorrect', nextStepId: 'what-is-left-in-the-crate' },
      ],
      hintPolicy: {
        ladder: [
          'Good. Now take today’s round out of what the crate held.',
          'What is left is the gap between 40 and one day of food, so this is a subtraction.',
          'Set it out as 40 - 23.',
          '23 plus 7 is 30, and 10 more makes 40.',
          'There are 17 pieces left. Type 17 to keep going.',
        ],
      },
      fallback: { text: 'There are 17 pieces of food left in the crate.' },
    },
    {
      id: 'will-it-last',
      type: 'CHOICE',
      objectiveIds: ['cause-and-effect'],
      presentation: {
        kind: 'choice',
        prompt:
          'The supply boat arrives in two more days, and each day costs 23 pieces. What should Nella expect from the 17 pieces left?',
        options: [
          { id: 'short', label: 'The cove will run short before the boat arrives' },
          { id: 'exact', label: 'The food will last exactly until the boat arrives' },
          { id: 'spare', label: 'There will be food left over when the boat arrives' },
        ],
        correctOptionId: 'short',
      },
      transitions: [
        { when: 'correct', nextStepId: 'how-much-to-order' },
        { when: 'incorrect', nextStepId: 'will-it-last' },
      ],
      hintPolicy: {
        ladder: [
          'Compare two numbers: what is left, and what two more days would cost.',
          'Two days at 23 pieces each is 23 + 23.',
          'That is 46 pieces needed, and the crate holds 17.',
          'Is 17 bigger or smaller than 46?',
          '17 is far smaller than 46, so the cove runs short. Choose that answer.',
        ],
      },
      fallback: {
        text: '17 pieces is less than the 46 needed for two days, so the cove would run short.',
      },
    },
    {
      id: 'how-much-to-order',
      type: 'CHOICE',
      objectiveIds: ['following-instructions'],
      presentation: {
        kind: 'choice',
        prompt:
          'Nella’s rule is to order enough for every day until the boat returns, plus one spare day. The boat returns in two days. How many pieces should she order?',
        options: [
          { id: 'forty-six', label: '46 pieces' },
          { id: 'sixty-nine', label: '69 pieces' },
          { id: 'twenty-three', label: '23 pieces' },
        ],
        correctOptionId: 'sixty-nine',
      },
      transitions: [
        { when: 'correct', nextStepId: 'nella-signs-the-order' },
        { when: 'incorrect', nextStepId: 'how-much-to-order' },
      ],
      hintPolicy: {
        ladder: [
          'Read the rule again. It asks for two things added together.',
          'Two days of food, and then one spare day on top.',
          'A day is 23 pieces, so start with 23 + 23 for the two days.',
          'That is 46, and the spare day adds one more 23.',
          '46 + 23 is 69, so she orders 69 pieces. Choose that one.',
        ],
      },
      fallback: { text: 'Two days plus a spare day is 69 pieces.' },
    },
    {
      id: 'nella-signs-the-order',
      type: 'NARRATIVE',
      objectiveIds: [],
      presentation: {
        kind: 'narrative',
        speaker: 'Nella the cove keeper',
        text: 'Sixty nine it is, and a spare day so nobody here ever waits for a boat. You planned that with numbers instead of hoping. That is the whole job.',
      },
      transitions: [{ when: 'always', nextStepId: 'creatures-fed' }],
      fallback: { text: 'Nella orders 69 pieces of food for the cove.' },
    },
    {
      id: 'creatures-fed',
      type: 'WORLD_CHANGE',
      objectiveIds: [],
      presentation: {
        kind: 'world-change',
        text: 'The care round is done and the order is written. Every pen at the cove is fed, and the crate will not run empty.',
        payload: {
          changeType: 'UPDATE',
          changeKey: 'COVE_CREATURES_FED',
          locationSlug: 'cove-care-beach',
        },
      },
      transitions: [{ when: 'always', nextStepId: 'complete' }],
      fallback: { text: 'The creatures at the cove have been cared for.' },
    },
  ],
};

export const CREATURE_CARE_COVE_ADVENTURES: AdventureDefinition[] = [
  BREAKFAST_AT_THE_COVE,
  THE_MORNING_CARE_ROUND,
  THE_COVE_CARE_PLAN,
];
