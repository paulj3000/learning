import type { AdventureDefinition } from '../engine/types';

/**
 * Pirate Builder Bay's Sprout adventure (ages 3-4).
 *
 * The bay's only adventure was "Repair the Moonlight Bridge", authored
 * `ageBands: ['PATHFINDER']`. Once the age gate was actually enforced on the
 * walking route, that left Sprouts able to explore the bay and start nothing
 * in it - the gate was correct, and it made the content gap visible. This is
 * the same story beat told at Sprout scale.
 *
 * Calibrated to CLAUDE.md section 3's Sprout band, using
 * `butterflyGardenAdventures.ts` as the shape reference:
 * - one-step decisions, three picture-sized options, no reading required to
 *   choose (each option is a short spoken noun phrase);
 * - counting only to three, and only things that are visible at once;
 * - a five-rung hint ladder that ends by naming the answer outright, because
 *   a stuck three-year-old needs an exit, not another nudge;
 * - roughly five minutes end to end.
 *
 * It records the same `BRIDGE_REPAIRED` world change as the Pathfinder
 * version, deliberately. The island should grow the same way for a younger
 * child, `isLocationUnlocked` already keys the route onward off that key, and
 * a separate Sprout-only key would fork the world's state for no gain.
 */
export const THREE_PLANKS_FOR_THE_BRIDGE: AdventureDefinition = {
  slug: 'three-planks-for-the-bridge',
  version: 1,
  title: 'Three Planks for the Bridge',
  locationSlug: 'pirate-builder-bay',
  ageBands: ['SPROUT'],
  entryStepId: 'pip-needs-help',
  steps: [
    {
      id: 'pip-needs-help',
      type: 'NARRATIVE',
      objectiveIds: [],
      presentation: {
        kind: 'narrative',
        speaker: 'Chatty the Parrot',
        text: 'Pip is fixing the bridge. Some planks are missing. Let us help him find them!',
      },
      transitions: [{ when: 'always', nextStepId: 'count-the-gaps' }],
      fallback: { text: 'Pip needs help fixing the bridge.' },
    },
    {
      id: 'count-the-gaps',
      type: 'CHOICE',
      objectiveIds: ['counting-sets'],
      presentation: {
        kind: 'choice',
        prompt: 'Look at the bridge. How many holes need a new plank?',
        options: [
          { id: 'two', label: 'Two holes' },
          { id: 'three', label: 'Three holes' },
          { id: 'five', label: 'Five holes' },
        ],
        correctOptionId: 'three',
      },
      transitions: [
        { when: 'correct', nextStepId: 'which-plank-fits' },
        { when: 'incorrect', nextStepId: 'count-the-gaps' },
      ],
      hintPolicy: {
        ladder: [
          'Let us count the holes together.',
          'Point at each hole in the bridge.',
          'Count them out loud: one, two...',
          'There is one more hole after two.',
          'There are three holes. Tap "Three holes".',
        ],
      },
      fallback: { text: 'There are three holes in the bridge.' },
    },
    {
      id: 'which-plank-fits',
      type: 'CHOICE',
      objectiveIds: ['classification'],
      presentation: {
        kind: 'choice',
        prompt: 'Pip needs something flat to walk on. Which one should we give him?',
        options: [
          { id: 'plank', label: 'A flat wooden plank' },
          { id: 'rope', label: 'A coil of rope' },
          { id: 'barrel', label: 'A round barrel' },
        ],
        correctOptionId: 'plank',
      },
      transitions: [
        { when: 'correct', nextStepId: 'why-it-fits' },
        { when: 'incorrect', nextStepId: 'which-plank-fits' },
      ],
      hintPolicy: {
        ladder: [
          'Good thinking! Feet need something flat.',
          'A round barrel would roll away.',
          'Rope is too bendy to stand on.',
          'Look for the flat piece of wood.',
          'It is the plank. Tap "A flat wooden plank".',
        ],
      },
      fallback: { text: 'A flat wooden plank is the right shape to walk on.' },
    },
    {
      id: 'why-it-fits',
      type: 'CHOICE',
      objectiveIds: ['cause-and-effect'],
      presentation: {
        kind: 'choice',
        prompt: 'We laid the three planks down. What happens now?',
        options: [
          { id: 'cross', label: 'We can walk across' },
          { id: 'swim', label: 'We have to swim' },
          { id: 'wait', label: 'We wait for rain' },
        ],
        correctOptionId: 'cross',
      },
      transitions: [
        { when: 'correct', nextStepId: 'pip-says-thank-you' },
        { when: 'incorrect', nextStepId: 'why-it-fits' },
      ],
      hintPolicy: {
        ladder: [
          'The holes are all filled in now.',
          'The bridge is not broken any more.',
          'What do you do on a finished bridge?',
          'You use your feet to go across it.',
          'We can walk across! Tap "We can walk across".',
        ],
      },
      fallback: { text: 'The bridge is mended, so we can walk across it.' },
    },
    {
      id: 'pip-says-thank-you',
      type: 'NARRATIVE',
      objectiveIds: [],
      presentation: {
        kind: 'narrative',
        speaker: 'Chatty the Parrot',
        text: 'Pip waves his hat at you. Three planks, three holes, one mended bridge. You did that!',
      },
      transitions: [{ when: 'always', nextStepId: 'bridge-mended' }],
      fallback: { text: 'Pip waves his hat to say thank you.' },
    },
    {
      id: 'bridge-mended',
      type: 'WORLD_CHANGE',
      objectiveIds: [],
      presentation: {
        kind: 'world-change',
        text: 'The bridge is whole again, and the lanterns along it glow in the moonlight.',
        payload: {
          changeType: 'REPAIR',
          changeKey: 'BRIDGE_REPAIRED',
          locationSlug: 'pirate-builder-bay',
        },
      },
      transitions: [{ when: 'always', nextStepId: 'complete' }],
      fallback: { text: 'The bridge is mended.' },
    },
  ],
};
