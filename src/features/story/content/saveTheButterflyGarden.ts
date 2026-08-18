import type { StoryDefinition } from '../engine/types';

/**
 * "Save the Butterfly Garden" — the Adventure Library's nature arc
 * (docs/ROADMAP.md Phase 15,
 * `docs/LEARNING_ADVENTURE_ISLAND_EXPLORABLE_WORLD_ROADMAP.md` section 34),
 * and the first arc in the repository that a **Sprout** (ages 3-4) can
 * play.
 *
 * The Sprout band shapes the whole arc, not only its embedded challenges
 * (`src/features/adventures/content/butterflyGardenAdventures.ts` documents
 * the step-level rules): three short chapters, every scene one or two
 * spoken sentences, one bounded choice, and one reflection. A full run is
 * two four-step adventures plus five short scenes, which fits the 5-8
 * minute Sprout session in CLAUDE.md section 3. Pathfinders can play it
 * too, which is why it is not gated to Sprouts alone.
 *
 * The arc's shape is also deliberately gentle: the garden is empty, not
 * dying; nothing has been hurt; and the child fixes it in one visit.
 */
export const SAVE_THE_BUTTERFLY_GARDEN: StoryDefinition = {
  slug: 'save-the-butterfly-garden',
  title: 'Save the Butterfly Garden',
  description:
    'The butterfly garden has gone quiet and empty. Find out why, plant it back to life, and watch who comes home.',
  supportedAgeBands: ['SPROUT', 'PATHFINDER'],
  entryChapterId: 'the-quiet-garden',
  completionWorldChange: {
    changeType: 'STORY_COMPLETED',
    changeKey: 'SAVE_THE_BUTTERFLY_GARDEN_COMPLETE',
    locationSlug: 'butterfly-garden',
  },
  chapters: [
    {
      id: 'the-quiet-garden',
      title: 'The Quiet Garden',
      nextChapterId: 'plant-the-flowers',
      scenes: [
        {
          id: 'garden-gate',
          kind: 'NARRATIVE',
          speaker: 'Chatty the Parrot',
          text: 'Here is the garden gate. Listen. No fluttering, no buzzing. Something is missing in here.',
          aiNarrated: true,
        },
        {
          id: 'quiet-garden-adventure',
          kind: 'ADVENTURE',
          templateSlug: 'butterfly-chapter-1-quiet-garden',
        },
      ],
    },
    {
      id: 'plant-the-flowers',
      title: 'Plant the Flowers',
      nextChapterId: 'the-butterflies-come-home',
      scenes: [
        {
          id: 'plant-the-flowers-adventure',
          kind: 'ADVENTURE',
          templateSlug: 'butterfly-chapter-2-plant-the-flowers',
        },
        {
          id: 'choose-a-flower',
          kind: 'CHOICE',
          prompt: 'One flower can go right by the gate, where everyone will see it. Which one?',
          flagKey: 'gateFlower',
          options: [
            { id: 'opt-orange', label: 'A big orange flower', flagValue: 'orange' },
            { id: 'opt-purple', label: 'A tall purple flower', flagValue: 'purple' },
            { id: 'opt-yellow', label: 'A round yellow flower', flagValue: 'yellow' },
          ],
        },
      ],
    },
    {
      id: 'the-butterflies-come-home',
      title: 'The Butterflies Come Home',
      scenes: [
        {
          id: 'first-butterfly-returns',
          kind: 'NARRATIVE',
          speaker: 'Chatty the Parrot',
          text: 'Look! One butterfly. Then two. Then more than we can count, drinking from the flowers you planted.',
          branches: [
            {
              when: { flagKey: 'gateFlower', equals: 'orange' },
              text: 'Look! A butterfly lands on your big orange flower by the gate. Then two more. Then more than we can count, all through the garden.',
            },
            {
              when: { flagKey: 'gateFlower', equals: 'purple' },
              text: 'Look! A butterfly lands on your tall purple flower by the gate. Then two more. Then more than we can count, all through the garden.',
            },
            {
              when: { flagKey: 'gateFlower', equals: 'yellow' },
              text: 'Look! A butterfly lands on your round yellow flower by the gate. Then two more. Then more than we can count, all through the garden.',
            },
          ],
        },
        {
          id: 'garden-reflection',
          kind: 'REFLECTION',
          prompt: 'What is the very first thing you notice in the garden now?',
          objectiveIds: ['observation'],
        },
      ],
    },
  ],
};
