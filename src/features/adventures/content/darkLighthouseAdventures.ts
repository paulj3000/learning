import type { AdventureDefinition } from '../engine/types';

/**
 * Clockwork Harbor, Chapter One: "The Dark Lighthouse"
 * (`docs/regions/clockwork.md` section 10).
 *
 * Three variants of one story beat, not three stories. The child's goal is
 * the same in all of them - "Restore power to the lighthouse" - and all three
 * record the same `CLOCKWORK_LIGHTHOUSE_FIXED` world change, so the harbor
 * grows the same way whichever one a child plays. Section 2.2 is explicit
 * about this: "The 3D environment and overall story remain the same
 * regardless of the player's learning level. Do not create separate versions
 * of Clockwork Harbor for different ages."
 *
 * What differs is the reasoning, along the axes section 2.2 lists: number
 * size, how many steps, and how much the child has to infer.
 *
 * ## How a variant gets chosen
 *
 * Each carries `skillDomain` and `skillLevel`, which
 * `resolveAdventureForSkillLevel` (`src/features/adaptive/`) matches against
 * the child's demonstrated Learning Profile level. `ageBands` is still
 * authored and still enforced, so the two selectors agree rather than
 * compete: the level-1 variant is the only one a Sprout can reach at all, and
 * a Pathfinder with strong evidence can be served the two-step variant that a
 * Pathfinder with thin evidence would not be.
 *
 * ## Why the arithmetic is what it is
 *
 * The roadmap's own example uses multiplication ("The lift needs 56 units of
 * power. Each power cell produces 8 units."). The curriculum does not author
 * a multiplication skill - `SKILLS` currently holds counting, addition and
 * subtraction within ten, comparing lengths, measurement, and patterns - and
 * an `objectiveIds` entry naming a skill that does not exist would write
 * evidence against nothing. So the same "how many cells?" shape is expressed
 * as repeated addition at level 3 and as a two-step subtract-then-group
 * problem at level 5. Authoring a real multiplication skill is recorded as a
 * gap in `docs/IMPLEMENTATION_STATUS.md`; when it lands, level 5's numbers can
 * grow into the roadmap's own example without any change here beyond content.
 *
 * Section 2.1's rule holds throughout: never "solve 3 + 3 + 3", always "the
 * lamp needs nine units and each crystal gives three".
 */

/** The world change every variant records. Named once so the three cannot drift apart. */
const LIGHTHOUSE_REPAIRED = {
  changeType: 'REPAIR',
  changeKey: 'CLOCKWORK_LIGHTHOUSE_FIXED',
  locationSlug: 'clockwork-harbor',
} as const;

const TURNS_AGAIN =
  'Deep under the floor something heavy begins to turn. The great lamp glows, then blazes, and a beam sweeps out across the water. Far off, a ship sounds its horn.';

/**
 * Level 1, Explorer (`docs/regions/clockwork.md` section 7).
 *
 * Recognition and counting only, and only of things visible at once, per
 * CLAUDE.md section 3's Sprout band. One decision, three spoken options, a
 * five-rung ladder that ends by naming the answer - a stuck three-year-old
 * needs an exit, not another nudge.
 */
