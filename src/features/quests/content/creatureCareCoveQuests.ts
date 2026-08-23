import type { QuestDefinition } from '../types';

/**
 * Creature Care Cove's quests (docs/ROADMAP.md Phase 29).
 *
 * One quest, authored under the same two rules `islandQuests.ts` states:
 * every objective is satisfiable by content that exists today, and no branch
 * leads somewhere harder to leave than the path it skipped.
 *
 * Two authoring notes specific to a *second world* are worth stating, since
 * this is the first quest that had to think about them:
 *
 * - **It has no `giverNpcId`.** The cove has no explorable map yet, and an
 *   NPC can only be talked to from inside a world view, so a giver here
 *   would be a character nobody could reach. A quest with no giver is
 *   offered by the journal itself once its prerequisites pass, exactly like
 *   "The Quiet Places".
 * - **Its prerequisite is the arrival record.** `ARRIVED_AT_CREATURE_CARE_COVE`
 *   is written by the travel system the first time a child lands here
 *   (src/features/worlds/api.ts), so this quest cannot appear in the journal
 *   of a child who has never sailed. That is the same failure the quest
 *   journal's age filter was written to prevent: advertising work that
 *   cannot be started.
 *
 * It carries no `FIND` objective, though the cove has treasure to find,
 * because everything the cove grants is granted *by finishing this quest*
 * (see `creatureCareCoveItems.ts` for why). An objective asking a child to
 * hold an item they can only receive by completing the quest that asks for
 * it would be unsatisfiable, optional or not.
 */
export const CREATURE_CARE_COVE_QUESTS: QuestDefinition[] = [
  {
    id: 'helping-at-the-cove',
    title: 'Helping at the Cove',
    summary: 'Help Nella through a morning care round, and the cove lights its lanterns for you.',
    ageBands: ['SPROUT', 'PATHFINDER', 'EXPLORER'],
    prerequisites: [{ type: 'WORLD_CHANGE', changeKey: 'ARRIVED_AT_CREATURE_CARE_COVE' }],
    entryStageId: 'find-your-way-around',
    stages: [
      {
        id: 'find-your-way-around',
        title: 'Walk the care beach',
        objectives: [
          {
            id: 'cove-explore-beach',
            kind: 'EXPLORE',
            locationSlug: 'cove-care-beach',
            label: 'Arrive at the care beach',
          },
        ],
        nextStageId: 'do-the-care-round',
      },
      {
        id: 'do-the-care-round',
        title: 'Help with the morning care round',
        objectives: [
          {
            id: 'cove-creatures-fed',
            kind: 'BUILD',
            changeKey: 'COVE_CREATURES_FED',
            label: 'See every creature at the cove fed and settled',
          },
        ],
      },
    ],
    completion: {
      journalNote:
        'You did a whole care round at the cove. Nella lit the lanterns along the tide pools so you can visit them any time.',
      worldChanges: [
        {
          locationSlug: 'lantern-tide-pools',
          changeType: 'UPDATE',
          changeKey: 'COVE_LANTERNS_LIT',
        },
      ],
    },
  },
];
