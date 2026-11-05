import type {
  AnswerOutcome,
  PickupOutcome,
  PlaySession,
  QuestUpdate,
  WorldChange,
} from '../../../api/play/types';
import { TRIGGERS } from '../contracts/vocabulary';
import { signalFromEngine, signalsFromPlay } from './triggers';

const session: PlaySession = {
  sessionId: 's1',
  kind: 'REGION',
  regionId: 'treasure-rush-cove',
  templateSlug: '',
  locationSlug: 'cove',
  status: 'ACTIVE',
  startedAt: '2026-11-05T00:00:00Z',
  lastActivityAt: '2026-11-05T00:00:00Z',
  completedAt: null,
};

const completed: QuestUpdate = {
  questId: 'pips-missing-treasure',
  status: 'COMPLETED',
  currentStageId: 'end',
  justCompleted: true,
  newlyCompletedObjectiveIds: ['o1'],
};

function answer(overrides: Partial<AnswerOutcome> = {}): AnswerOutcome {
  return {
    attemptId: 'a1',
    correct: true,
    feedback: 'CORRECT',
    canRetry: false,
    chestOpened: false,
    newItems: [],
    rewardMessage: null,
    questUpdates: [],
    completionRewards: [],
    ...overrides,
  };
}

const item = {
  itemId: 'gold',
  displayName: 'Gold',
  description: '',
  category: 'COLLECTIBLE' as const,
  assetId: '',
};

describe('signalsFromPlay', () => {
  it('maps a new session to adventure start and a resumed one to a return visit', () => {
    expect(
      signalsFromPlay({ kind: 'session_upserted', result: { value: session, created: true } }),
    ).toEqual({
      triggers: ['on_adventure_start'],
      events: ['adventure.started'],
    });
    expect(
      signalsFromPlay({ kind: 'session_upserted', result: { value: session, created: false } }),
    ).toEqual({
      triggers: ['on_return_visit'],
      events: ['adventure.resumed'],
    });
  });

  it('maps answers by the server grade, treasure and quest completion', () => {
    expect(signalsFromPlay({ kind: 'answer', outcome: answer() })).toEqual({
      triggers: ['on_correct_answer'],
      events: ['answer.correct'],
    });
    expect(
      signalsFromPlay({
        kind: 'answer',
        outcome: answer({ correct: false, feedback: 'TRY_AGAIN' }),
      }),
    ).toEqual({ triggers: ['on_incorrect_answer'], events: ['answer.incorrect'] });
    expect(
      signalsFromPlay({
        kind: 'answer',
        outcome: answer({ chestOpened: true, newItems: [item], questUpdates: [completed] }),
      }),
    ).toEqual({
      triggers: ['on_correct_answer', 'on_treasure_found', 'on_quest_complete'],
      events: ['answer.correct', 'treasure.found', 'quest.completed'],
    });
    const notJust = { ...completed, justCompleted: false };
    expect(
      signalsFromPlay({ kind: 'answer', outcome: answer({ questUpdates: [notJust] }) }).triggers,
    ).toEqual(['on_correct_answer']);
  });

  it('maps pickups, talks, challenges, session completion and world changes', () => {
    const pickup: PickupOutcome = {
      entityId: 'key',
      pickedUp: true,
      collected: true,
      newItems: [item],
      rewardMessage: null,
      questUpdates: [completed],
      completionRewards: [],
    };
    expect(signalsFromPlay({ kind: 'pickup', outcome: pickup }).triggers).toEqual([
      'on_treasure_found',
      'on_quest_complete',
    ]);
    expect(
      signalsFromPlay({ kind: 'pickup', outcome: { ...pickup, newItems: [], questUpdates: [] } }),
    ).toEqual({ triggers: [], events: [] });
    expect(
      signalsFromPlay({
        kind: 'talk',
        outcome: { flagsSet: ['met-pip'], questUpdates: [completed], completionRewards: [] },
      }).triggers,
    ).toEqual(['on_quest_complete']);
    expect(
      signalsFromPlay({
        kind: 'talk',
        outcome: { flagsSet: [], questUpdates: [], completionRewards: [] },
      }).triggers,
    ).toEqual([]);
    expect(
      signalsFromPlay({
        kind: 'challenge_issued',
        result: {
          created: true,
          value: {
            attemptId: 'a',
            attemptNumber: 1,
            sessionId: 's1',
            targetEntityId: 'chest',
            ageBand: 'PATHFINDER',
            issuedAt: '',
            challenge: {
              skillId: 'add',
              operation: 'ADD',
              operands: [1, 2],
              responseMode: 'CHOICE',
              choices: [2, 3],
            },
          },
        },
      }),
    ).toEqual({ triggers: ['on_challenge_start'], events: ['challenge.started'] });
    expect(
      signalsFromPlay({ kind: 'session_changed', session: { ...session, status: 'COMPLETED' } })
        .triggers,
    ).toEqual(['on_adventure_complete']);
    expect(signalsFromPlay({ kind: 'session_changed', session }).triggers).toEqual([]);
    const change = (changeKey: string): WorldChange => ({
      locationSlug: 'cove',
      changeType: 'QUEST',
      changeKey,
      payload: {},
      createdAt: '',
    });
    expect(
      signalsFromPlay({ kind: 'world_changes', added: [change('TREASURE_COVE_QUEST_COMPLETE')] })
        .events,
    ).toEqual(['adventure.completed']);
    expect(
      signalsFromPlay({ kind: 'world_changes', added: [change('BRIDGE_FIXED')] }).triggers,
    ).toEqual([]);
  });

  it('only ever produces registered triggers', () => {
    const answerSignals = signalsFromPlay({
      kind: 'answer',
      outcome: answer({ chestOpened: true, questUpdates: [completed] }),
    });
    for (const trigger of answerSignals.triggers) expect(TRIGGERS).toContain(trigger);
  });
});

describe('signalFromEngine', () => {
  it('maps the three NPC engine events to their triggers for that NPC', () => {
    expect(
      signalFromEngine({ type: 'npc.loaded', placementKey: 'p', npcId: 'pip', placeholder: false }),
    ).toEqual({
      npcId: 'pip',
      placementKey: 'p',
      triggers: ['on_spawn'],
      events: [],
    });
    expect(
      signalFromEngine({ type: 'npc.approached', placementKey: 'p', npcId: 'pip' })?.triggers,
    ).toEqual(['on_player_near']);
    expect(
      signalFromEngine({
        type: 'npc.interact_requested',
        placementKey: 'p',
        npcId: 'pip',
        via: 'touch',
      })?.triggers,
    ).toEqual(['on_interact']);
  });

  it('ignores engine events that are not triggers', () => {
    expect(signalFromEngine({ type: 'npc.left', placementKey: 'p', npcId: 'pip' })).toBeNull();
    expect(
      signalFromEngine({ type: 'npc.waypoint_reached', placementKey: 'p', index: 1 }),
    ).toBeNull();
  });
});
