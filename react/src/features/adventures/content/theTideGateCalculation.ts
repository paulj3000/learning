import type { AdventureDefinition } from '../engine/types';

/**
 * Pirate Builder Bay's Explorer adventure (ages 7-8).
 *
 * The bay held a Pathfinder adventure and, since the Sprout pass, a Sprout
 * one. Explorers could walk into the bay and start nothing, the same gap
 * enforcing age bands had just made visible for Sprouts.
 *
 * Deliberately not a third retelling of the bridge repair. Sprouts and
 * Pathfinders both mend the bridge; by ages 7-8 the interesting problem at a
 * harbour is not "how many planks" but "will it still be there at high tide",
 * so this is a planning problem set at the same place, after the bridge is
 * standing. CLAUDE.md section 3's Explorer band asks for multi-stage
 * missions, arithmetic, measurement, science reasoning, and planning; this
 * uses arithmetic (subtraction and a two-step total), measurement with a
 * unit, and one reasoned prediction.
 *
 * Calibrated above the Pathfinder version rather than beside it:
 * - numbers past ten, and a two-step calculation rather than a single count;
 * - prompts that must be read rather than recognised from pictures;
 * - a hint ladder that scaffolds method rather than naming the answer until
 *   the last rung.
 *
 * It records its own `TIDE_GATE_SET` world change rather than reusing
 * `BRIDGE_REPAIRED`: this is a different act at the same place, and reusing
 * the bridge key would tell the island a bridge had been repaired that never
 * was. `THREE_PLANKS_FOR_THE_BRIDGE` reuses that key because it genuinely is
 * the same act at a younger band.
 */
