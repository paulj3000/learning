import type { StoryDefinition } from '../engine/types';

/**
 * "Robot Rescue" — the Adventure Library's building arc (docs/ROADMAP.md
 * Phase 15, `docs/LEARNING_ADVENTURE_ISLAND_EXPLORABLE_WORLD_ROADMAP.md`
 * section 34), set on Robot Repair Reef (a region named in roadmap
 * section 5 and still a story-only pseudo-location for now).
 *
 * Two chapters embed real Adventure Engine challenges
 * (`src/features/adventures/content/robotRescueAdventures.ts`); the third
 * hands the child the one decision the engine cannot grade, which is what
 * Bolt should do next. That choice sets `robotJob`, and it is the only
 * thing the closing scene branches on.
 *
 * The reflection is about the harbor's people, not about the robot's
 * feelings: Bolt is a machine throughout, and the story never suggests
 * otherwise (see the note in `robotRescueAdventures.ts`).
 */
export const ROBOT_RESCUE: StoryDefinition = {
  slug: 'robot-rescue',
  title: 'Robot Rescue',
  description:
    'Bolt, the little harbor robot, has stopped working out on the reef. Find every part and build it back together.',
  supportedAgeBands: ['PATHFINDER', 'EXPLORER'],
  entryChapterId: 'stalled-on-the-reef',
  completionWorldChange: {
    changeType: 'STORY_COMPLETED',
    changeKey: 'ROBOT_RESCUE_COMPLETE',
    locationSlug: 'robot-repair-reef',
  },
  chapters: [
    {
      id: 'stalled-on-the-reef',
      title: 'Stalled on the Reef',
      nextChapterId: 'build-it-back',
      scenes: [
        {
          id: 'bolt-has-stopped',
          kind: 'NARRATIVE',
          speaker: 'Chatty the Parrot',
          text: 'Every morning Bolt carries crates along the harbor wall. This morning Bolt did not come, and the crates are piling up. Let’s go out to the reef and find out why.',
          aiNarrated: true,
        },
        {
          id: 'gather-parts-adventure',
          kind: 'ADVENTURE',
          templateSlug: 'robot-chapter-1-gather-parts',
        },
      ],
    },
    {
      id: 'build-it-back',
      title: 'Build It Back',
      nextChapterId: 'bolt-rolls-again',
      scenes: [
        {
          id: 'build-it-back-adventure',
          kind: 'ADVENTURE',
          templateSlug: 'robot-chapter-2-build-it-back',
        },
        {
          id: 'choose-bolts-job',
          kind: 'CHOICE',
          prompt: 'Bolt is working again. What job should Bolt take on now?',
          flagKey: 'robotJob',
          options: [
            {
              id: 'opt-crates',
              label: 'Carrying crates along the harbor wall',
              flagValue: 'crates',
            },
            { id: 'opt-garden', label: 'Watering the gardens on the hill', flagValue: 'garden' },
            { id: 'opt-lamp', label: 'Keeping the lighthouse lamp polished', flagValue: 'lamp' },
          ],
        },
      ],
    },
    {
      id: 'bolt-rolls-again',
      title: 'Bolt Rolls Again',
      scenes: [
        {
          id: 'bolt-goes-to-work',
          kind: 'NARRATIVE',
          speaker: 'Chatty the Parrot',
          text: 'Bolt rolls off the reef and back toward the harbor, wheels turning steadily, ready for a full day of work.',
          branches: [
            {
              when: { flagKey: 'robotJob', equals: 'crates' },
              text: 'Bolt rolls straight to the harbor wall and lifts the very first crate off the pile. By lunchtime the whole stack is gone, and the harbor is busy again.',
            },
            {
              when: { flagKey: 'robotJob', equals: 'garden' },
              text: 'Bolt rolls up the hill path with a water tank strapped on top, and works along the rows until every plant has had a drink.',
            },
            {
              when: { flagKey: 'robotJob', equals: 'lamp' },
              text: 'Bolt rolls out to the lighthouse and polishes the great lamp until it throws a clean white beam across the water.',
            },
          ],
        },
        {
          id: 'rescue-reflection',
          kind: 'REFLECTION',
          prompt:
            'The whole harbor noticed when Bolt stopped. Who helps where you live, and what would people miss if they stopped?',
          objectiveIds: ['empathy'],
        },
      ],
    },
  ],
};
