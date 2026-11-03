import type { AgeBandValue } from '../../child-profile/constants';
import { pagesForBand, type StorybookPage } from '../../great-storybook/pages';
import type { QuestDefinition, QuestObjective } from '../types';

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
 *    and never leave. That still rules out `DELIVER` (no authored dialogue
 *    sets a delivery flag yet). `DISCOVER` became satisfiable in Phase 26
 *    and is used below by "The Quiet Places"; every key it names is checked
 *    against `ISLAND_DISCOVERY_IDS` by the test.
 * 2. **A branch never leads somewhere harder to leave than the path it
 *    skipped.** Branches here exist to let a child who already did
 *    something skip repeating it, never to gate a reward behind a second
 *    condition.
 */
/**
 * The Great Storybook (SC-R04-01, reboot roadmap sections 1 and 4): Keeper Quill's
 * castle quest. The Great Storybook has been damaged and its pages scattered
 * through Storykeeper Castle; the child recovers them by doing what the castle
 * already asks of them, and the book is restored.
 *
 * **One quest per age band, each on its own page set**, so the Storybook is whole
 * when *that band's* required pages are back and a Sprout is never shown slots meant
 * for an eight-year-old. The page sets, and what each page is restored by, come
 * from `features/great-storybook/pages.ts`: this file only turns them into objectives,
 * so the registry and the quest cannot disagree (a test also checks it).
 *
 * Every objective is one the quest engine already credits, on records the castle's
 * existing content already writes: `BUILD` on the world change a finished adventure or
 * story records, and `DISCOVER` on the nook. Nothing about the quest grades an answer or
 * grants a page: a page is *derived* from those records.
 *
 * The hidden nook page is an optional bonus in every band. It is a vague, unspoilt
 * line in the journal, never a location, so a child who has not found the castle's one
 * unmarked secret is not told it is there.
 */
const GREAT_STORYBOOK_RESTORED = {
  locationSlug: 'storykeeper-castle',
  changeType: 'CREATE',
  changeKey: 'GREAT_STORYBOOK_RESTORED',
};

function storybookObjective(page: StorybookPage): QuestObjective {
  if (page.source.kind === 'DISCOVERY') {
    return {
      id: `storybook-${page.id}`,
      kind: 'DISCOVER',
      discoveryKey: page.source.discoveryId,
      optional: true,
      // Deliberately vague: this is the castle's one unmarked secret.
      label: 'Is there one more page, hiding somewhere?',
    };
  }
  return {
    id: `storybook-${page.id}`,
    kind: 'BUILD',
    changeKey: page.source.changeKey,
    label: `Bring back the page called "${page.title}"`,
  };
}

function greatStorybookQuest(
  band: AgeBandValue,
  id: string,
  summary: string,
  journalNote: string,
): QuestDefinition {
  return {
    id,
    title: 'The Great Storybook',
    summary,
    giverNpcId: 'keeper-quill',
    ageBands: [band],
    prerequisites: [{ type: 'ALWAYS' }],
    entryStageId: 'meet-quill',
    stages: [
      {
        id: 'meet-quill',
        title: 'Hear what happened to the book',
        objectives: [
          {
            id: 'storybook-talk-to-quill',
            kind: 'TALK_TO',
            npcId: 'keeper-quill',
            memoryFlag: 'metQuill',
            label: 'Talk to Keeper Quill about the Great Storybook',
          },
        ],
        nextStageId: 'bring-back-the-pages',
      },
      {
        id: 'bring-back-the-pages',
        title: 'Bring back the missing pages',
        objectives: pagesForBand(band).map(storybookObjective),
      },
    ],
    completion: {
      journalNote,
      worldChanges: [GREAT_STORYBOOK_RESTORED],
      setsNpcMemoryFlags: [{ npcId: 'keeper-quill', flags: ['restoredTheStorybook'] }],
    },
  };
}

export const GREAT_STORYBOOK_QUEST_IDS = {
  SPROUT: 'restore-the-great-storybook-sprouts',
  PATHFINDER: 'restore-the-great-storybook-pathfinders',
  EXPLORER: 'restore-the-great-storybook-explorers',
} as const satisfies Record<AgeBandValue, string>;