export const THE_TIDE_GATE_CALCULATION: AdventureDefinition = {
  slug: 'the-tide-gate-calculation',
  version: 1,
  title: 'The Tide Gate Calculation',
  locationSlug: 'pirate-builder-bay',
  ageBands: ['EXPLORER'],
  entryStepId: 'pip-has-a-problem',
  steps: [
    {
      id: 'pip-has-a-problem',
      type: 'NARRATIVE',
      objectiveIds: [],
      presentation: {
        kind: 'narrative',
        speaker: 'Pirate Pip',
        text: 'The bridge stands, but the spring tide comes tonight. If the water rises above the deck, my new planks float away. Help me work out how high to set the tide gate.',
      },
      transitions: [{ when: 'always', nextStepId: 'read-the-tide-board' }],
      fallback: { text: 'Pip needs help setting the tide gate before tonight.' },
    },
    {
      id: 'read-the-tide-board',
      type: 'NUMBER_INPUT',
      objectiveIds: ['measurement'],
      presentation: {
        kind: 'number-input',
        prompt:
          'The harbour board reads: low water 40 centimetres, and tonight the tide rises 85 centimetres above that. How high will the water reach, in centimetres?',
        correctValue: 125,
      },
      transitions: [
        { when: 'correct', nextStepId: 'how-much-clearance' },
        { when: 'incorrect', nextStepId: 'read-the-tide-board' },
      ],
      hintPolicy: {
        ladder: [
          'Take your time. Two measurements are given, and you need their total.',
          'Start from low water and add the rise on top of it.',
          'Set it out as 40 + 85, then add the tens and the ones separately.',
          '40 + 80 is 120, and there are 5 more centimetres to add.',
          'The water reaches 125 centimetres. Type 125 to keep going.',
        ],
      },
      fallback: { text: 'The water will reach 125 centimetres.' },
    },
    {
      id: 'how-much-clearance',
      type: 'NUMBER_INPUT',
      objectiveIds: ['comparing-lengths'],
      presentation: {
        kind: 'number-input',
        prompt:
          'The bridge deck sits at 140 centimetres. How many centimetres of clearance are left above the water?',
        correctValue: 15,
      },
      transitions: [
        { when: 'correct', nextStepId: 'predict-the-risk' },
        { when: 'incorrect', nextStepId: 'how-much-clearance' },
      ],
      hintPolicy: {
        ladder: [
          'Good. Now compare the deck height with the water height you found.',
          'Clearance is the gap between them, so this is a subtraction.',
          'Set it out as 140 - 125.',
          '125 plus 5 is 130, and 10 more makes 140.',
          'The clearance is 15 centimetres. Type 15 to keep going.',
        ],
      },
      fallback: { text: 'There are 15 centimetres of clearance.' },
    },
    {
      id: 'predict-the-risk',
      type: 'CHOICE',
      objectiveIds: ['cause-and-effect'],
      presentation: {
        kind: 'choice',
        prompt:
          'A storm would push the water 20 centimetres higher than tonight’s tide. With 15 centimetres of clearance, what should Pip expect if a storm arrives?',
        options: [
          { id: 'over', label: 'The water would come over the deck' },
          { id: 'just-under', label: 'The water would stop just under the deck' },
          { id: 'no-change', label: 'The storm would make no difference' },
        ],
        correctOptionId: 'over',
      },
      transitions: [
        { when: 'correct', nextStepId: 'choose-the-gate-height' },
        { when: 'incorrect', nextStepId: 'predict-the-risk' },
      ],
      hintPolicy: {
        ladder: [
          'Compare the two numbers you have: the clearance, and the storm rise.',
          'The clearance is 15 centimetres. The storm adds 20.',
          'Is 20 bigger or smaller than 15?',
          '20 is bigger than 15, so the water would pass the deck height.',
          'The water would come over the deck. Choose that answer.',
        ],
      },
      fallback: {
        text: 'A 20 centimetre storm surge is more than 15 centimetres of clearance, so the water would come over the deck.',
      },
    },
    {
      id: 'choose-the-gate-height',
      type: 'CHOICE',
      objectiveIds: ['following-instructions'],
      presentation: {
        kind: 'choice',
        prompt:
          'Pip’s rule is to set the gate at least 5 centimetres above the highest water he expects. The highest he expects is a storm tide at 145 centimetres. Which setting follows his rule?',
        options: [
          { id: 'one-forty', label: '140 centimetres' },
          { id: 'one-fifty', label: '150 centimetres' },
          { id: 'one-thirty', label: '130 centimetres' },
        ],
        correctOptionId: 'one-fifty',
      },
      transitions: [
        { when: 'correct', nextStepId: 'pip-sets-the-gate' },
        { when: 'incorrect', nextStepId: 'choose-the-gate-height' },
      ],
      hintPolicy: {
        ladder: [
          'Read the rule again: at least 5 centimetres above the highest water.',
          'The highest water he expects is 145 centimetres.',
          'So the gate needs to be at 145 + 5 or higher.',
          '145 + 5 is 150, so 150 centimetres is the lowest setting that follows the rule.',
          'The answer is 150 centimetres. Choose that setting.',
        ],
      },
      fallback: { text: 'The gate should be set at 150 centimetres.' },
    },
    {
      id: 'pip-sets-the-gate',
      type: 'NARRATIVE',
      objectiveIds: [],
      presentation: {
        kind: 'narrative',
        speaker: 'Pirate Pip',
        text: 'You worked that out properly, with numbers instead of guessing. I will set the gate tonight and sleep easy.',
      },
      transitions: [{ when: 'always', nextStepId: 'tide-gate-set' }],
      fallback: { text: 'Pip will set the tide gate tonight.' },
    },
    {
      id: 'tide-gate-set',
      type: 'WORLD_CHANGE',
      objectiveIds: [],
      presentation: {
        kind: 'world-change',
        text: 'A tall tide gate now stands at the mouth of the bay, its measuring post painted in bright bands.',
        payload: {
          changeType: 'CREATE',
          changeKey: 'TIDE_GATE_SET',
          locationSlug: 'pirate-builder-bay',
        },
      },
      transitions: [{ when: 'always', nextStepId: 'complete' }],
      fallback: { text: 'The tide gate is set.' },
    },
  ],
};
