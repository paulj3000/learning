import { describe, expect, it } from 'vitest';
import { bestPlayTrigger, createTriggerQueue, STALE_MS } from './triggerQueue';

describe('bestPlayTrigger', () => {
  it('picks the most important play trigger of an outcome', () => {
    expect(bestPlayTrigger(['on_correct_answer', 'on_treasure_found', 'on_quest_complete'])).toBe(
      'on_quest_complete',
    );
    expect(bestPlayTrigger(['on_spawn', 'on_interact'])).toBeNull();
    expect(bestPlayTrigger([])).toBeNull();
  });
});

describe('createTriggerQueue', () => {
  it('keeps one play trigger: the same or higher rank replaces it, lower is dropped', () => {
    let now = 0;
    const queue = createTriggerQueue(() => now);
    expect(queue.offerPlay('on_challenge_start')).toBe(true);
    expect(queue.offerPlay('on_incorrect_answer')).toBe(true);
    expect(queue.offerPlay('on_challenge_start')).toBe(false);
    expect(queue.offerPlay('on_treasure_found')).toBe(true);
    expect(queue.size()).toBe(1);
    expect(queue.take()).toEqual({ trigger: 'on_treasure_found', npcId: null, placementKey: null });
    expect(queue.take()).toBeNull();
    // A stale important trigger gives way to a newer one.
    queue.offerPlay('on_quest_complete');
    now = STALE_MS + 1;
    expect(queue.offerPlay('on_challenge_start')).toBe(true);
    expect(queue.take()?.trigger).toBe('on_challenge_start');
  });

  it('refuses non-play triggers in the play slot', () => {
    const queue = createTriggerQueue();
    expect(queue.offerPlay('on_interact')).toBe(false);
    expect(queue.size()).toBe(0);
  });

  it('greets each spawned placement once, after the play trigger', () => {
    const queue = createTriggerQueue();
    queue.offerSpawn('pirate-pip', 'cove-pip');
    queue.offerSpawn('pirate-pip', 'cove-pip');
    queue.offerPlay('on_adventure_start');
    expect(queue.take()?.trigger).toBe('on_adventure_start');
    expect(queue.take()).toEqual({
      trigger: 'on_spawn',
      npcId: 'pirate-pip',
      placementKey: 'cove-pip',
    });
    expect(queue.take()).toBeNull();
    queue.offerSpawn('a', 'b');
    queue.clear();
    expect(queue.size()).toBe(0);
  });
});