export const THE_DARK_LIGHTHOUSE_COUNTING: AdventureDefinition = {
  slug: 'the-dark-lighthouse-counting',
  version: 1,
  title: 'The Dark Lighthouse',
  locationSlug: 'clockwork-harbor',
  ageBands: ['SPROUT', 'PATHFINDER'],
  skillDomain: 'math',
  skillLevel: 1,
  entryStepId: 'the-lamp-is-dark',
  steps: [
    {
      id: 'the-lamp-is-dark',
      type: 'NARRATIVE',
      objectiveIds: [],
      presentation: {
        kind: 'narrative',
        speaker: 'Chatty the Parrot',
        text: 'The big lamp at the top of the lighthouse has gone dark. Inside, there is a machine with empty slots. It needs its glowing crystals back!',
      },
      transitions: [{ when: 'always', nextStepId: 'count-the-slots' }],
      fallback: { text: 'The lighthouse lamp is dark. Its machine needs crystals.' },
    },
    {
      id: 'count-the-slots',
      type: 'CHOICE',
      objectiveIds: ['counting-sets'],
      presentation: {
        kind: 'choice',
        prompt: 'Look at the machine. How many empty slots need a crystal?',
        options: [
          { id: 'two', label: 'Two slots', groups: [2] },
          { id: 'three', label: 'Three slots', groups: [3] },
          { id: 'five', label: 'Five slots', groups: [5] },
        ],
        correctOptionId: 'three',
      },
      transitions: [
        { when: 'correct', nextStepId: 'the-lighthouse-turns' },
        { when: 'incorrect', nextStepId: 'count-the-slots' },
      ],
      hintPolicy: {
        ladder: [
          'Let us count the empty slots together.',
          'Point at each empty slot on the machine.',
          'Count them out loud: one, two...',
          'There is one more slot after two.',
          'There are three slots. Tap "Three slots".',
        ],
      },
      fallback: { text: 'Count the empty slots on the machine.' },
    },
    {
      id: 'the-lighthouse-turns',
      type: 'WORLD_CHANGE',
      objectiveIds: [],
      presentation: { kind: 'world-change', text: TURNS_AGAIN, payload: LIGHTHOUSE_REPAIRED },
      transitions: [{ when: 'always', nextStepId: 'chapter-one-done' }],
      fallback: { text: 'The lighthouse is turning again.' },
    },
    {
      id: 'chapter-one-done',
      type: 'COMPLETE',
      objectiveIds: [],
      presentation: {
        kind: 'complete',
        text: 'You lit the lighthouse! The harbor gate is open now. There is a marketplace just past the docks.',
      },
      transitions: [],
      fallback: { text: 'You lit the lighthouse.' },
    },
  ],
};

/**
 * Level 3, Pathfinder.
 *
 * Repeated addition inside a real constraint: nine units needed, three per
 * crystal. The child must work out how many crystals, not just count what is
 * in front of them - the step up section 7 describes as "multi-step problems".
 */
export const THE_DARK_LIGHTHOUSE_GROUPS: AdventureDefinition = {
  slug: 'the-dark-lighthouse-groups',
  version: 1,
  title: 'The Dark Lighthouse',
  locationSlug: 'clockwork-harbor',
  ageBands: ['PATHFINDER', 'EXPLORER'],
  skillDomain: 'math',
  skillLevel: 3,
  entryStepId: 'the-harbor-master-asks',
  steps: [
    {
      id: 'the-harbor-master-asks',
      type: 'NARRATIVE',
      objectiveIds: [],
      presentation: {
        kind: 'narrative',
        speaker: 'The Harbor Master',
        text: 'No ship can come in while the lighthouse is dark, so the gate stays shut. The machine inside needs nine units of power before the lamp will turn. Every crystal you slot in gives three units.',
        aiNarrated: true,
      },
      transitions: [{ when: 'always', nextStepId: 'how-many-crystals' }],
      fallback: {
        text: 'The lighthouse machine needs nine units of power. Each crystal gives three units.',
      },
    },
    {
      id: 'how-many-crystals',
      type: 'NUMBER_INPUT',
      objectiveIds: ['addition-within-ten', 'patterns'],
      presentation: {
        kind: 'number-input',
        prompt:
          'The lamp needs 9 units of power. Each crystal gives 3 units. How many crystals should you slot in?',
        correctValue: 3,
      },
      transitions: [
        { when: 'correct', nextStepId: 'the-lighthouse-turns' },
        { when: 'incorrect', nextStepId: 'how-many-crystals' },
      ],
      hintPolicy: {
        ladder: [
          'One crystal gives three units. Is that enough for nine?',
          'Try counting up in threes: three, six...',
          'Three, six, nine. How many numbers did you say?',
          'You counted three numbers to reach nine.',
          'Three crystals give nine units. The answer is 3.',
        ],
      },
      fallback: { text: 'Nine units are needed and each crystal gives three.' },
    },
    {
      id: 'the-lighthouse-turns',
      type: 'WORLD_CHANGE',
      objectiveIds: [],
      presentation: { kind: 'world-change', text: TURNS_AGAIN, payload: LIGHTHOUSE_REPAIRED },
      transitions: [{ when: 'always', nextStepId: 'chapter-one-done' }],
      fallback: { text: 'The lighthouse is turning again.' },
    },
    {
      id: 'chapter-one-done',
      type: 'COMPLETE',
      objectiveIds: [],
      presentation: {
        kind: 'complete',
        text: 'The beam is sweeping the water again and the harbor gate has swung open. The Harbor Master says the marketplace is just past the docks, and that something odd has been happening there.',
      },
      transitions: [],
      fallback: { text: 'The lighthouse turns again and the harbor gate is open.' },
    },
  ],
};

