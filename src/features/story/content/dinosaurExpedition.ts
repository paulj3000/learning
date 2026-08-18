import type { StoryDefinition } from '../engine/types';

/**
 * "Dinosaur Expedition" — the Adventure Library's exploration arc
 * (docs/ROADMAP.md Phase 15,
 * `docs/LEARNING_ADVENTURE_ISLAND_EXPLORABLE_WORLD_ROADMAP.md` section 34).
 *
 * Three chapters rather than the reference story's five: two chapters embed
 * a real Adventure Engine challenge
 * (`src/features/adventures/content/dinosaurExpeditionAdventures.ts`), and
 * the third is the payoff, where the evidence the child gathered is put
 * together. Correctness in the embedded chapters stays entirely with the
 * unchanged Adventure Engine (CLAUDE.md section 7).
 *
 * Authored branching lives in `who-walked-here`: the child's guess in
 * chapter 2 chooses which of three authored reveals is shown. Crucially,
 * the guess is never graded and the story never says a child was "wrong" to
 * guess. Every branch lands on the same evidence, then says what that
 * evidence shows. That is how a real expedition works, and it keeps a
 * bounded, curated choice from turning into a hidden quiz.
 */
export const DINOSAUR_EXPEDITION: StoryDefinition = {
  slug: 'dinosaur-expedition',
  title: 'Dinosaur Expedition',
  description:
    'Something enormous is buried at Fossil Ridge. Dig it out, follow the footprints, and work out who left them.',
  supportedAgeBands: ['PATHFINDER', 'EXPLORER'],
  entryChapterId: 'fossil-dig',
  completionWorldChange: {
    changeType: 'STORY_COMPLETED',
    changeKey: 'DINOSAUR_EXPEDITION_COMPLETE',
    locationSlug: 'fossil-ridge',
  },
  chapters: [
    {
      id: 'fossil-dig',
      title: 'The Fossil Dig',
      nextChapterId: 'footprint-trail',
      scenes: [
        {
          id: 'expedition-begins',
          kind: 'NARRATIVE',
          speaker: 'Chatty the Parrot',
          text: 'Pack the brushes! The wind blew the sand off Fossil Ridge last night, and something enormous is sticking out of the cliff.',
          aiNarrated: true,
        },
        {
          id: 'fossil-dig-adventure',
          kind: 'ADVENTURE',
          templateSlug: 'dino-chapter-1-fossil-dig',
        },
      ],
    },
    {
      id: 'footprint-trail',
      title: 'The Footprint Trail',
      nextChapterId: 'who-walked-here',
      scenes: [
        {
          id: 'footprint-trail-adventure',
          kind: 'ADVENTURE',
          templateSlug: 'dino-chapter-2-footprint-trail',
        },
        {
          id: 'track-maker-guess',
          kind: 'CHOICE',
          prompt: 'Before we look at the evidence, what is your hunch? Who left these footprints?',
          flagKey: 'trackMaker',
          options: [
            {
              id: 'opt-long-neck',
              label: 'A huge plant eater with a very long neck',
              flagValue: 'longNeck',
            },
            { id: 'opt-meat-eater', label: 'A sharp toothed meat eater', flagValue: 'meatEater' },
            { id: 'opt-runner', label: 'A small, fast runner', flagValue: 'runner' },
          ],
        },
      ],
    },
    {
      id: 'who-walked-here',
      title: 'Who Walked Here',
      scenes: [
        {
          id: 'lay-out-the-evidence',
          kind: 'NARRATIVE',
          speaker: 'Chatty the Parrot',
          text: 'Let’s lay the evidence out: six long curved bones, footprints as wide as a wheel, round with short blunt toes, and huge gaps between one step and the next.',
        },
        {
          id: 'the-reveal',
          kind: 'NARRATIVE',
          speaker: 'Chatty the Parrot',
          text: 'Round feet, blunt toes, and enormous steps. This was a giant plant eater with a long neck, strolling along the ridge. A meat eater would have left narrow prints with three sharp toes.',
          branches: [
            {
              when: { flagKey: 'trackMaker', equals: 'longNeck' },
              text: 'Your hunch matches the evidence exactly. Round feet, blunt toes, and enormous steps all point to a giant plant eater with a long neck, strolling along the ridge.',
            },
            {
              when: { flagKey: 'trackMaker', equals: 'meatEater' },
              text: 'You guessed a meat eater, and that was a fair guess for prints this big. But a meat eater leaves narrow prints with three sharp toes. These are round with blunt toes, so this was a giant plant eater with a long neck.',
            },
            {
              when: { flagKey: 'trackMaker', equals: 'runner' },
              text: 'You guessed a small, fast runner. A runner leaves small prints close together, and these are as wide as a wheel with huge gaps between them. So this was a giant plant eater with a long neck, taking slow, enormous steps.',
            },
          ],
        },
        {
          id: 'expedition-reflection',
          kind: 'REFLECTION',
          prompt:
            'Fossil hunters change their minds when the evidence says so. What would you want to dig up next, and what would it tell you?',
          objectiveIds: ['curious-questioning'],
        },
      ],
    },
  ],
};
