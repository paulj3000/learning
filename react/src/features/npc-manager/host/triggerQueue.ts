import type { Trigger } from '../contracts/vocabulary';

/**
 * Which ambient conversation the scene host starts next (LAI-NPC-016). Pure logic, no React.
 *
 * Play outcomes (a chest answer, a find, a finished quest) and NPC spawns can each ask an NPC to
 * say something, but a child only ever sees one conversation, and never on top of another panel.
 * So the host queues them and starts one when nothing else is on screen:
 *
 * - One play slot. A play outcome yields one trigger (its most important, `PLAY_TRIGGER_RANK`);
 *   it replaces the waiting one when it ranks the same or higher (a find beats the wrong answer
 *   before it), or when the waiting one is older than `STALE_MS`. Otherwise it is dropped.
 * - Spawn greetings (`on_spawn`), one per placement, after the play slot.
 *
 * A trigger only asks the server for a line; it never decides or records anything.
 */

/** Higher is more important. Triggers absent here are not play triggers. */
export const PLAY_TRIGGER_RANK: Readonly<Partial<Record<Trigger, number>>> = {
  on_adventure_start: 1,
  on_return_visit: 2,
  on_challenge_start: 3,
  on_correct_answer: 4,
  on_incorrect_answer: 4,
  on_treasure_found: 5,
  on_quest_complete: 6,
  on_adventure_complete: 7,
};

export const STALE_MS = 60_000;

/** The most important play trigger of one outcome, or null. */
export function bestPlayTrigger(triggers: readonly Trigger[]): Trigger | null {
  let best: Trigger | null = null;
  for (const trigger of triggers) {
    const rank = PLAY_TRIGGER_RANK[trigger];
    if (rank === undefined) continue;
    if (best === null || rank > (PLAY_TRIGGER_RANK[best] ?? 0)) best = trigger;
  }
  return best;
}

export interface QueuedTrigger {
  trigger: Trigger;
  /** For `on_spawn`: the NPC that appeared. Null: the host picks the NPC (play triggers). */
  npcId: string | null;
  placementKey: string | null;
}

export interface TriggerQueue {
  /** Offers a play trigger; returns whether it is now waiting. */
  offerPlay(trigger: Trigger): boolean;
  offerSpawn(npcId: string, placementKey: string): void;
  /** The next conversation to start, removing it from the queue. */
  take(): QueuedTrigger | null;
  size(): number;
  clear(): void;
}

export function createTriggerQueue(now: () => number = () => Date.now()): TriggerQueue {
  let play: { trigger: Trigger; rank: number; at: number } | null = null;
  let spawns: QueuedTrigger[] = [];
  return {
    offerPlay(trigger) {
      const rank = PLAY_TRIGGER_RANK[trigger];
      if (rank === undefined) return false;
      const at = now();
      if (play && rank < play.rank && at - play.at < STALE_MS) return false;
      play = { trigger, rank, at };
      return true;
    },
    offerSpawn(npcId, placementKey) {
      if (spawns.some((queued) => queued.placementKey === placementKey)) return;
      spawns.push({ trigger: 'on_spawn', npcId, placementKey });
    },
    take() {
      if (play) {
        const next: QueuedTrigger = { trigger: play.trigger, npcId: null, placementKey: null };
        play = null;
        return next;
      }
      return spawns.shift() ?? null;
    },
    size: () => (play ? 1 : 0) + spawns.length,
    clear() {
      play = null;
      spawns = [];
    },
  };
}
