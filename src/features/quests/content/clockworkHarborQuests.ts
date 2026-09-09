import type { QuestDefinition } from '../types';

/**
 * Clockwork Harbor's quests (`docs/regions/clockwork.md` sections 6 and 10).
 *
 * Section 6 requires the harbor to "use the shared LAI quest system" rather
 * than grow one of its own, so this is an ordinary `QuestDefinition` beside
 * the island's existing four, and it obeys the same two authoring rules
 * `islandQuests.ts` states:
 *
 * 1. Every objective must be satisfiable by content that exists today. The
 *    `SOLVE` objective names all three authored lighthouse variants, because
 *    which one a child is served depends on their Learning Profile
 *    (`resolveAdventureForSkillLevel`) - naming only one would leave a child
 *    who legitimately played a different variant unable to finish the quest.
 * 2. A branch never leads somewhere harder to leave than the path it skipped.
 *    The branch here lets a child who already lit the lighthouse - by walking
 *    into it and using the machine, before ever speaking to the Harbor Master
 *    - skip straight to the end rather than being asked to do it twice.
 */
export const CLOCKWORK_HARBOR_QUESTS: QuestDefinition[] = [
  {
    id: 'light-the-harbor',
    title: 'The Dark Lighthouse',
    summary: 'Help the Harbor Master get the lighthouse turning again.',
    giverNpcId: 'harbor-master',
    /*
      Every band, because all three difficulty variants together cover all
      three bands: the counting variant is authored for SPROUT and PATHFINDER,
      the grouping variant for PATHFINDER and EXPLORER, the two-step for
      EXPLORER. A band listed here with no playable variant would be an offer
      that cannot be completed.
    */
    ageBands: ['SPROUT', 'PATHFINDER', 'EXPLORER'],
    prerequisites: [{ type: 'ALWAYS' }],
    entryStageId: 'hear-the-harbor-master-out',
    stages: [
      {
        id: 'hear-the-harbor-master-out',
        title: 'Ask the Harbor Master about the gate',
        objectives: [
          {
            id: 'lighthouse-talk-to-harbor-master',
            kind: 'TALK_TO',
            npcId: 'harbor-master',
            memoryFlag: 'heardAboutLighthouse',
            label: 'Talk to the Harbor Master on the docks',
          },
        ],
        branches: [
          {
            conditions: [{ type: 'WORLD_CHANGE', changeKey: 'CLOCKWORK_LIGHTHOUSE_FIXED' }],
            nextStageId: 'the-lamp-turns-again',
          },
        ],
        nextStageId: 'restart-the-machine',
      },
      {
        id: 'restart-the-machine',
        title: 'Get the lighthouse machine running',
        objectives: [
          {
            id: 'lighthouse-solve',
            kind: 'SOLVE',
            adventureSlug: 'the-dark-lighthouse-groups',
            label: 'Power up the machine inside the lighthouse',
          },
        ],
        branches: [
          {
            conditions: [{ type: 'WORLD_CHANGE', changeKey: 'CLOCKWORK_LIGHTHOUSE_FIXED' }],
            nextStageId: 'the-lamp-turns-again',
          },
        ],
        nextStageId: 'the-lamp-turns-again',
      },
      {
        id: 'the-lamp-turns-again',
        title: 'See the harbor gate open',
        objectives: [
          {
            id: 'lighthouse-world-change',
            kind: 'BUILD',
            changeKey: 'CLOCKWORK_LIGHTHOUSE_FIXED',
            label: 'The lighthouse turns again',
          },
        ],
      },
    ],
    completion: {
      journalNote:
        'You got the lighthouse turning again. Its beam sweeps the water, and the harbor gate is open.',
      setsNpcMemoryFlags: [
        { npcId: 'harbor-master', flags: ['lighthouseLit'] },
        // Professor Ticktock has a line that only makes sense afterwards, and
        // nothing else would ever set it.
        { npcId: 'professor-ticktock', flags: ['lighthouseLit'] },
      ],
    },
  },
];
