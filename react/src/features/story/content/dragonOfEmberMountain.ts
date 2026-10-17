import type { StoryDefinition } from '../engine/types';

/**
 * "The Dragon of Ember Mountain" — the Phase 12 reference story
 * (docs/ROADMAP.md, `docs/LEARNING_ADVENTURE_ISLAND_EXPLORABLE_WORLD_ROADMAP.md`
 * section 12), authored per that section's five-chapter outline. Scoped to
 * `supportedAgeBands: ['PATHFINDER']` only, the same first-story precedent
 * every other location's first adventure already used.
 *
 * Chapters 1, 2, 3, and 5 each embed one Adventure Engine challenge
 * (`src/features/adventures/content/emberMountainChapterAdventures.ts`) —
 * correctness for those stays fully deterministic, decided by the unchanged
 * Adventure Engine, never by this story layer or by AI (CLAUDE.md section
 * 7). Chapter 4 ("The Dragon's Cave") is narration and a reflection moment
 * with no embedded challenge, matching the roadmap's own description of
 * that chapter as the story's authored emotional turn, not a quiz.
 *
 * "Authored branching" (docs/ROADMAP.md Phase 12 deliverable) shows up as
 * chapter 4's `dragon-revelation` scene: which of three authored lines is
 * shown depends on the `trackDirection` flag chapter 3 sets — never on
 * child free text, never on a model's own judgment.
 */
export const DRAGON_OF_EMBER_MOUNTAIN: StoryDefinition = {
  slug: 'dragon-of-ember-mountain',
  title: 'The Dragon of Ember Mountain',
  description:
    'Smoke has appeared over Ember Mountain. Help Chatty find out what is happening, and who needs your help.',
  supportedAgeBands: ['PATHFINDER'],
  entryChapterId: 'broken-path',
  completionWorldChange: {
    changeType: 'STORY_COMPLETED',
    changeKey: 'DRAGON_OF_EMBER_MOUNTAIN_COMPLETE',
    locationSlug: 'ember-mountain',
  },
  chapters: [
    {
      id: 'broken-path',
      title: 'The Broken Path',
      nextChapterId: 'whispering-forest',
      scenes: [
        {
          id: 'chatty-arrives',
          kind: 'NARRATIVE',
          speaker: 'Chatty the Parrot',
          text: 'Something strange is happening beyond the mountain bridge! Look at all that smoke. Will you come with me and find out what it is?',
          aiNarrated: true,
        },
        {
          id: 'broken-path-adventure',
          kind: 'ADVENTURE',
          templateSlug: 'dragon-chapter-1-broken-path',
        },
      ],
    },
    {
      id: 'whispering-forest',
      title: 'The Whispering Forest',
      nextChapterId: 'dragon-tracks',
      scenes: [
        {
          id: 'whispering-forest-adventure',
          kind: 'ADVENTURE',
          templateSlug: 'dragon-chapter-2-whispering-forest',
        },
      ],
    },
    {
      id: 'dragon-tracks',
      title: 'Dragon Tracks',
      nextChapterId: 'dragons-cave',
      scenes: [
        {
          id: 'dragon-tracks-adventure',
          kind: 'ADVENTURE',
          templateSlug: 'dragon-chapter-3-dragon-tracks',
        },
        {
          id: 'track-direction',
          kind: 'CHOICE',
          prompt: 'Which way do you think these huge tracks lead?',
          flagKey: 'trackDirection',
          options: [
            { id: 'opt-volcano', label: 'Up toward the smoking volcano', flagValue: 'volcano' },
            { id: 'opt-cave', label: 'Toward a hidden cave in the cliffs', flagValue: 'cave' },
            { id: 'opt-river', label: 'Down along the mountain river', flagValue: 'river' },
          ],
        },
      ],
    },
    {
      id: 'dragons-cave',
      title: "The Dragon's Cave",
      nextChapterId: 'save-the-dragon',
      scenes: [
        {
          id: 'dragon-encounter',
          kind: 'NARRATIVE',
          speaker: 'Chatty the Parrot',
          text: 'The tracks end at a cave mouth, glowing faintly orange. Inside, curled tightly around something, is a dragon — and she has noticed you.',
          aiNarrated: true,
        },
        {
          id: 'dragon-revelation',
          kind: 'NARRATIVE',
          speaker: 'Chatty the Parrot',
          text: 'Look closely: she is not attacking. She is protecting her egg, because something frightened her away from her old home.',
          branches: [
            {
              when: { flagKey: 'trackDirection', equals: 'cave' },
              text: 'You remember guessing the tracks led to a hidden cave — and you were right. She is not attacking at all. She is protecting her egg, because something frightened her away from her old home.',
            },
            {
              when: { flagKey: 'trackDirection', equals: 'volcano' },
              text: 'You guessed the tracks led toward the volcano, but they curved here instead, to a hidden cave. She is not attacking. She is protecting her egg, because something frightened her away from her old home.',
            },
            {
              when: { flagKey: 'trackDirection', equals: 'river' },
              text: 'You guessed the tracks followed the river, but they climbed here instead, to a hidden cave. She is not attacking. She is protecting her egg, because something frightened her away from her old home.',
            },
          ],
        },
        {
          id: 'dragon-empathy',
          kind: 'REFLECTION',
          prompt:
            'Now that you understand why the dragon hid, how do you think she feels? What would help her feel safe again?',
          objectiveIds: ['empathy'],
        },
      ],
    },
    {
      id: 'save-the-dragon',
      title: 'Save the Dragon',
      scenes: [
        {
          id: 'save-the-dragon-adventure',
          kind: 'ADVENTURE',
          templateSlug: 'dragon-chapter-5-save-the-dragon',
        },
      ],
    },
  ],
};
