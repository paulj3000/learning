import type {
  AnswerOutcome,
  IssuedChallenge,
  PickupOutcome,
  PlaySession,
  TalkOutcome,
  Upserted,
  WorldChange,
} from '../../../api/play/types';
import type { NpcEngineEvent } from '../contracts/engine';
import type { AdventureEvent, Trigger } from '../contracts/vocabulary';

/**
 * Maps signals the client already has to NPC triggers and adventure events (LAI-NPC-013,
 * contract v1 section 4; server registry `lai/apps/npcs/triggers.py`). Pure functions: they do
 * not send anything, and they never invent an outcome. A trigger only asks the server to pick a
 * line; an adventure event only drives an engine reaction. Neither writes progress.
 */

export interface NpcSignals {
  triggers: Trigger[];
  events: AdventureEvent[];
}

/** An engine signal is about one NPC; play signals are for every NPC in the scene. */
export interface EngineSignal extends NpcSignals {
  npcId: string;
  placementKey: string;
}

/** World change keys that mean "this adventure is complete". */
export const ADVENTURE_COMPLETE_CHANGE_KEYS: readonly string[] = ['TREASURE_COVE_QUEST_COMPLETE'];

/** A play API outcome the client received, tagged with the route it came from. */
export type PlayOutcome =
  | { kind: 'session_upserted'; result: Upserted<PlaySession> }
  | { kind: 'session_changed'; session: PlaySession }
  | { kind: 'challenge_issued'; result: Upserted<IssuedChallenge> }
  | { kind: 'answer'; outcome: AnswerOutcome }
  | { kind: 'pickup'; outcome: PickupOutcome }
  | { kind: 'talk'; outcome: TalkOutcome }
  | { kind: 'world_changes'; added: readonly WorldChange[] };

const EMPTY: NpcSignals = Object.freeze({ triggers: [], events: [] }) as NpcSignals;

function signals(pairs: readonly (readonly [Trigger, AdventureEvent])[]): NpcSignals {
  const triggers: Trigger[] = [];
  const events: AdventureEvent[] = [];
  for (const [trigger, event] of pairs) {
    if (!triggers.includes(trigger)) triggers.push(trigger);
    if (!events.includes(event)) events.push(event);
  }
  return { triggers, events };
}

function questCompleted(updates: readonly { justCompleted: boolean }[]): boolean {
  return updates.some((update) => update.justCompleted);
}

/** Triggers and adventure events for one play API outcome, in the order they happened. */
export function signalsFromPlay(outcome: PlayOutcome): NpcSignals {
  switch (outcome.kind) {
    case 'session_upserted':
      return outcome.result.created
        ? signals([['on_adventure_start', 'adventure.started']])
        : signals([['on_return_visit', 'adventure.resumed']]);
    case 'session_changed':
      return outcome.session.status === 'COMPLETED'
        ? signals([['on_adventure_complete', 'adventure.completed']])
        : EMPTY;
    case 'challenge_issued':
      return signals([['on_challenge_start', 'challenge.started']]);
    case 'answer': {
      const { outcome: answer } = outcome;
      const pairs: (readonly [Trigger, AdventureEvent])[] = [
        answer.correct
          ? ['on_correct_answer', 'answer.correct']
          : ['on_incorrect_answer', 'answer.incorrect'],
      ];
      if (answer.chestOpened || answer.newItems.length > 0) {
        pairs.push(['on_treasure_found', 'treasure.found']);
      }
      if (questCompleted(answer.questUpdates)) pairs.push(['on_quest_complete', 'quest.completed']);
      return signals(pairs);
    }
    case 'pickup': {
      const pairs: (readonly [Trigger, AdventureEvent])[] = [];
      if (outcome.outcome.newItems.length > 0) pairs.push(['on_treasure_found', 'treasure.found']);
      if (questCompleted(outcome.outcome.questUpdates)) {
        pairs.push(['on_quest_complete', 'quest.completed']);
      }
      return signals(pairs);
    }
    case 'talk':
      return questCompleted(outcome.outcome.questUpdates)
        ? signals([['on_quest_complete', 'quest.completed']])
        : EMPTY;
    case 'world_changes':
      return outcome.added.some((change) =>
        ADVENTURE_COMPLETE_CHANGE_KEYS.includes(change.changeKey),
      )
        ? signals([['on_adventure_complete', 'adventure.completed']])
        : EMPTY;
  }
}

const ENGINE_TRIGGERS: Partial<Record<NpcEngineEvent['type'], Trigger>> = {
  'npc.loaded': 'on_spawn',
  'npc.approached': 'on_player_near',
  'npc.interact_requested': 'on_interact',
};

/** The trigger an NPC engine event reports, for that NPC, or null when it reports none. */
export function signalFromEngine(event: NpcEngineEvent): EngineSignal | null {
  const trigger = ENGINE_TRIGGERS[event.type];
  if (trigger === undefined || !('npcId' in event)) return null;
  return { npcId: event.npcId, placementKey: event.placementKey, triggers: [trigger], events: [] };
}
