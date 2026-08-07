import type { AdventureDefinition } from '../engine/types';

/**
 * "Repair the Moonlight Bridge", authored in full in
 * docs/ADVENTURE_ENGINE.md. Targets Pathfinders (ages 5-6) only for this
 * first authored adventure — see the Phase 3 plan's scope note. No AI is
 * involved: every prompt, option, and hint below is fixed, deterministic
 * copy (docs/ROADMAP.md Phase 3 "author one complete ... adventure without
 * AI"; AI-assisted variation arrives in Phase 4).
 */
export const REPAIR_THE_MOONLIGHT_BRIDGE: AdventureDefinition = {
  slug: 'repair-the-moonlight-bridge',
  version: 1,
  title: 'Repair the Moonlight Bridge',
  locationSlug: 'pirate-builder-bay',
  ageBands: ['PATHFINDER'],
  entryStepId: 'inspect-bridge',
  steps: [
    {
      id: 'inspect-bridge',
      type: 'NARRATIVE',
      objectiveIds: [],
      presentation: {
        kind: 'narrative',
        speaker: 'Pirate Pip',
        text: 'Ahoy! The bridge into the bay has planks missing, and the moon rises soon. Will you help me repair it?',
      },
      transitions: [{ when: 'always', nextStepId: 'count-planks' }],
      fallback: { text: 'The bridge needs repairing before the moon rises.' },
    },
    {
      id: 'count-planks',
      type: 'NUMBER_INPUT',
      objectiveIds: ['counting-sets'],
      presentation: {
        kind: 'number-input',
        prompt: 'How many planks are missing from the bridge?',
        correctValue: 4,
      },
      transitions: [
        { when: 'correct', nextStepId: 'choose-bundle' },
        { when: 'incorrect', nextStepId: 'count-planks' },
      ],
      hintPolicy: {
        ladder: [
          "You can do this! Let's count the missing planks together.",
          'Look closely at the gaps in the bridge deck.',
          'Try touching each gap and counting out loud: one, two, three...',
          'There are gaps at the start, the middle, and two more near the end.',
          'There are 4 missing planks. Type 4 to keep going.',
        ],
      },
      fallback: { text: 'There are 4 missing planks.' },
    },
    {
      id: 'choose-bundle',
      type: 'CHOICE',
      objectiveIds: ['addition-within-ten'],
      presentation: {
        kind: 'choice',
        prompt: 'Which bundle of planks adds up to what Pirate Pip needs?',
        options: [
          { id: 'bundle-2-2', label: '2 planks + 2 planks' },
          { id: 'bundle-1-2', label: '1 plank + 2 planks' },
          { id: 'bundle-3-3', label: '3 planks + 3 planks' },
        ],
        correctOptionId: 'bundle-2-2',
      },
      transitions: [
        { when: 'correct', nextStepId: 'order-planks' },
        { when: 'incorrect', nextStepId: 'choose-bundle' },
      ],
      hintPolicy: {
        ladder: [
          "You've got this! Which bundle adds up to what Pirate Pip needs?",
          'Pirate Pip needs 4 planks in total.',
          'Add the two numbers in each bundle together.',
          '2 planks plus 2 planks makes 4 planks.',
          'The bundle with 2 planks and 2 planks is the one you need.',
        ],
      },
      fallback: { text: 'The bundle with 2 planks and 2 planks makes 4 planks.' },
    },
    {
      id: 'order-planks',
      type: 'ORDERING',
      objectiveIds: ['comparing-lengths'],
      presentation: {
        kind: 'ordering',
        prompt: 'Put the planks in order from shortest to longest.',
        items: [
          { id: 'medium-plank', label: 'Medium plank' },
          { id: 'long-plank', label: 'Long plank' },
          { id: 'short-plank', label: 'Short plank' },
        ],
        correctOrder: ['short-plank', 'medium-plank', 'long-plank'],
      },
      transitions: [
        { when: 'correct', nextStepId: 'instruction-one' },
        { when: 'incorrect', nextStepId: 'order-planks' },
      ],
      hintPolicy: {
        ladder: [
          "Nice work so far! Let's put these planks in order.",
          'Look at how long each plank is.',
          'Find the shortest plank first, then work up to the longest.',
          'The short plank goes first, then the medium plank.',
          'Shortest, then medium, then longest: that is the order.',
        ],
      },
      fallback: { text: 'Shortest, then medium, then longest.' },
    },
    {
      id: 'instruction-one',
      type: 'NARRATIVE',
      objectiveIds: [],
      presentation: {
        kind: 'narrative',
        speaker: 'Pirate Pip',
        text: 'First, hold the plank steady against the gap.',
      },
      transitions: [{ when: 'always', nextStepId: 'instruction-two' }],
      fallback: { text: 'First, hold the plank steady against the gap.' },
    },
    {
      id: 'instruction-two',
      type: 'NARRATIVE',
      objectiveIds: [],
      presentation: {
        kind: 'narrative',
        speaker: 'Pirate Pip',
        text: 'Next, line up the nail holes with the beam.',
      },
      transitions: [{ when: 'always', nextStepId: 'instruction-three' }],
      fallback: { text: 'Next, line up the nail holes with the beam.' },
    },
    {
      id: 'instruction-three',
      type: 'NARRATIVE',
      objectiveIds: [],
      presentation: {
        kind: 'narrative',
        speaker: 'Pirate Pip',
        text: 'Last, hammer the nail in firmly. Now, where does the final plank go?',
      },
      transitions: [{ when: 'always', nextStepId: 'place-final-plank' }],
      fallback: { text: 'Last, hammer the nail in firmly.' },
    },
    {
      id: 'place-final-plank',
      type: 'CHOICE',
      objectiveIds: ['following-instructions'],
      presentation: {
        kind: 'choice',
        prompt: 'Where does the final plank go?',
        options: [
          { id: 'left-gap', label: 'The left gap' },
          { id: 'middle-gap', label: 'The middle gap' },
          { id: 'right-gap', label: 'The right gap' },
        ],
        correctOptionId: 'middle-gap',
      },
      transitions: [
        { when: 'correct', nextStepId: 'bridge-repaired' },
        { when: 'incorrect', nextStepId: 'place-final-plank' },
      ],
      hintPolicy: {
        ladder: [
          'Almost there! One more plank to place.',
          'Look for the last empty gap in the bridge.',
          'Pirate Pip pointed at the middle of the bridge earlier.',
          'The gap right in the middle is still empty.',
          'Place the final plank in the middle gap.',
        ],
      },
      fallback: { text: 'The final plank goes in the middle gap.' },
    },
    {
      id: 'bridge-repaired',
      type: 'WORLD_CHANGE',
      objectiveIds: [],
      presentation: {
        kind: 'world-change',
        text: 'The last plank slides into place. The Moonlight Bridge is repaired!',
        payload: {
          changeType: 'REPAIR',
          changeKey: 'BRIDGE_REPAIRED',
          locationSlug: 'pirate-builder-bay',
        },
      },
      transitions: [{ when: 'always', nextStepId: 'complete' }],
      fallback: { text: 'The Moonlight Bridge is repaired!' },
    },
    {
      id: 'complete',
      type: 'COMPLETE',
      objectiveIds: [],
      presentation: {
        kind: 'complete',
        text: 'You repaired the Moonlight Bridge! The path across Pirate Builder Bay is open.',
      },
      transitions: [],
      fallback: { text: 'You repaired the Moonlight Bridge!' },
    },
  ],
};