const GREAT_STORYBOOK_QUESTS: QuestDefinition[] = [
  greatStorybookQuest(
    'SPROUT',
    GREAT_STORYBOOK_QUEST_IDS.SPROUT,
    'The Great Storybook lost its pages. Help Keeper Quill bring them back.',
    'The Great Storybook is whole again, and Keeper Quill is very happy.',
  ),
  greatStorybookQuest(
    'PATHFINDER',
    GREAT_STORYBOOK_QUEST_IDS.PATHFINDER,
    'The Great Storybook lost its pages. Find them and bring them back to Keeper Quill.',
    'You brought the pages back and restored the Great Storybook. Its first story is yours.',
  ),
  greatStorybookQuest(
    'EXPLORER',
    GREAT_STORYBOOK_QUEST_IDS.EXPLORER,
    'Pages of the Great Storybook are scattered through the castle. Find them all and restore the book.',
    'Every page is back. You solved the castle secrets and restored the Great Storybook.',
  ),
];

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
  /**
   * Phase 26's optional quest chain (docs/ROADMAP.md Phase 26).
   *
   * Three things make it unlike the three quests above, and all three are
   * deliberate:
   *
   * - **No `giverNpcId`.** Nobody asks for this. It starts the moment a
   *   child finds the first secret on their own
   *   (`DiscoveryDefinition.startsQuestId`), which is roadmap section 16's
   *   "child explores -> finds something -> story begins" flow rather than
   *   accepting an errand. It is also why this quest is playable today at
   *   all: accepting a quest from an NPC needs a conversation screen, and
   *   there is not one yet.
   * - **Every objective is `DISCOVER`.** Nothing here is graded, timed, or
   *   failable, and the quest gates no learning content - it is entirely
   *   made of looking around.
   * - **All three age bands.** The other quests target readers because
   *   their objectives run through multi-step adventures. A Sprout who
   *   wanders into the tide pool has already done the first stage, so
   *   excluding them would mean starting a quest and then hiding it.
   *
   * The stage order follows the only dependency the content actually has:
   * the driftwood key is in the cove tunnel and the keeper's door needs it,
   * so the door is an *optional* objective one stage later, never a wall.
   */
  {
    id: 'the-quiet-places',
    title: 'The Quiet Places',
    summary: 'Find the corners of the island where nobody goes.',
    ageBands: ['SPROUT', 'PATHFINDER', 'EXPLORER'],
    prerequisites: [{ type: 'ALWAYS' }],
    entryStageId: 'the-first-quiet-place',
    stages: [
      {
        id: 'the-first-quiet-place',
        title: 'Find the first quiet place',
        objectives: [
          {
            id: 'quiet-places-tide-pool',
            kind: 'DISCOVER',
            discoveryKey: 'harbor-tide-pool',
            label: 'Find the tide pool behind the rocks',
          },
        ],
        // Already satisfied when the quest starts, since finding the tide
        // pool is what starts it. A child sees this stage tick over
        // immediately rather than being asked to redo what they just did.
        nextStageId: 'look-a-little-further',
      },
      {
        id: 'look-a-little-further',
        title: 'Look a little further',
        objectives: [
          {
            id: 'quiet-places-tide-tunnel',
            kind: 'DISCOVER',
            discoveryKey: 'bay-tide-tunnel',
            label: 'Find what is at the back of the cove',
          },
          {
            id: 'quiet-places-glow-moss',
            kind: 'DISCOVER',
            discoveryKey: 'wonderwild-glow-moss',
            label: 'Find the light under the ferns',
          },
        ],
        nextStageId: 'the-last-two',
      },
      {
        id: 'the-last-two',
        title: 'Find the last two',
        objectives: [
          {
            id: 'quiet-places-glowworm-cave',
            kind: 'DISCOVER',
            discoveryKey: 'wonderwild-glowworm-cave',
            label: 'See what is inside the dark cave',
          },
          {
            id: 'quiet-places-tapestry-stair',
            kind: 'DISCOVER',
            discoveryKey: 'castle-tapestry-stair',
            label: 'Find out why the tapestry moves',
          },
          {
            id: 'quiet-places-keepers-door',
            kind: 'DISCOVER',
            discoveryKey: 'harbor-keepers-door',
            label: "Open the harbor keeper's door",
            optional: true,
          },
        ],
      },
    ],
    completion: {
      journalNote:
        'You found every quiet place on the island. A shell nobody has ever heard is waiting for you at the tide pool.',
      // No world change of its own: each secret already recorded one where
      // it happened, and a fifth key recorded at no particular place would
      // mean nothing to the island.
    },
  },
  ...GREAT_STORYBOOK_QUESTS,
];
