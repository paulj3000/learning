import type { AdventureDefinition } from '../engine/types';

/**
 * The two Adventure Engine challenges embedded in "Robot Rescue", the
 * Adventure Library's building arc (docs/ROADMAP.md Phase 15,
 * `docs/LEARNING_ADVENTURE_ISLAND_EXPLORABLE_WORLD_ROADMAP.md` section 34).
 * Same layering as every other embedded arc challenge: the Story Engine
 * chooses when to run one, the unchanged Adventure Engine decides
 * correctness (CLAUDE.md section 7). `locationSlug: 'robot-repair-reef'`
 * is a story-only pseudo-location (roadmap section 5 names the reef as a
 * future island region) and matches no entry in
 * `src/features/island/locations.ts`, so these never surface on an
 * `IslandLocationPage`.
 *
 * Scoped to Pathfinders and Explorers, matching the arc's own
 * `supportedAgeBands` (`src/features/story/content/robotRescue.ts`).
 *
 * Bolt is a machine and is written as one: it whirrs, it stops, it starts
 * again. Nothing here says Bolt is alive, lonely, or sad, which would cut
 * against CLAUDE.md section 6's rule for Chatty and would be a strange
 * thing to teach through a robot the child is repairing. The empathy beat
 * in this arc is about the harbor's people missing Bolt's help, not about
 * the robot's feelings.
 */

export const ROBOT_CHAPTER_1_GATHER_PARTS: AdventureDefinition = {
  slug: 'robot-chapter-1-gather-parts',
  version: 1,
  title: 'Gather the Parts',
  locationSlug: 'robot-repair-reef',
  ageBands: ['PATHFINDER', 'EXPLORER'],
  entryStepId: 'find-bolt',
  steps: [
    {
      id: 'find-bolt',
      type: 'NARRATIVE',
      objectiveIds: [],
      presentation: {
        kind: 'narrative',
        speaker: 'Chatty the Parrot',
        text: 'Here is Bolt, the little harbor robot, stopped still at the edge of the reef with parts scattered all around. Let’s find everything Bolt needs.',
      },
      transitions: [{ when: 'always', nextStepId: 'sort-the-part' }],
      fallback: { text: 'Bolt the harbor robot has stopped. Let’s find the missing parts.' },
    },
    {
      id: 'sort-the-part',
      type: 'CHOICE',
      objectiveIds: ['classification'],
      presentation: {
        kind: 'choice',
        prompt: 'Bolt needs a gear. Which one of these is a gear?',
        options: [
          { id: 'toothed-wheel', label: 'A flat wheel with teeth all around its edge' },
          { id: 'coil', label: 'A springy coil that squashes flat' },
          { id: 'lamp', label: 'A round glass lamp' },
        ],
        correctOptionId: 'toothed-wheel',
      },
      transitions: [
        { when: 'correct', nextStepId: 'count-the-bolts' },
        { when: 'incorrect', nextStepId: 'sort-the-part' },
      ],
      hintPolicy: {
        ladder: [
          'Good thinking! Let’s look at the shapes.',
          'A gear turns and pushes another gear along.',
          'For that, it needs teeth around the outside.',
          'Only one of these is a wheel with teeth.',
          'The flat wheel with teeth is the gear. Choose that one.',
        ],
      },
      fallback: { text: 'A gear is a wheel with teeth around its edge.' },
    },
    {
      id: 'count-the-bolts',
      type: 'NUMBER_INPUT',
      objectiveIds: ['addition-within-ten'],
      presentation: {
        kind: 'number-input',
        prompt:
          'Each of Bolt’s arms needs 4 bolts. How many bolts do we need for both arms altogether?',
        correctValue: 8,
      },
      transitions: [
        { when: 'correct', nextStepId: 'order-the-wires' },
        { when: 'incorrect', nextStepId: 'count-the-bolts' },
      ],
      hintPolicy: {
        ladder: [
          'You can do this! There are two arms to think about.',
          'One arm takes 4 bolts. The other arm takes 4 bolts too.',
          'Put the two groups of 4 together.',
          'Count on from 4: 5, 6, 7, 8.',
          '4 and 4 makes 8. Type 8 to keep going.',
        ],
      },
      fallback: { text: '4 bolts and 4 more bolts makes 8.' },
    },
    {
      id: 'order-the-wires',
      type: 'ORDERING',
      objectiveIds: ['comparing-lengths'],
      presentation: {
        kind: 'ordering',
        prompt: 'Line the wires up from shortest to longest so each one reaches the right socket.',
        items: [
          { id: 'long-wire', label: 'The long green wire' },
          { id: 'short-wire', label: 'The short red wire' },
          { id: 'medium-wire', label: 'The medium blue wire' },
        ],
        correctOrder: ['short-wire', 'medium-wire', 'long-wire'],
      },
      transitions: [
        { when: 'correct', nextStepId: 'parts-narration' },
        { when: 'incorrect', nextStepId: 'order-the-wires' },
      ],
      hintPolicy: {
        ladder: [
          'Nice work! Let’s compare the wires.',
          'Look at how far each wire stretches.',
          'Find the shortest wire and put it at the top.',
          'The red wire is shortest, and the green wire is longest.',
          'Short red, then medium blue, then long green.',
        ],
      },
      fallback: { text: 'Short red, then medium blue, then long green.' },
    },
    {
      id: 'parts-narration',
      type: 'NARRATIVE',
      objectiveIds: [],
      presentation: {
        kind: 'narrative',
        speaker: 'Chatty the Parrot',
        text: 'Gear, bolts, wires, all lined up on the workbench. Everything Bolt needs is finally in one place.',
      },
      transitions: [{ when: 'always', nextStepId: 'workbench-ready' }],
      fallback: { text: 'Everything Bolt needs is on the workbench now.' },
    },
    {
      id: 'workbench-ready',
      type: 'WORLD_CHANGE',
      objectiveIds: [],
      presentation: {
        kind: 'world-change',
        text: 'A tidy workbench stands on the reef, stacked with every part Bolt needs.',
        payload: {
          changeType: 'CREATE',
          changeKey: 'ROBOT_WORKBENCH_READY',
          locationSlug: 'robot-repair-reef',
        },
      },
      transitions: [{ when: 'always', nextStepId: 'complete' }],
      fallback: { text: 'The workbench on the reef is ready.' },
    },
    {
      id: 'complete',
      type: 'COMPLETE',
      objectiveIds: [],
      presentation: {
        kind: 'complete',
        text: 'You found every part! Now for the tricky bit: putting Bolt back together.',
      },
      transitions: [],
      fallback: { text: 'You found every part Bolt needs!' },
    },
  ],
};