/**
 * Level 5, Master Explorer.
 *
 * Two steps, and the first number is not given: the child reads how much power
 * is already in the machine, works out the shortfall, then groups it. Section
 * 2.2's "amount of information the player must infer", at the top of the
 * scale this content currently reaches.
 */
export const THE_DARK_LIGHTHOUSE_TWO_STEP: AdventureDefinition = {
  slug: 'the-dark-lighthouse-two-step',
  version: 1,
  title: 'The Dark Lighthouse',
  locationSlug: 'clockwork-harbor',
  ageBands: ['EXPLORER'],
  skillDomain: 'math',
  skillLevel: 5,
  entryStepId: 'the-gauge-reads-low',
  steps: [
    {
      id: 'the-gauge-reads-low',
      type: 'NARRATIVE',
      objectiveIds: [],
      presentation: {
        kind: 'narrative',
        speaker: 'The Harbor Master',
        text: 'The lamp will not turn under ten units of power. The gauge on the machine reads four, and it has been stuck there since the trouble started. There is a crate of crystals by the stairs, and each one is worth three units.',
        aiNarrated: true,
      },
      transitions: [{ when: 'always', nextStepId: 'how-much-is-missing' }],
      fallback: {
        text: 'The lamp needs ten units. The gauge reads four. Each crystal is worth three units.',
      },
    },
    {
      id: 'how-much-is-missing',
      type: 'NUMBER_INPUT',
      objectiveIds: ['subtraction-within-ten'],
      presentation: {
        kind: 'number-input',
        prompt:
          'The lamp needs 10 units and the gauge already reads 4. How many more units does the machine still need?',
        correctValue: 6,
      },
      transitions: [
        { when: 'correct', nextStepId: 'how-many-crystals' },
        { when: 'incorrect', nextStepId: 'how-much-is-missing' },
      ],
      hintPolicy: {
        ladder: [
          'You are looking for the gap between what it has and what it needs.',
          'Start at four and count up to ten.',
          'Four, five, six, seven, eight, nine, ten. How many steps was that?',
          'Ten take away four is what you want.',
          'The machine still needs 6 units.',
        ],
      },
      fallback: { text: 'Work out the gap between four units and ten units.' },
    },
    {
      id: 'how-many-crystals',
      type: 'NUMBER_INPUT',
      objectiveIds: ['addition-within-ten', 'patterns'],
      presentation: {
        kind: 'number-input',
        prompt: 'Each crystal is worth 3 units. How many crystals will cover those 6 units?',
        correctValue: 2,
      },
      transitions: [
        { when: 'correct', nextStepId: 'the-lighthouse-turns' },
        { when: 'incorrect', nextStepId: 'how-many-crystals' },
      ],
      hintPolicy: {
        ladder: [
          'One crystal gives three. Is one enough for six?',
          'Try counting up in threes until you reach six.',
          'Three, six. That is two steps.',
          'Two crystals give three and three.',
          'Two crystals cover six units. The answer is 2.',
        ],
      },
      fallback: { text: 'Six units are needed and each crystal gives three.' },
    },
    {
      id: 'the-lighthouse-turns',
      type: 'WORLD_CHANGE',
      objectiveIds: [],
      presentation: { kind: 'world-change', text: TURNS_AGAIN, payload: LIGHTHOUSE_REPAIRED },
      transitions: [{ when: 'always', nextStepId: 'chapter-one-done' }],
      fallback: { text: 'The lighthouse is turning again.' },
    },
    {
      id: 'chapter-one-done',
      type: 'COMPLETE',
      objectiveIds: [],
      presentation: {
        kind: 'complete',
        text: 'The beam sweeps the water again and the harbor gate swings open. The Harbor Master is already worrying about something else: one of the Great Harbor Gears has gone missing from the marketplace.',
      },
      transitions: [],
      fallback: { text: 'The lighthouse turns again and the harbor gate is open.' },
    },
  ],
};

/** All three variants, for the content registry and the adaptive selector. */
export const DARK_LIGHTHOUSE_ADVENTURES: AdventureDefinition[] = [
  THE_DARK_LIGHTHOUSE_COUNTING,
  THE_DARK_LIGHTHOUSE_GROUPS,
  THE_DARK_LIGHTHOUSE_TWO_STEP,
];
