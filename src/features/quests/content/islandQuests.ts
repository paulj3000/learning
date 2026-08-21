import type { QuestDefinition } from '../types';

/**
 * The island's authored quests (docs/ROADMAP.md Phase 25).
 *
 * Every quest here closes a loop that earlier phases deliberately left
 * open. Phase 23 authored three `NpcQuestOffer`s - Pip's bridge, Quill's
 * story, Bolt's workshop - whose `questId`s pointed at nothing, because the
 * quest model did not exist yet. These are those three quests, by those
 * exact ids, which `islandQuests.test.ts` asserts.
 *
 * Two authoring rules hold across this file, both enforced by tests rather
 * than left to care:
 *
 * 1. **Every objective must be satisfiable by content that exists today.**
 *    An objective naming an adventure slug, item, memory flag, or world
 *    change that nothing can produce is a dead end a child could walk into
 *    and never leave. That rules out `DISCOVER` (Phase 26 owns it) and
 *    `DELIVER` (no authored dialogue sets a delivery flag yet) until the
 *    content that feeds them ships.
 * 2. **A branch never leads somewhere harder to leave than the path it
 *    skipped.** Branches here exist to let a child who already did
 *    something skip repeating it, never to gate a reward behind a second
 *    condition.
 */
export const ISLAND_QUESTS: QuestDefinition[] = [
  {
    id: 'repair-the-bridge',
    title: 'The Moonlight Bridge',
    summary: 'Help Pip count and measure planks to repair the harbor bridge.',
    giverNpcId: 'pirate-pip',
    ageBands: ['PATHFINDER', 'EXPLORER'],
    prerequisites: [{ type: 'ALWAYS' }],
    entryStageId: 'hear-pip-out',
    stages: [
      {
        id: 'hear-pip-out',
        title: 'Ask Pip about the bridge',
        objectives: [
          {
            id: 'bridge-talk-to-pip',
            kind: 'TALK_TO',
            npcId: 'pirate-pip',
            memoryFlag: 'heardAboutBridge',
            label: 'Talk to Pip at the shipyard',
          },
        ],
        // A child who repaired the bridge before ever accepting the quest
        // skips straight to the end rather than being asked to do it again.
        branches: [
          {
            conditions: [{ type: 'WORLD_CHANGE', changeKey: 'BRIDGE_REPAIRED' }],
            nextStageId: 'bridge-stands-again',
          },
        ],
        nextStageId: 'fix-the-bridge',
      },
      {
        id: 'fix-the-bridge',
        title: 'Repair the moonlight bridge',
        objectives: [
          {
            id: 'bridge-solve-adventure',
            kind: 'SOLVE',
            adventureSlug: 'repair-the-moonlight-bridge',
            label: 'Finish the bridge repair with Pip',
          },
          {
            id: 'bridge-find-shell',
            kind: 'FIND',
            itemId: 'spiral-shell',
            label: 'Pick up the shell that washes ashore while you work',
            optional: true,
          },
        ],
        nextStageId: 'bridge-stands-again',
      },
      {
        id: 'bridge-stands-again',
        title: 'Cross the finished bridge',
        objectives: [
          {
            id: 'bridge-world-change',
            kind: 'BUILD',
            changeKey: 'BRIDGE_REPAIRED',
            label: 'See the bridge standing again',
          },
        ],
        worldChanges: [
          {
            locationSlug: 'pirate-builder-bay',
            changeType: 'CREATE',
            changeKey: 'HARBOR_BRIDGE_LANTERNS_LIT',
          },
        ],
      },
    ],
    completion: {
      journalNote: 'You and Pip rebuilt the moonlight bridge. Lanterns line it now.',
      // Closes the gate Phase 23 authored on Pip's own offer: until a quest
      // engine existed, nothing could set this flag, so Pip would have kept
      // asking for the bridge forever.
      setsNpcMemoryFlags: [{ npcId: 'pirate-pip', flags: ['bridgeQuestCompleted'] }],
    },
  },
  {
    id: 'tell-a-story-together',
    title: 'A Story for the Shelf',
    summary: 'Build a story with Keeper Quill, one choice at a time.',
    giverNpcId: 'keeper-quill',
    ageBands: ['PATHFINDER', 'EXPLORER'],
    prerequisites: [{ type: 'ALWAYS' }],
    entryStageId: 'meet-quill',
    stages: [
      {
        id: 'meet-quill',
        title: 'Visit the castle library',
        objectives: [
          {
            id: 'story-talk-to-quill',
            kind: 'TALK_TO',
            npcId: 'keeper-quill',
            memoryFlag: 'metQuill',
            label: 'Meet Keeper Quill in the library',
          },
        ],
        nextStageId: 'tell-the-tale',
      },
      {
        id: 'tell-the-tale',
        title: 'Make a story together',
        objectives: [
          {
            id: 'story-solve-adventure',
            kind: 'SOLVE',
            adventureSlug: 'the-storykeepers-tale',
            label: "Finish The Storykeeper's Tale",
          },
          {
            id: 'story-keep-the-quill',
            kind: 'FIND',
            itemId: 'storykeepers-quill',
            label: 'Keep the feather pen Quill gives you',
            optional: true,
          },
        ],
        nextStageId: 'shelve-the-story',
      },
      {
        id: 'shelve-the-story',
        title: 'Put your story on the shelf',
        objectives: [
          {
            id: 'story-world-change',
            kind: 'BUILD',
            changeKey: 'FIRST_STORY_TOLD',
            label: 'See your story added to the library shelf',
          },
        ],
      },
    ],
    completion: {
      journalNote: "Your story sits on Keeper Quill's shelf, with your name on it.",
      // The other flag Phase 23 authored a greeting for but could never set.
      setsNpcMemoryFlags: [{ npcId: 'keeper-quill', flags: ['finishedAStory'] }],
    },
  },
  {
    id: 'sort-the-workshop',
    title: "Bolt's Scattered Parts",
    summary: 'Help Bolt sort the workshop parts into the right bins.',
    giverNpcId: 'bolt',
    ageBands: ['PATHFINDER', 'EXPLORER'],
    // No prerequisite: Bolt's own offer is already gated on having met him
    // (islandNpcs.ts), and this quest's first stage is that meeting, so
    // gating here too would only make the quest invisible to the child who
    // is standing in front of Bolt reading it.
    prerequisites: [{ type: 'ALWAYS' }],
    entryStageId: 'meet-bolt',
    stages: [
      {
        id: 'meet-bolt',
        title: 'Find Bolt in the workshop',
        objectives: [
          {
            id: 'workshop-talk-to-bolt',
            kind: 'TALK_TO',
            npcId: 'bolt',
            memoryFlag: 'metBolt',
            label: 'Say hello to Bolt',
          },
        ],
        branches: [
          {
            conditions: [{ type: 'WORLD_CHANGE', changeKey: 'ROBOT_BOLT_REBUILT' }],
            nextStageId: 'workshop-tidy',
          },
        ],
        nextStageId: 'gather-the-parts',
      },
      {
        id: 'gather-the-parts',
        title: 'Sort every part into its bin',
        objectives: [
          {
            id: 'workshop-solve-gather',
            kind: 'SOLVE',
            adventureSlug: 'robot-chapter-1-gather-parts',
            label: 'Sort the scattered parts with Bolt',
          },
        ],
        nextStageId: 'build-it-back',
      },
      {
        id: 'build-it-back',
        title: 'Put Bolt back together',
        objectives: [
          {
            id: 'workshop-solve-rebuild',
            kind: 'SOLVE',
            adventureSlug: 'robot-chapter-2-build-it-back',
            label: 'Rebuild Bolt from the sorted parts',
          },
        ],
        nextStageId: 'workshop-tidy',
      },
      {
        id: 'workshop-tidy',
        title: 'Admire the tidy workshop',
        objectives: [
          {
            id: 'workshop-world-change',
            kind: 'BUILD',
            changeKey: 'ROBOT_WORKBENCH_READY',
            label: 'See the workbench stacked and ready',
          },
        ],
        worldChanges: [
          {
            locationSlug: 'bolts-workshop',
            changeType: 'CREATE',
            changeKey: 'WORKSHOP_SORTED',
          },
        ],
      },
    ],
    completion: {
      journalNote: 'Every part has a bin now, and Bolt can find anything in one try.',
    },
  },
];