export const ROBOT_CHAPTER_2_BUILD_IT_BACK: AdventureDefinition = {
  slug: 'robot-chapter-2-build-it-back',
  version: 1,
  title: 'Build It Back',
  locationSlug: 'robot-repair-reef',
  ageBands: ['PATHFINDER', 'EXPLORER'],
  entryStepId: 'open-the-manual',
  steps: [
    {
      id: 'open-the-manual',
      type: 'NARRATIVE',
      objectiveIds: [],
      presentation: {
        kind: 'narrative',
        speaker: 'Chatty the Parrot',
        text: 'Bolt’s little repair book is still in the toolbox, salty but readable. It says to build from the bottom up.',
      },
      transitions: [{ when: 'always', nextStepId: 'order-the-build' }],
      fallback: { text: 'Bolt’s repair book says to build from the bottom up.' },
    },
    {
      id: 'order-the-build',
      type: 'ORDERING',
      objectiveIds: ['following-instructions'],
      presentation: {
        kind: 'ordering',
        prompt: 'Follow the repair book. Put the building steps in order, from the bottom up.',
        items: [
          { id: 'fit-head', label: 'Fit the head' },
          { id: 'bolt-wheels', label: 'Bolt on the wheels' },
          { id: 'attach-arms', label: 'Attach the arms' },
          { id: 'stack-body', label: 'Stack the body on the wheels' },
        ],
        correctOrder: ['bolt-wheels', 'stack-body', 'attach-arms', 'fit-head'],
      },
      transitions: [
        { when: 'correct', nextStepId: 'panel-pattern' },
        { when: 'incorrect', nextStepId: 'order-the-build' },
      ],
      hintPolicy: {
        ladder: [
          'Great start! The book says bottom to top.',
          'What sits on the ground? That part goes first.',
          'Wheels first, then the body sits on top of them.',
          'Arms go on the body, and the head goes on last.',
          'Wheels, body, arms, head. That is the order.',
        ],
      },
      fallback: { text: 'Wheels first, then body, then arms, then head.' },
    },
    {
      id: 'panel-pattern',
      type: 'CHOICE',
      objectiveIds: ['patterns'],
      presentation: {
        kind: 'choice',
        prompt:
          'Bolt’s panel lights up in a pattern: red, blue, red, blue, red. Which light comes next?',
        options: [
          { id: 'blue', label: 'Blue' },
          { id: 'red', label: 'Red' },
          { id: 'green', label: 'Green' },
        ],
        correctOptionId: 'blue',
      },
      transitions: [
        { when: 'correct', nextStepId: 'count-the-lights' },
        { when: 'incorrect', nextStepId: 'panel-pattern' },
      ],
      hintPolicy: {
        ladder: [
          'You are good at patterns! Say the colors out loud.',
          'Red, blue, red, blue, red.',
          'The pattern keeps swapping between two colors.',
          'After a red light, which color always comes?',
          'Blue comes next. Choose blue to keep going.',
        ],
      },
      fallback: { text: 'The pattern swaps red and blue, so blue comes next.' },
    },
    {
      id: 'count-the-lights',
      type: 'NUMBER_INPUT',
      objectiveIds: ['subtraction-within-ten'],
      presentation: {
        kind: 'number-input',
        prompt: 'Bolt has 7 lights. 2 of them are still dark. How many lights are shining?',
        correctValue: 5,
      },
      transitions: [
        { when: 'correct', nextStepId: 'bolt-whirrs' },
        { when: 'incorrect', nextStepId: 'count-the-lights' },
      ],
      hintPolicy: {
        ladder: [
          'You can do this! Start with all 7 lights.',
          'Two of the seven are not shining.',
          'Take those 2 away from 7.',
          'Count back from 7: 6, 5.',
          '7 take away 2 is 5. Type 5 to keep going.',
        ],
      },
      fallback: { text: '7 lights take away 2 dark ones leaves 5 shining.' },
    },
    {
      id: 'bolt-whirrs',
      type: 'NARRATIVE',
      objectiveIds: [],
      presentation: {
        kind: 'narrative',
        speaker: 'Chatty the Parrot',
        text: 'A whirr, a click, and Bolt rolls forward one careful turn of the wheels. You rebuilt a robot!',
        aiNarrated: true,
      },
      transitions: [{ when: 'always', nextStepId: 'bolt-rebuilt' }],
      fallback: { text: 'Bolt whirrs, clicks, and rolls forward again.' },
    },
    {
      id: 'bolt-rebuilt',
      type: 'WORLD_CHANGE',
      objectiveIds: [],
      presentation: {
        kind: 'world-change',
        text: 'Bolt the harbor robot is running again, rolling up and down the reef.',
        payload: {
          changeType: 'REPAIR',
          changeKey: 'ROBOT_BOLT_REBUILT',
          locationSlug: 'robot-repair-reef',
        },
      },
      transitions: [{ when: 'always', nextStepId: 'complete' }],
      fallback: { text: 'Bolt is running again.' },
    },
    {
      id: 'complete',
      type: 'COMPLETE',
      objectiveIds: [],
      presentation: {
        kind: 'complete',
        text: 'You built Bolt back together! The reef has its helper again.',
      },
      transitions: [],
      fallback: { text: 'You built Bolt back together!' },
    },
  ],
};

export const ROBOT_RESCUE_ADVENTURES: AdventureDefinition[] = [
  ROBOT_CHAPTER_1_GATHER_PARTS,
  ROBOT_CHAPTER_2_BUILD_IT_BACK,
];
