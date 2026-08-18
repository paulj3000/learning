import type { StoryDefinition } from '../engine/types';

/**
 * "The Castle's Secret Door" — the Adventure Library's mystery arc
 * (docs/ROADMAP.md Phase 15,
 * `docs/LEARNING_ADVENTURE_ISLAND_EXPLORABLE_WORLD_ROADMAP.md` section 34),
 * told by Keeper Quill, the Storykeeper Castle character Phase 14
 * introduced.
 *
 * Explorers only (ages 7-8). It is the one arc in the launch library gated
 * to a single band, which is what makes the library's age gate observable
 * in practice rather than only in tests: a Pathfinder's library shows four
 * arcs and a calm note, not five arcs.
 *
 * The `whatIsBehind` guess in chapter 2 is a prediction, not an answer.
 * Chapter 3 shows what is actually behind the door either way, then folds
 * the child's guess into the telling. Nothing behind the door is
 * frightening: the secret is a room the castle's old Storykeepers left
 * ready for whoever solved it.
 */
export const THE_CASTLES_SECRET_DOOR: StoryDefinition = {
  slug: 'the-castles-secret-door',
  title: "The Castle's Secret Door",
  description:
    'Behind the last bookshelf in Storykeeper Castle there is a door with no handle. Find the clues, solve the pattern, and open it.',
  supportedAgeBands: ['EXPLORER'],
  entryChapterId: 'three-clues',
  completionWorldChange: {
    changeType: 'STORY_COMPLETED',
    changeKey: 'THE_CASTLES_SECRET_DOOR_COMPLETE',
    locationSlug: 'castle-secret-passage',
  },
  chapters: [
    {
      id: 'three-clues',
      title: 'Three Clues',
      nextChapterId: 'the-pattern-lock',
      scenes: [
        {
          id: 'quill-shows-the-door',
          kind: 'NARRATIVE',
          speaker: 'Keeper Quill',
          text: 'I have kept this library for a very long time, and there is one thing in it I have never explained. Come and look behind the last bookshelf.',
          aiNarrated: true,
        },
        {
          id: 'three-clues-adventure',
          kind: 'ADVENTURE',
          templateSlug: 'secret-door-chapter-1-three-clues',
        },
      ],
    },
    {
      id: 'the-pattern-lock',
      title: 'The Pattern Lock',
      nextChapterId: 'what-was-waiting',
      scenes: [
        {
          id: 'pattern-lock-adventure',
          kind: 'ADVENTURE',
          templateSlug: 'secret-door-chapter-2-pattern-lock',
        },
        {
          id: 'predict-whats-behind',
          kind: 'CHOICE',
          prompt:
            'The door is ajar and warm light is spilling out. What do you predict is behind it?',
          flagKey: 'whatIsBehind',
          options: [
            { id: 'opt-room', label: 'A room the Storykeepers left ready', flagValue: 'room' },
            { id: 'opt-stairs', label: 'A staircase going down and down', flagValue: 'stairs' },
            { id: 'opt-garden', label: 'A garden hidden inside the castle', flagValue: 'garden' },
          ],
        },
      ],
    },
    {
      id: 'what-was-waiting',
      title: 'What Was Waiting',
      scenes: [
        {
          id: 'the-room-revealed',
          kind: 'NARRATIVE',
          speaker: 'Keeper Quill',
          text: 'It is a small round room with a window, a desk, and shelves of empty books. The Storykeepers built it for whoever solved the door, so they would have somewhere to write their own stories.',
          branches: [
            {
              when: { flagKey: 'whatIsBehind', equals: 'room' },
              text: 'You predicted a room, and a room it is: small and round, with a window, a desk, and shelves of empty books. The Storykeepers built it for whoever solved the door, so they would have somewhere to write their own stories.',
            },
            {
              when: { flagKey: 'whatIsBehind', equals: 'stairs' },
              text: 'You predicted a staircase going down and down. There is no staircase, but there is something better: a small round room with a window, a desk, and shelves of empty books, left ready for whoever solved the door.',
            },
            {
              when: { flagKey: 'whatIsBehind', equals: 'garden' },
              text: 'You predicted a hidden garden, and the warm light did look like sunshine. It comes from one round window in a small writing room, with a desk and shelves of empty books, left ready for whoever solved the door.',
            },
          ],
        },
        {
          id: 'quill-hands-over-the-room',
          kind: 'NARRATIVE',
          speaker: 'Keeper Quill',
          text: 'You solved it, so it is yours to use. Write the first story in the first empty book whenever you like. I will keep the door open.',
        },
        {
          id: 'secret-door-reflection',
          kind: 'REFLECTION',
          prompt:
            'Every clue turned out to matter in the end. Which clue helped you most, and what story would you write in the first empty book?',
          objectiveIds: ['curious-questioning'],
        },
      ],
    },
  ],
};
