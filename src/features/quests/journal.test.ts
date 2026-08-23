import { describe, expect, it } from 'vitest';
import { availableQuests, buildJournalEntry, buildQuestJournal } from './journal';
import { startQuest } from './quest';
import { EMPTY_QUEST_CONTEXT, type QuestContext, type QuestDefinition } from './types';

function context(overrides: Partial<QuestContext> = {}): QuestContext {
  return { ...EMPTY_QUEST_CONTEXT, ...overrides };
}

const QUEST: QuestDefinition = {
  id: 'q1',
  title: 'The Moonlight Bridge',
  summary: 'Help Pip fix the bridge.',
  giverNpcId: 'pirate-pip',
  ageBands: ['PATHFINDER'],
  prerequisites: [{ type: 'ALWAYS' }],
  entryStageId: 'stage-1',
  stages: [
    {
      id: 'stage-1',
      title: 'Talk to Pip',
      objectives: [
        {
          id: 'talk',
          kind: 'TALK_TO',
          npcId: 'pirate-pip',
          memoryFlag: 'met',
          label: 'Talk to Pip',
        },
      ],
      nextStageId: 'stage-2',
    },
    {
      id: 'stage-2',
      title: 'Fix the bridge',
      objectives: [
        { id: 'solve', kind: 'SOLVE', adventureSlug: 'bridge', label: 'Repair the bridge' },
        { id: 'shell', kind: 'FIND', itemId: 'shell', label: 'Find a shell', optional: true },
      ],
    },
  ],
  completion: { journalNote: 'The bridge stands again.' },
};

const LOCKED_QUEST: QuestDefinition = {
  ...QUEST,
  id: 'q2',
  title: 'Locked',
  prerequisites: [{ type: 'QUEST_COMPLETED', questId: 'q1' }],
};

const STARTED = startQuest(QUEST, '2026-01-01T00:00:00.000Z');

describe('buildJournalEntry', () => {
  it('shows an unstarted, eligible quest as available with no objectives yet', () => {
    const entry = buildJournalEntry(QUEST, undefined, context());

    expect(entry).toMatchObject({
      questId: 'q1',
      status: 'AVAILABLE',
      title: 'The Moonlight Bridge',
      giverNpcId: 'pirate-pip',
      stagesCompleted: 0,
      stageCount: 2,
    });
    expect(entry?.objectives).toEqual([]);
  });

  it('omits a quest whose prerequisites are unmet rather than showing it locked', () => {
    expect(buildJournalEntry(LOCKED_QUEST, undefined, context())).toBeUndefined();
    expect(
      buildJournalEntry(LOCKED_QUEST, undefined, context({ completedQuestIds: ['q1'] })),
    ).toBeDefined();
  });

  it('shows the current stage and marks which objectives are done', () => {
    const entry = buildJournalEntry(
      QUEST,
      STARTED,
      context({ npcMemoryFlags: { 'pirate-pip': { met: true } }, ownedItemIds: ['shell'] }),
    );

    expect(entry?.status).toBe('ACTIVE');
    expect(entry?.stageTitle).toBe('Fix the bridge');
    expect(entry?.objectives).toEqual([
      { id: 'solve', label: 'Repair the bridge', done: false, optional: false },
      { id: 'shell', label: 'Find a shell', done: true, optional: true },
    ]);
  });

  /**
   * The save/resume property: the journal is projected against current world
   * state, so a child who did the work while the quest sat untouched sees it
   * already credited rather than being asked to repeat it.
   */
  it('projects a stale stored state forward without needing a write first', () => {
    const entry = buildJournalEntry(
      QUEST,
      STARTED,
      context({
        npcMemoryFlags: { 'pirate-pip': { met: true } },
        completedAdventureSlugs: ['bridge'],
      }),
    );

    expect(entry?.status).toBe('COMPLETED');
    expect(entry?.journalNote).toBe('The bridge stands again.');
  });

  it('shows the authored wrap-up note only once the quest is finished', () => {
    const active = buildJournalEntry(QUEST, STARTED, context());
    expect(active?.journalNote).toBeUndefined();
  });
});

describe('buildQuestJournal', () => {
  it('orders the journal as active, then available, then completed', () => {
    const finished = { ...startQuest(LOCKED_QUEST, 'now'), status: 'COMPLETED' as const };
    const third: QuestDefinition = { ...QUEST, id: 'q3', prerequisites: [{ type: 'ALWAYS' }] };

    const journal = buildQuestJournal(
      [LOCKED_QUEST, third, QUEST],
      [finished, STARTED],
      context({ completedQuestIds: ['q2'] }),
      'PATHFINDER',
    );

    expect(journal.map((entry) => [entry.questId, entry.status])).toEqual([
      ['q1', 'ACTIVE'],
      ['q3', 'AVAILABLE'],
      ['q2', 'COMPLETED'],
    ]);
  });

  it('is empty when nothing is startable yet', () => {
    expect(buildQuestJournal([LOCKED_QUEST], [], context(), 'PATHFINDER')).toEqual([]);
  });

  /**
   * A Sprout's journal used to advertise "The Moonlight Bridge" as "You can
   * start this" while no NPC would offer it and the adventure refused to
   * start. Found by running the flow against a live sandbox with the only
   * real child profile, which is a Sprout.
   */
  it('hides a quest authored for other age bands that the child has not started', () => {
    const sproutOnly: QuestDefinition = { ...QUEST, id: 'q9', ageBands: ['SPROUT'] };
    expect(buildQuestJournal([sproutOnly], [], context(), 'PATHFINDER')).toEqual([]);
    expect(
      buildQuestJournal([sproutOnly], [], context(), 'SPROUT').map((entry) => entry.questId),
    ).toEqual(['q9']);
  });

  it('keeps an out-of-band quest the child has already started', () => {
    const outOfBand: QuestDefinition = { ...QUEST, ageBands: ['SPROUT'] };
    const journal = buildQuestJournal([outOfBand], [STARTED], context(), 'PATHFINDER');
    expect(journal.map((entry) => [entry.questId, entry.status])).toEqual([['q1', 'ACTIVE']]);
  });
});

describe('availableQuests', () => {
  it('lists only quests the child can start right now', () => {
    expect(availableQuests([QUEST, LOCKED_QUEST], [], context()).map((q) => q.id)).toEqual(['q1']);
  });

  it('excludes a quest already in progress', () => {
    expect(availableQuests([QUEST], [STARTED], context())).toEqual([]);
  });
});
